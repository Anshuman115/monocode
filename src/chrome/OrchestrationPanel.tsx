import { useContext, useEffect, useState, useSyncExternalStore } from "react";
import { orchestrator, type OrchestrationTask } from "../lib/orchestration";
import { HARNESS_TITLE, type Session } from "../lib/session";
import {
  OrchestrationActions,
  OrchestrationWorkers,
} from "./OrchestrationActions";
import { HarnessIcon } from "./HarnessIcon";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  MessageMultiple,
  Square,
} from "./icons";
import { pendingApprovalForSession } from "../lib/approvalToast";
import { toolCallLabel } from "../surfaces/transcriptActivity";
import { QuestionForm } from "./QuestionForm";
import type { ApprovalDecision, UserQuestionReply } from "../lib/harness";

type Props = {
  session: Session;
  onApproval(
    sessionId: string,
    requestId: number,
    decision: ApprovalDecision,
  ): void;
  onQuestionReply(
    sessionId: string,
    requestId: number,
    reply: UserQuestionReply,
  ): void;
  onQuestionInteraction?(sessionId: string, requestId: number): void;
};

function latestWorkerBlock(session?: Session) {
  if (!session) return;
  for (let index = session.blocks.length - 1; index >= 0; index--) {
    const block = session.blocks[index];
    if (
      ["assistant", "tool", "approval"].includes(block.role) &&
      block.text.trim()
    )
      return block;
  }
}

function taskState(task: OrchestrationTask, worker?: Session): string {
  if (worker && pendingApprovalForSession(worker)) return "Needs your input";
  if (task.accepted) return "Accepted";
  return {
    queued: "Queued",
    running: "Working",
    cancelling: "Stopping",
    completed: "Ready for review",
    failed: "Failed",
    cancelled: "Cancelled",
  }[task.status];
}

/** Compact agent activity rail alongside the lead's transcript and composer. */
export function OrchestrationPanel({
  session,
  onApproval,
  onQuestionReply,
  onQuestionInteraction,
}: Props) {
  const actions = useContext(OrchestrationActions);
  const workers = useContext(OrchestrationWorkers);
  const runs = useSyncExternalStore(
    orchestrator.subscribe,
    orchestrator.snapshot,
    orchestrator.snapshot,
  );
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const enabled = !!actions;
  useEffect(() => {
    if (enabled)
      void orchestrator
        .hydrate(session.id)
        .catch((reason: unknown) => setError(String(reason)));
  }, [enabled, session.id]);
  const run = runs.find((entry) => entry.leadId === session.id);
  if (!run || !run.tasks.length || !actions) return null;
  const perform = async (operation: () => Promise<void>) => {
    setPending(true);
    setError(undefined);
    try {
      await operation();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPending(false);
    }
  };
  const working = run.tasks.filter((task) => task.status === "running").length;
  const finished = run.tasks.filter((task) => task.accepted).length;
  const button =
    "rounded-md px-2 py-1 text-[11px] text-content/55 hover:bg-content/8 hover:text-content disabled:opacity-35";
  return (
    <aside
      aria-label="Orchestration agents"
      className="w-72 max-w-[40%] shrink-0 overflow-y-auto p-3 pl-0 font-sans"
      data-orchestration-agents
    >
      <div className="overflow-hidden rounded-2xl border border-content/10 bg-content/5">
        <div className="flex items-center gap-2 px-3 py-3">
          <MessageMultiple className="size-4 shrink-0 text-content/45" />
          <span className="min-w-0 flex-1 text-[12px] font-medium text-content/70">
            Agents
          </span>
          <button
            className={button}
            aria-label={collapsed ? "Show agents" : "Collapse agents"}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? (
              <ChevronRight className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
          </button>
        </div>
        <p className="px-3 pb-3 text-[11px] text-content/45">
          {working} working · {finished}/{run.tasks.length} accepted
        </p>
        {!collapsed && (
          <ul className="border-t border-content/10 py-1">
            {run.tasks.map((task) => {
              const worker = workers.sessions.find(
                (entry) => entry.id === task.sessionId,
              );
              const approval = worker && pendingApprovalForSession(worker);
              const approvalDetail =
                approval?.block?.tool?.detail?.trim() || approval?.block?.text;
              const open = workers.selectedId === task.sessionId || !!approval;
              const latest = latestWorkerBlock(worker);
              const activity =
                approval?.label ??
                orchestrator.waitingFor(run, task) ??
                (latest?.tool
                  ? toolCallLabel(latest, run.cwd)
                  : latest?.text) ??
                task.result;
              const model =
                run.allowedModels?.find(
                  (choice) =>
                    choice.harness === task.harness &&
                    choice.model === task.model,
                )?.name ?? task.model;
              return (
                <li key={task.id} className="px-2 py-1">
                  <button
                    type="button"
                    aria-label={`Agent details: ${task.title}`}
                    aria-expanded={open}
                    onClick={() =>
                      workers.inspect(open ? null : task.sessionId)
                    }
                    className="flex w-full min-w-0 items-start gap-2 rounded-lg px-1 py-1.5 text-left hover:bg-content/5"
                  >
                    <HarnessIcon
                      harness={task.harness}
                      className="mt-0.5 size-4 shrink-0"
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className="block truncate text-[12px] text-content/80"
                        title={task.title}
                      >
                        {task.title}
                      </span>
                      <span
                        className="mt-0.5 block truncate text-[10px] text-content/45"
                        title={`${HARNESS_TITLE[task.harness]} · ${model}`}
                      >
                        {model}
                      </span>
                      <span
                        className={`mt-1 flex items-center gap-1.5 text-[11px] ${approval ? "text-amber-300/80" : task.status === "failed" ? "text-red-400" : "text-content/50"}`}
                      >
                        {task.status === "running" && !approval ? (
                          <CircleDashed className="size-3 animate-spin" />
                        ) : task.accepted ? (
                          <Check className="size-3 text-emerald-400" />
                        ) : null}
                        {taskState(task, worker)}
                      </span>
                    </span>
                    {open ? (
                      <ChevronDown className="mt-1 size-3 shrink-0 text-content/35" />
                    ) : (
                      <ChevronRight className="mt-1 size-3 shrink-0 text-content/35" />
                    )}
                  </button>
                  {!open && activity && (
                    <p
                      className="mb-1 truncate px-1 text-[10px] text-content/40"
                      title={activity.slice(0, 500)}
                    >
                      {activity.slice(0, 180)}
                    </p>
                  )}
                  {open && (
                    <div className="space-y-2 px-1 pb-2 pt-1">
                      {activity && (
                        <p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-4.5 text-content/60">
                          {activity.slice(-2000)}
                        </p>
                      )}
                      <p className="break-words font-mono text-[10px] text-content/40">
                        {task.files.join(", ")}
                      </p>
                      {task.error && (
                        <p className="text-[11px] text-red-400">{task.error}</p>
                      )}
                      {approval?.kind === "approval" && (
                        <>
                          {approvalDetail && (
                            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-content/5 p-2 text-[11px] text-content/65">
                              {approvalDetail}
                            </pre>
                          )}
                          <div
                            className="flex flex-wrap gap-1"
                            aria-label={`Approval for ${task.title}`}
                          >
                            <button
                              className={`${button} bg-content/10`}
                              onClick={() =>
                                onApproval(
                                  task.sessionId,
                                  approval.requestId,
                                  "allow",
                                )
                              }
                            >
                              Approve
                            </button>
                            <button
                              className={button}
                              onClick={() =>
                                onApproval(
                                  task.sessionId,
                                  approval.requestId,
                                  "deny",
                                )
                              }
                            >
                              Deny
                            </button>
                          </div>
                        </>
                      )}
                      {worker?.pendingQuestion && (
                        <QuestionForm
                          prompt={worker.pendingQuestion}
                          onReply={(requestId, reply) =>
                            onQuestionReply(task.sessionId, requestId, reply)
                          }
                          onInteraction={(requestId) =>
                            onQuestionInteraction?.(task.sessionId, requestId)
                          }
                        />
                      )}
                      {["queued", "running"].includes(task.status) && (
                        <button
                          className={button}
                          disabled={pending}
                          onClick={() =>
                            void perform(() =>
                              orchestrator.cancelTask(run.leadId, task.id),
                            )
                          }
                        >
                          Cancel task
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {(error || run.error) && (
          <p role="alert" className="px-3 py-2 text-[11px] text-red-400">
            {error ?? run.error}
          </p>
        )}
        <div className="space-y-2 border-t border-content/10 px-3 py-2.5">
          <p className="text-[10px] leading-4 text-content/40">
            Direct the agents through your lead in the main conversation.
          </p>
          <div className="flex flex-wrap items-center justify-between gap-1">
            <span className="text-[10px] text-content/40">
              {run.maxWorkers} parallel · {run.status}
            </span>
            {run.status === "paused" && (
              <button
                className={button}
                disabled={pending || session.busy}
                onClick={() =>
                  void perform(() =>
                    orchestrator.start(
                      run.leadId,
                      run.allowedHarnesses,
                      run.maxWorkers,
                    ),
                  )
                }
              >
                Resume
              </button>
            )}
            {["active", "paused"].includes(run.status) && (
              <button
                className={`${button} flex items-center gap-1`}
                disabled={pending}
                onClick={() =>
                  void perform(() => orchestrator.stopRun(run.leadId))
                }
              >
                <Square className="size-3" /> Stop
              </button>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
