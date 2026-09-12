import { invoke } from "@tauri-apps/api/core";
import { HARNESSES, type HarnessId, type Session } from "./session";
import type { HarnessEvent } from "./harness/types";
import {
  validateOrchestrationSettings,
  validateProposedTasks,
  type OrchestrationChoice,
  type OrchestrationProposal,
} from "./orchestrationPlan";

export type TaskStatus =
  "queued" | "running" | "cancelling" | "completed" | "failed" | "cancelled";
export type OrchestrationTask = {
  id: string;
  assignmentId?: string;
  sessionId: string;
  title: string;
  harness: HarnessId;
  model: string;
  prompt: string;
  files: string[];
  scopes: string[];
  dependsOn: string[];
  status: TaskStatus;
  accepted: boolean;
  result: string;
  error?: string;
  delivered: boolean;
};
export type OrchestrationRun = {
  version: 1;
  leadId: string;
  cwd: string;
  canonicalRoot?: string;
  status: "active" | "paused" | "stopped" | "finished";
  allowedHarnesses: HarnessId[];
  allowedModels?: OrchestrationChoice[];
  proposalId?: string;
  maxWorkers: number;
  cli: string;
  tasks: OrchestrationTask[];
  error?: string;
  continuations: number;
  requests: Record<string, { signature: string; result: unknown }>;
};
export type ControlOutcome = {
  status: "completed" | "failed" | "cancelled";
  text: string;
  error?: string;
};
export type OrchestrationHost = {
  session(id: string): Session | undefined;
  sessions(): Session[];
  choices(): { harness: HarnessId; models: { id: string; name: string }[] }[];
  createWorker(run: OrchestrationRun, task: OrchestrationTask): Promise<void>;
  submit(
    id: string,
    text: string,
    done: (outcome: ControlOutcome) => void,
  ): void;
  stop(id: string): Promise<void>;
};
type Storage = {
  save(run: OrchestrationRun): Promise<void>;
  load(id: string): Promise<OrchestrationRun | null>;
  enable(id: string, cwd: string): Promise<string>;
  disable(id: string): Promise<void>;
  scopes(cwd: string, files: string[]): Promise<string[]>;
};
const storage: Storage = {
  save: (run) =>
    invoke("control_save", { leadId: run.leadId, state: JSON.stringify(run) }),
  load: async (id) => {
    const raw = await invoke<string | null>("control_load", { leadId: id });
    if (!raw) return null;
    const run = JSON.parse(raw) as OrchestrationRun;
    if (run.version !== 1 || run.leadId !== id || !Array.isArray(run.tasks))
      throw new Error("Unsupported orchestration history");
    return run;
  },
  enable: (sessionId, cwd) => invoke("control_enable", { sessionId, cwd }),
  disable: (sessionId) => invoke("control_disable", { sessionId }),
  scopes: (cwd, files) => invoke("control_scopes", { cwd, files }),
};

export function scopesOverlap(a: string[], b: string[]): boolean {
  return a.some((left) =>
    b.some(
      (right) =>
        left === right ||
        left.startsWith(`${right}/`) ||
        right.startsWith(`${left}/`),
    ),
  );
}
const activeTask = (task: OrchestrationTask) =>
  task.status === "running" || task.status === "cancelling";
export const sameCheckout = (a: string, b: string) =>
  a.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase() ===
  b.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
function text(value: unknown, label: string, max = 30_000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(`Invalid ${label}`);
  return value.trim();
}
function strings(value: unknown, label: string, max = 64): string[] {
  if (!Array.isArray(value) || value.length > max)
    throw new Error(`Invalid ${label}`);
  return [...new Set(value.map((item) => text(item, label, 512)))];
}

export class Orchestrator {
  private runs: OrchestrationRun[] = [];
  private listeners = new Set<() => void>();
  private loaded = new Set<string>();
  private persisted = new Map<string, OrchestrationRun>();
  private saves = Promise.resolve();
  private actions = Promise.resolve();
  private pumping = false;
  private starting = new Set<string>();
  private pumpAgain = false;
  private waking = new Set<string>();
  private inflight = new Map<
    string,
    { signature: string; promise: Promise<unknown> }
  >();
  private host: OrchestrationHost | null = null;
  constructor(private readonly store: Storage = storage) {}
  bind(host: OrchestrationHost) {
    this.host = host;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.runs;
  run(id: string) {
    return this.runs.find((run) => run.leadId === id);
  }
  forSession(id: string) {
    return this.runs.find(
      (run) =>
        run.leadId === id || run.tasks.some((task) => task.sessionId === id),
    );
  }
  private emit() {
    for (const listener of this.listeners) listener();
  }
  private async commit(run: OrchestrationRun) {
    this.runs = [
      ...this.runs.filter((entry) => entry.leadId !== run.leadId),
      run,
    ];
    this.emit();
    const saved = this.saves
      .catch(() => undefined)
      .then(async () => {
        await this.store.save(run);
        this.persisted.set(run.leadId, run);
      });
    this.saves = saved;
    try {
      await saved;
    } catch (error) {
      const current = this.run(run.leadId)!;
      const running = current.tasks.filter(activeTask);
      this.runs = this.runs.map((entry) =>
        entry.leadId === run.leadId
          ? {
              ...entry,
              status: "paused",
              error: `Could not save run: ${messageOf(error)}`,
              tasks: entry.tasks.map((task) =>
                activeTask(task) ? { ...task, status: "cancelling" } : task,
              ),
            }
          : entry,
      );
      this.emit();
      // Keep the checkout reserved until processes have stopped, even if the
      // database is unavailable. Recovery never repeats an interrupted turn.
      await Promise.allSettled(
        [run.leadId, ...running.map((task) => task.sessionId)].map(
          async (id) => {
            await this.host?.stop(id);
            const latest = this.run(run.leadId)!;
            this.runs = this.runs.map((entry) =>
              entry.leadId === run.leadId
                ? {
                    ...latest,
                    tasks: latest.tasks.map((task) =>
                      task.sessionId === id && activeTask(task)
                        ? {
                            ...task,
                            status: "failed",
                            accepted: false,
                            delivered: true,
                            error:
                              "Stopped because run history could not be saved. Review files before retrying.",
                          }
                        : task,
                    ),
                  }
                : entry,
            );
            this.emit();
          },
        ),
      );
      throw error;
    }
  }
  private async patchTask(
    leadId: string,
    id: string,
    patch: Partial<OrchestrationTask>,
  ) {
    const run = this.run(leadId);
    if (run)
      await this.commit({
        ...run,
        tasks: run.tasks.map((task) =>
          task.id === id ? { ...task, ...patch } : task,
        ),
      });
  }
  async hydrate(id: string) {
    if (this.loaded.has(id) || this.run(id)) return;
    this.loaded.add(id);
    try {
      const run = await this.store.load(id);
      if (!run || this.run(id)) return;
      if (run.status === "active" || run.tasks.some(activeTask)) {
        await Promise.all(
          [
            id,
            ...run.tasks.filter(activeTask).map((task) => task.sessionId),
          ].map((sessionId) => this.host?.stop(sessionId)),
        );
        await this.store.disable(id);
      }
      await this.commit({
        ...run,
        status: run.status === "active" ? "paused" : run.status,
        tasks: run.tasks.map((task) =>
          activeTask(task)
            ? {
                ...task,
                status: "failed",
                accepted: false,
                error: "Interrupted. Review the shared files before retrying.",
                delivered: false,
              }
            : { ...task, delivered: task.accepted || task.status === "queued" },
        ),
        error:
          run.status === "active"
            ? "Run interrupted. Review the files, then resume."
            : run.error,
      });
    } catch (error) {
      this.loaded.delete(id);
      throw error;
    }
  }
  async start(
    leadId: string,
    allowedHarnesses: HarnessId[],
    maxWorkers: number,
    approved?: {
      proposalId: string;
      allowedModels: OrchestrationChoice[];
      tasks: OrchestrationTask[];
    },
  ) {
    if (this.starting.has(leadId))
      throw new Error("The run is already starting");
    this.starting.add(leadId);
    try {
      await this.startRun(leadId, allowedHarnesses, maxWorkers, approved);
    } finally {
      this.starting.delete(leadId);
    }
  }
  async startApproved(
    leadId: string,
    proposalId: string,
    proposal: OrchestrationProposal,
  ) {
    if (proposal.status !== "ready")
      throw new Error("Review a completed proposal before starting");
    const settings = validateOrchestrationSettings(proposal.settings);
    const planned = validateProposedTasks(proposal.tasks, settings);
    const lead = this.host?.session(leadId);
    if (!lead || !sameCheckout(lead.cwd, proposal.cwd))
      throw new Error("Return to the proposal's project before starting");
    const available = this.host!.choices();
    const allowedModels = settings.choices.filter((choice) =>
      available.some(
        (entry) =>
          entry.harness === choice.harness &&
          entry.models.some((model) => model.id === choice.model),
      ),
    );
    if (
      planned.some(
        (task) =>
          !allowedModels.some(
            (choice) =>
              choice.harness === task.harness && choice.model === task.model,
          ),
      )
    )
      throw new Error(
        "An assigned model is no longer available. Change that assignment before starting.",
      );
    const ids = new Map(planned.map((task) => [task.id, crypto.randomUUID()]));
    const tasks: OrchestrationTask[] = await Promise.all(
      planned.map(async (task) => ({
        ...task,
        id: ids.get(task.id)!,
        assignmentId: task.id,
        sessionId: crypto.randomUUID(),
        scopes: await this.store.scopes(lead.cwd, task.files),
        dependsOn: task.dependsOn.map((id) => ids.get(id)!),
        status: "queued",
        accepted: false,
        delivered: true,
        result: "",
      })),
    );
    await this.start(
      leadId,
      [...new Set(allowedModels.map((choice) => choice.harness))],
      settings.maxWorkers,
      { proposalId, allowedModels, tasks },
    );
    this.host!.submit(
      leadId,
      `The user confirmed the orchestration card, including any edits. The app has already queued the exact assignments below; do not delegate duplicates. Supervise them through the control CLI, review their changes, request corrections when needed, and finish the original request.\n\nOriginal request:\n${proposal.request}\n\nApproved assignments:\n${JSON.stringify(tasks.map(({ id, title, prompt, harness, model, files, dependsOn }) => ({ taskId: id, title, prompt, harness, model, files, dependsOn })))}`,
      (outcome) => {
        const run = this.run(leadId);
        if (outcome.status !== "completed" && run?.status === "active")
          void this.commit({
            ...run,
            status: "paused",
            error:
              outcome.error ??
              "The lead was interrupted. Review and resume the run.",
          }).catch(console.error);
      },
    );
  }
  private async startRun(
    leadId: string,
    allowedHarnesses: HarnessId[],
    maxWorkers: number,
    approved?: {
      proposalId: string;
      allowedModels: OrchestrationChoice[];
      tasks: OrchestrationTask[];
    },
  ) {
    const lead = this.host?.session(leadId);
    if (!lead || lead.busy)
      throw new Error("Wait for the lead's current turn to finish");
    if (lead.worktreeCwd)
      throw new Error(
        "Start orchestration in a regular project session; this session uses a worktree",
      );
    if (!Number.isInteger(maxWorkers) || maxWorkers < 1 || maxWorkers > 4)
      throw new Error("Choose 1 to 4 workers");
    const available = this.host!.choices().map((choice) => choice.harness);
    if (
      !allowedHarnesses.length ||
      allowedHarnesses.some((id) => !available.includes(id))
    )
      throw new Error("Choose installed worker harnesses");
    if (
      this.host!.sessions().some(
        (session) =>
          session.id !== leadId &&
          session.busy &&
          sameCheckout(session.worktreeCwd ?? session.cwd, lead.cwd),
      )
    )
      throw new Error("Stop other running sessions in this checkout first");
    const previous = this.run(leadId);
    if (
      previous?.status === "active" ||
      (approved && previous?.status === "paused")
    )
      throw new Error("Stop the current run before starting another proposal");
    if (previous?.tasks.some(activeTask))
      throw new Error("Stop active workers before changing the run");
    const [canonicalRoot] = await this.store.scopes(lead.cwd, ["."]);
    const cli = await this.store.enable(leadId, lead.cwd);
    try {
      await this.host!.stop(leadId); // Refresh the child environment before its next turn.
      await this.commit({
        version: 1,
        leadId,
        cwd: lead.cwd,
        canonicalRoot,
        cli,
        status: "active",
        allowedHarnesses: [...new Set(allowedHarnesses)],
        allowedModels:
          approved?.allowedModels ??
          (previous?.status === "paused" ? previous.allowedModels : undefined),
        proposalId:
          approved?.proposalId ??
          (previous?.status === "paused" ? previous.proposalId : undefined),
        maxWorkers,
        tasks:
          approved?.tasks ??
          (previous?.status === "paused" ? previous.tasks : []),
        continuations: 0,
        requests: previous?.status === "paused" ? previous.requests : {},
      });
    } catch (error) {
      await this.store.disable(leadId);
      throw error;
    }
    void this.pump();
    this.sync();
  }
  submissionError(id: string, managed = false): string | null {
    if (managed) return null;
    const session = this.host?.session(id);
    if (!session) return null;
    const own = this.forSession(id);
    if (
      own &&
      own.leadId !== id &&
      (own.status === "active" || own.tasks.some(activeTask))
    )
      return "This worker is managed by the orchestrator. Send instructions through its lead or stop the run first.";
    const other = this.runs.find(
      (run) =>
        (run.status === "active" || run.tasks.some(activeTask)) &&
        run.leadId !== id &&
        sameCheckout(run.cwd, session.worktreeCwd ?? session.cwd),
    );
    if (other)
      return "This checkout has an active orchestrator. Stop that run before starting independent work.";
    if (own?.status === "paused")
      return "Resume or stop orchestration before sending the lead another turn.";
    if (
      own?.status === "active" &&
      !sameCheckout(own.cwd, session.worktreeCwd ?? session.cwd)
    )
      return "Return the lead to its original project or stop orchestration first.";
    return null;
  }
  prompt(id: string, prompt: string): string {
    const run = this.run(id);
    if (!run || run.status !== "active") return prompt;
    const cli = `'${run.cli.replace(/'/g, `'\\''`)}' control`;
    return `${prompt}\n\n<monocode_orchestration>\nYou are the lead of a local MonoCode run. Coordinate the user's task using ${cli}. Run it with --help to learn the commands. Credentials are already in your environment; never print them.\nUse list to discover allowed harness/model IDs. Delegate bounded tasks with project-relative files (directories reserve their descendants), self-contained prompts and dependsOn task IDs. Use the same checkout. You may read and plan; leave file edits to workers. Never start workers outside this CLI. Workers with overlapping files are queued. For installs, Git mutations, generators or broad formatting, assign a separate task with files ["."] and wait for other workers to finish.\nRead results with get or wait; completed means a turn finished, not that the work passed review. Review the actual changes, message a worker for fixes, and use review to accept each completed task. Cancel discarded tasks. Call finish only when required work and combined validation are complete. You receive worker results automatically when idle; use bounded wait calls while supervising. Do not expose credentials, use worktrees, switch branches or silently escalate worker permissions.\n</monocode_orchestration>`;
  }
  async handle(
    leadId: string,
    requestId: string,
    action: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const signature = JSON.stringify({ action, input });
    const key = `${leadId}:${requestId}`;
    const previous = this.persisted.get(leadId)?.requests[requestId];
    if (previous) {
      if (previous.signature !== signature)
        throw new Error("Request ID was already used with different input");
      return previous.result;
    }
    const pending = this.inflight.get(key);
    if (pending) {
      if (pending.signature !== signature)
        throw new Error("Request ID was already used with different input");
      return pending.promise;
    }
    if (action === "wait") return this.wait(leadId, input);
    const result = this.actions
      .catch(() => undefined)
      .then(async () => {
        const run = this.run(leadId);
        if (!run || run.status !== "active")
          throw new Error("This run is not active");
        if (
          !["list", "get"].includes(action) &&
          Object.keys(run.requests).length >= 512
        )
          throw new Error(
            "Run command limit reached. Stop the run and start another after reviewing the files.",
          );
        return this.execute(run, action, input, requestId, signature);
      });
    this.actions = result.then(
      () => undefined,
      () => undefined,
    );
    this.inflight.set(key, { signature, promise: result });
    try {
      return await result;
    } finally {
      this.inflight.delete(key);
      void this.pump();
    }
  }
  private view(run: OrchestrationRun) {
    return {
      ...run,
      cli: undefined,
      requests: undefined,
      tasks: run.tasks.map((task) => ({
        ...task,
        prompt: undefined,
        scopes: undefined,
        waitingFor: this.waitingFor(run, task),
      })),
    };
  }
  waitingFor(
    run: OrchestrationRun,
    task: OrchestrationTask,
  ): string | undefined {
    if (task.status !== "queued") return undefined;
    const dependency = run.tasks.find(
      (entry) => task.dependsOn.includes(entry.id) && !entry.accepted,
    );
    if (dependency) return `Waiting for review: ${dependency.title}`;
    const owner = run.tasks.find(
      (entry) => activeTask(entry) && scopesOverlap(entry.scopes, task.scopes),
    );
    if (owner) return `Waiting for files: ${owner.title}`;
    return "Waiting for a worker slot";
  }
  private async execute(
    run: OrchestrationRun,
    action: string,
    input: Record<string, unknown>,
    requestId: string,
    signature: string,
  ): Promise<unknown> {
    // Persist the mutation and its retry receipt together, before dispatch.
    const record = async (next: OrchestrationRun, result: unknown) => {
      await this.commit({
        ...next,
        requests: { ...next.requests, [requestId]: { signature, result } },
      });
      return result;
    };
    const changeTask = (
      id: string,
      patch: Partial<OrchestrationTask>,
      result: unknown,
    ) => {
      const current = this.run(run.leadId)!;
      return record(
        {
          ...current,
          tasks: current.tasks.map((entry) =>
            entry.id === id ? { ...entry, ...patch } : entry,
          ),
        },
        result,
      );
    };
    const task = () => {
      const id = text(input.taskId, "taskId", 128);
      const found = this.run(run.leadId)!.tasks.find(
        (entry) => entry.id === id,
      );
      if (!found) throw new Error("Task does not belong to this run");
      return found;
    };
    switch (action) {
      case "list":
        return {
          run: this.view(run),
          harnesses: this.host!.choices()
            .filter((choice) => run.allowedHarnesses.includes(choice.harness))
            .map((choice) => ({
              ...choice,
              models: choice.models.filter(
                (model) =>
                  !run.allowedModels ||
                  run.allowedModels.some(
                    (allowed) =>
                      allowed.harness === choice.harness &&
                      allowed.model === model.id,
                  ),
              ),
            })),
        };
      case "get":
        return task();
      case "delegate": {
        if (run.tasks.length >= 40)
          throw new Error("This run has reached its 40-task limit");
        const harness = text(input.harness, "harness") as HarnessId;
        if (
          !HARNESSES.includes(harness) ||
          !run.allowedHarnesses.includes(harness)
        )
          throw new Error("Harness is not allowed in this run");
        const choice = this.host!.choices().find(
          (entry) => entry.harness === harness,
        );
        if (!choice) throw new Error("Worker harness is unavailable");
        const permittedModels = choice.models.filter(
          (model) =>
            !run.allowedModels ||
            run.allowedModels.some(
              (allowed) =>
                allowed.harness === harness && allowed.model === model.id,
            ),
        );
        const model =
          input.model == null
            ? permittedModels[0]?.id
            : text(input.model, "model", 256);
        if (!model || !permittedModels.some((item) => item.id === model))
          throw new Error("Choose a model ID returned by list");
        const title = text(input.title, "title", 160);
        const prompt = text(input.prompt, "prompt");
        const files = strings(input.files, "files");
        if (!files.length)
          throw new Error(
            "Declare at least one file/directory scope, or '.' for exclusive checkout access",
          );
        const dependsOn = strings(input.dependsOn ?? [], "dependsOn", 40);
        if (
          dependsOn.some(
            (id) =>
              !run.tasks.some(
                (item) => item.id === id && item.status !== "cancelled",
              ),
          )
        )
          throw new Error("Dependencies must be existing tasks in this run");
        const scopes = await this.store.scopes(run.cwd, files);
        const created: OrchestrationTask = {
          id: crypto.randomUUID(),
          sessionId: crypto.randomUUID(),
          title,
          prompt,
          files,
          scopes,
          dependsOn,
          harness,
          model,
          status: "queued",
          accepted: false,
          result: "",
          delivered: true,
        };
        return record(
          {
            ...this.run(run.leadId)!,
            tasks: [...this.run(run.leadId)!.tasks, created],
          },
          {
            taskId: created.id,
            sessionId: created.sessionId,
            status: "queued",
          },
        );
      }
      case "message": {
        const target = task();
        if (activeTask(target) || target.status === "queued")
          throw new Error(
            "Wait for this worker or cancel it before sending a new turn",
          );
        if (
          run.tasks.some(
            (entry) =>
              entry.dependsOn.includes(target.id) &&
              entry.status !== "queued" &&
              entry.status !== "cancelled",
          )
        )
          throw new Error(
            "A dependent task has already started; create a separate correction task after it finishes",
          );
        return changeTask(
          target.id,
          {
            prompt: text(input.text, "text"),
            status: "queued",
            accepted: false,
            result: "",
            error: undefined,
            delivered: true,
          },
          { taskId: target.id, status: "queued" },
        );
      }
      case "cancel":
        await this.cancelTask(run.leadId, task().id);
        return record(this.run(run.leadId)!, { cancelled: true });
      case "review": {
        const target = task();
        if (target.status !== "completed")
          throw new Error("Only a completed result can be accepted");
        return changeTask(target.id, { accepted: true }, { accepted: true });
      }
      case "finish": {
        if (
          run.tasks.some(
            (entry) => entry.status !== "cancelled" && !entry.accepted,
          )
        )
          throw new Error("Review all required tasks before finishing");
        const result = await record(
          { ...this.run(run.leadId)!, status: "finished" },
          { finished: true },
        );
        await this.store.disable(run.leadId);
        return result;
      }
      default:
        throw new Error("Unknown action. Run control --help.");
    }
  }
  private async wait(leadId: string, input: Record<string, unknown>) {
    const run = this.run(leadId);
    if (!run || run.status !== "active")
      throw new Error("This run is not active");
    const seconds = input.timeoutSeconds ?? 20;
    if (
      typeof seconds !== "number" ||
      !Number.isFinite(seconds) ||
      seconds < 0 ||
      seconds > 25
    )
      throw new Error("timeoutSeconds must be 0 to 25");
    if (
      run.tasks.some(activeTask) ||
      run.tasks.some((task) => task.status === "queued")
    ) {
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          unsubscribe();
          resolve();
        };
        const unsubscribe = this.subscribe(() => {
          if (this.run(leadId) !== run) finish();
        });
        const timer = setTimeout(finish, seconds * 1000);
      });
    }
    return this.view(this.run(leadId)!);
  }
  private async pump() {
    if (this.pumping) {
      this.pumpAgain = true;
      return;
    }
    if (!this.host) return;
    this.pumping = true;
    try {
      for (const initial of this.runs) {
        let run = this.run(initial.leadId)!;
        if (run.status !== "active") continue;
        for (const initialTask of run.tasks) {
          run = this.run(run.leadId)!;
          const task = run.tasks.find((entry) => entry.id === initialTask.id)!;
          if (
            run.status !== "active" ||
            run.tasks.filter(activeTask).length >= run.maxWorkers
          )
            break;
          if (
            task.status !== "queued" ||
            task.dependsOn.some(
              (id) => !run.tasks.find((entry) => entry.id === id)?.accepted,
            )
          )
            continue;
          if (
            run.tasks.some(
              (entry) =>
                activeTask(entry) && scopesOverlap(entry.scopes, task.scopes),
            )
          )
            continue;
          if (!this.host.session(run.leadId)) {
            await this.stopRun(run.leadId);
            break;
          }
          await this.patchTask(run.leadId, task.id, { status: "running" });
          try {
            if (
              !this.host
                .choices()
                .some(
                  (choice) =>
                    choice.harness === task.harness &&
                    choice.models.some((model) => model.id === task.model),
                )
            )
              throw new Error(
                "The assigned harness/model is no longer available. Review this task before retrying.",
              );
            await this.host.createWorker(run, task);
            if (
              this.run(run.leadId)?.status !== "active" ||
              this.run(run.leadId)?.tasks.find((entry) => entry.id === task.id)
                ?.status !== "running"
            )
              continue;
            const prompt = `${task.prompt}\n\n<monocode_assignment>\nYou are a worker managed by a MonoCode lead. Work in this shared checkout. Your assigned write scope is: ${task.files.join(", ")}. Read other files as needed, but do not edit outside your scope. If another file or shared operation is needed, report the blocker and stop so the lead can assign a new task. Do not spawn agents, create worktrees, switch branches, stage/commit changes, install dependencies or run broad formatters/generators unless this task owns '.' and explicitly requires that operation. Do not undo another agent's changes. Other workers may be editing concurrently; report focused checks, changed files, remaining issues and a concise final result.\n</monocode_assignment>`;
            this.host.submit(task.sessionId, prompt, (outcome) => {
              void this.settle(run.leadId, task.id, outcome).catch(
                console.error,
              );
            });
          } catch (error) {
            await this.settle(run.leadId, task.id, {
              status: "failed",
              text: "",
              error: messageOf(error),
            });
          }
        }
      }
    } catch (error) {
      console.error("Orchestration dispatch failed", error);
    } finally {
      this.pumping = false;
      if (this.pumpAgain) {
        this.pumpAgain = false;
        void this.pump();
      }
    }
  }
  private async settle(
    leadId: string,
    taskId: string,
    outcome: ControlOutcome,
  ) {
    const task = this.run(leadId)?.tasks.find((entry) => entry.id === taskId);
    if (!task || task.status !== "running") return;
    await this.patchTask(leadId, taskId, {
      status: outcome.status,
      result: outcome.text.slice(-20_000),
      error: outcome.error,
      delivered: false,
      accepted: false,
    });
    void this.pump();
    this.sync();
  }
  async cancelTask(leadId: string, taskId: string) {
    const task = this.run(leadId)?.tasks.find((entry) => entry.id === taskId);
    if (!task || task.status === "cancelled") return;
    if (activeTask(task)) {
      await this.patchTask(leadId, taskId, { status: "cancelling" });
      await this.host!.stop(task.sessionId);
    }
    await this.patchTask(leadId, taskId, {
      status: "cancelled",
      accepted: false,
      delivered: false,
    });
    void this.pump();
  }
  async stopRun(leadId: string) {
    const run = this.run(leadId);
    if (!run) return;
    let saveError: unknown;
    await this.commit({ ...run, status: "stopped" }).catch((error: unknown) => {
      saveError = error;
    });
    await Promise.all(
      [
        leadId,
        ...run.tasks.filter(activeTask).map((task) => task.sessionId),
      ].map((id) => this.host?.stop(id)),
    );
    const latest = this.run(leadId)!;
    const stopped: OrchestrationRun = {
      ...latest,
      status: "stopped",
      tasks: latest.tasks.map((task) =>
        activeTask(task) || task.status === "queued"
          ? { ...task, status: "cancelled", accepted: false, delivered: true }
          : task,
      ),
    };
    await this.commit(stopped).catch((error: unknown) => {
      saveError = error;
    });
    this.runs = this.runs.map((entry) =>
      entry.leadId === leadId
        ? {
            ...stopped,
            error: saveError
              ? `Run stopped; could not save history: ${messageOf(saveError)}`
              : undefined,
          }
        : entry,
    );
    this.emit();
    await this.store.disable(leadId);
  }
  stopForSession(id: string): Promise<void> | null {
    const run = this.forSession(id);
    if (
      !run ||
      (run.status !== "active" &&
        run.status !== "paused" &&
        !run.tasks.some(activeTask))
    )
      return null;
    if (run.leadId === id) return this.stopRun(id);
    const task = run.tasks.find((entry) => entry.sessionId === id)!;
    return this.cancelTask(run.leadId, task.id);
  }
  sync() {
    for (const run of this.runs) {
      if (run.status !== "active" || this.waking.has(run.leadId)) continue;
      const lead = this.host?.session(run.leadId);
      if (!lead || lead.busy || lead.queuedMessages?.length) continue;
      const results = run.tasks.filter((task) => !task.delivered);
      if (!results.length) continue;
      this.waking.add(run.leadId);
      // Let session state settle before checking idle; never interrupt user input.
      setTimeout(() => {
        void (async () => {
          try {
            const current = this.run(run.leadId);
            const session = this.host?.session(run.leadId);
            if (
              !current ||
              current.status !== "active" ||
              !session ||
              session.busy ||
              session.queuedMessages?.length
            )
              return;
            const results = current.tasks.filter(
              (task) =>
                !task.delivered &&
                !activeTask(task) &&
                task.status !== "queued",
            );
            if (!results.length) return;
            if (current.continuations >= 20) {
              await this.commit({
                ...current,
                status: "paused",
                error:
                  "Automatic continuation limit reached. Review and resume the run.",
              });
              return;
            }
            await this.commit({
              ...current,
              continuations: current.continuations + 1,
              tasks: current.tasks.map((task) =>
                results.some((item) => item.id === task.id)
                  ? { ...task, delivered: true }
                  : task,
              ),
            });
            const summary = results
              .map(
                (task) =>
                  `${task.id} — ${task.title}: ${task.status}\n${task.error ?? ""}\n${task.result.slice(-4000)}`,
              )
              .join("\n\n");
            this.host!.submit(
              run.leadId,
              `Worker results are ready. Review the work, request corrections through the CLI when needed, and finish the original task.\n\n${summary}`,
              (outcome) => {
                const latest = this.run(run.leadId);
                if (
                  outcome.status !== "completed" &&
                  latest?.status === "active"
                ) {
                  void this.commit({
                    ...latest,
                    status: "paused",
                    error:
                      outcome.error ??
                      "Lead continuation was interrupted. Review and resume.",
                    tasks: latest.tasks.map((task) =>
                      results.some((item) => item.id === task.id)
                        ? { ...task, delivered: false }
                        : task,
                    ),
                  }).catch(console.error);
                } else this.sync();
              },
            );
          } catch (error) {
            console.error("Orchestration continuation failed", error);
          } finally {
            this.waking.delete(run.leadId);
          }
        })();
      }, 0);
    }
  }
  observe(id: string, event: HarnessEvent) {
    if (event.type !== "tool.started" && event.type !== "tool.updated") return;
    const run = this.forSession(id);
    const task = run?.tasks.find(
      (entry) => entry.sessionId === id && entry.status === "running",
    );
    if (
      !run ||
      run.status !== "active" ||
      !task ||
      event.preview?.kind !== "write"
    )
      return;
    const paths =
      event.paths ?? (event.preview.path ? [event.preview.path] : []);
    for (const path of paths) {
      const absolute = /^(\/|[a-z]:[\\/])/i.test(path)
        ? path
        : `${run.canonicalRoot ?? run.cwd}/${path}`;
      const parts: string[] = [];
      for (const part of absolute
        .replace(/\\/g, "/")
        .toLowerCase()
        .split("/")) {
        if (part === "..") parts.pop();
        else if (part !== ".") parts.push(part);
      }
      const normalized = parts.join("/");
      if (
        task.scopes.some(
          (scope) => normalized === scope || normalized.startsWith(`${scope}/`),
        )
      )
        continue;
      void (async () => {
        await this.commit({
          ...this.run(run.leadId)!,
          status: "paused",
          error: `${task.title} reported a write outside its assignment: ${path}. Review the shared files before resuming.`,
        });
        await Promise.all(
          this.run(run.leadId)!
            .tasks.filter(activeTask)
            .map((entry) => this.cancelTask(run.leadId, entry.id)),
        );
      })().catch(console.error);
      break;
    }
  }
}

export const orchestrator = new Orchestrator();
