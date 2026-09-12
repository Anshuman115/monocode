import {
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { HARNESS_TITLE, type Block } from "../lib/session";
import type {
  OrchestrationChoice,
  ProposedTask,
} from "../lib/orchestrationPlan";
import { orchestrator } from "../lib/orchestration";
import { OrchestrationActions } from "./OrchestrationActions";
import { HarnessIcon } from "./HarnessIcon";
import { Popover } from "./Popover";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  MessageMultiple,
  Play,
  Search,
} from "./icons";

function AssignmentModel({
  task,
  choices,
  onChange,
}: {
  task: ProposedTask;
  choices: OrchestrationChoice[];
  onChange(choice: OrchestrationChoice): void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const anchor = useRef<HTMLButtonElement>(null);
  const selected = choices.find(
    (choice) => choice.harness === task.harness && choice.model === task.model,
  );
  return (
    <div className="relative min-w-0">
      <button
        type="button"
        ref={anchor}
        aria-label={`Model for ${task.title}`}
        aria-expanded={open}
        onClick={() => {
          setQuery("");
          setOpen(!open);
        }}
        className="flex max-w-full items-center gap-1.5 rounded-md bg-content/5 px-2 py-1 text-[11px] text-content/60 hover:bg-content/10 hover:text-content"
      >
        <HarnessIcon harness={task.harness} className="size-3.5 shrink-0" />
        <span className="truncate">
          {selected?.name ?? task.model} · {HARNESS_TITLE[task.harness]}
        </span>
        <ChevronDown className="size-3 shrink-0" />
      </button>
      {open && (
        <Popover
          anchor={anchor}
          side="bottom"
          align="start"
          width={300}
          onDismiss={() => setOpen(false)}
          className="p-1.5"
        >
          <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-content/40">
            Available models
          </p>
          <label className="mb-1 flex items-center gap-2 border-b border-content/10 px-2 py-2 text-content/40">
            <Search className="size-3.5" />
            <input
              autoFocus
              aria-label="Search assignment models"
              placeholder="Search models or harnesses…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-[12px] text-content outline-none"
            />
          </label>
          <div className="max-h-64 overflow-y-auto">
            {choices
              .filter((choice) =>
                `${choice.name} ${choice.model} ${HARNESS_TITLE[choice.harness]}`
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              )
              .map((choice) => (
                <button
                  key={`${choice.harness}:${choice.model}`}
                  type="button"
                  onClick={() => {
                    onChange(choice);
                    setOpen(false);
                    anchor.current?.focus();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-content/10"
                >
                  <HarnessIcon
                    harness={choice.harness}
                    className="size-4 shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] text-content/90">
                      {choice.name}
                    </span>
                    <span className="block text-[10px] text-content/45">
                      {HARNESS_TITLE[choice.harness]}
                    </span>
                  </span>
                  {choice === selected && (
                    <Check className="size-3.5 text-accent" />
                  )}
                </button>
              ))}
            {!choices.some((choice) =>
              `${choice.name} ${choice.model} ${HARNESS_TITLE[choice.harness]}`
                .toLowerCase()
                .includes(query.toLowerCase()),
            ) && (
              <p className="px-2 py-3 text-[12px] text-content/45">
                No matching models
              </p>
            )}
          </div>
        </Popover>
      )}
    </div>
  );
}

export function OrchestrationPreview({
  block,
  busy,
}: {
  block: Block;
  busy?: boolean;
}) {
  const actions = useContext(OrchestrationActions);
  const runs = useSyncExternalStore(
    orchestrator.subscribe,
    orchestrator.snapshot,
    orchestrator.snapshot,
  );
  const proposal = block.orchestration!;
  const run = runs.find(
    (entry) =>
      entry.leadId === proposal.leadId && entry.proposalId === block.id,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [expanded, setExpanded] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    if (actions)
      void orchestrator
        .hydrate(proposal.leadId)
        .catch((reason: unknown) => setError(String(reason)));
  }, [actions, proposal.leadId]);
  const editable =
    proposal.status === "ready" && !run && !pending && !busy && !!actions;
  const planning = proposal.status === "planning";
  const starting = pending || proposal.status === "starting";
  const visible = showAll ? proposal.tasks : proposal.tasks.slice(0, 3);
  const perform = async (fn: () => Promise<void>) => {
    setPending(true);
    setError(undefined);
    try {
      await fn();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPending(false);
    }
  };
  const change = (id: string, patch: Partial<ProposedTask>) => {
    setError(undefined);
    actions?.update(proposal.leadId, block.id, {
      ...proposal,
      tasks: proposal.tasks.map((task) =>
        task.id === id ? { ...task, ...patch } : task,
      ),
    });
  };
  const secondary =
    "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] text-content/50 hover:bg-content/8 hover:text-content disabled:opacity-35";
  const field =
    "mt-1 w-full rounded-md border border-content/10 bg-background-base/40 px-2 py-1.5 text-[12px] text-content/85 outline-none focus:border-content/30";
  return (
    <div
      className="mb-2 overflow-hidden rounded-xl border border-content/12 bg-content/3 font-sans"
      aria-label="Orchestration proposal"
      data-orchestration-review
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2.5 px-3 py-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-content/8 text-content/55">
          {planning || proposal.status === "starting" ? (
            <CircleDashed className="size-4 animate-spin" />
          ) : (
            <MessageMultiple className="size-4" strokeWidth={1.75} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-medium text-content/80">
            {planning ? "Planning assignments…" : proposal.title}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-content/45">
            <HarnessIcon
              harness={proposal.author.harness}
              className="size-3 shrink-0"
            />
            <span
              className="truncate"
              title={HARNESS_TITLE[proposal.author.harness]}
            >
              Lead · {proposal.author.name}
            </span>
            {!!proposal.tasks.length && (
              <span className="shrink-0">
                · {proposal.tasks.length}{" "}
                {proposal.tasks.length === 1 ? "task" : "tasks"}
              </span>
            )}
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {!run && proposal.status === "invalid" && (
            <button
              className={secondary}
              disabled={busy || !actions}
              onClick={() => actions?.retry(proposal.leadId, block.id)}
            >
              Try again
            </button>
          )}
          {!run && ["ready", "starting"].includes(proposal.status) && (
            <button
              className="flex h-7 items-center gap-1.5 rounded-md border border-content/12 bg-content/8 px-2.5 text-[11px] font-medium text-content/75 hover:bg-content/12 hover:text-content disabled:opacity-35"
              disabled={!editable}
              onClick={() =>
                void perform(() => actions!.confirm(proposal.leadId, block.id))
              }
            >
              <Play className="size-3" />
              {starting ? "Starting…" : "Confirm & start"}
            </button>
          )}
          {run && (
            <button
              className={secondary}
              onClick={() =>
                run.tasks[0] && actions?.open(run.tasks[0].sessionId)
              }
            >
              View agents
            </button>
          )}
        </div>
      </div>
      {(planning || proposal.summary) && (
        <p className="px-3 pb-2.5 text-[12px] leading-5 text-content/50">
          {planning
            ? proposal.settings.choices.length
              ? "Your lead is choosing tasks and worker models. Review the assignments here before starting."
              : "Checking available harnesses and models…"
            : proposal.summary}
        </p>
      )}
      {!!proposal.tasks.length && (
        <ul className="border-t border-content/10 py-1">
          {visible.map((task) => {
            const index = proposal.tasks.indexOf(task);
            const open = expanded.includes(task.id);
            return (
              <li key={task.id}>
                <div className="flex min-h-9 min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1 hover:bg-content/5">
                  <button
                    type="button"
                    aria-label={`Details for ${task.title}`}
                    aria-expanded={open}
                    onClick={() =>
                      setExpanded((prev) =>
                        open
                          ? prev.filter((id) => id !== task.id)
                          : [...prev, task.id],
                      )
                    }
                    className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left text-content/65 hover:text-content"
                  >
                    {open ? (
                      <ChevronDown className="size-3.5 shrink-0" />
                    ) : (
                      <ChevronRight className="size-3.5 shrink-0" />
                    )}
                    <span className="truncate text-[12px]" title={task.title}>
                      {task.title}
                    </span>
                  </button>
                  <div className="max-w-[60%] min-w-0">
                    {editable ? (
                      <AssignmentModel
                        task={task}
                        choices={proposal.settings.choices}
                        onChange={(choice) =>
                          change(task.id, {
                            harness: choice.harness,
                            model: choice.model,
                          })
                        }
                      />
                    ) : (
                      <span
                        className="flex min-w-0 items-center gap-1.5 text-[11px] text-content/50"
                        title={HARNESS_TITLE[task.harness]}
                      >
                        <HarnessIcon
                          harness={task.harness}
                          className="size-3 shrink-0"
                        />
                        <span className="truncate">
                          {proposal.settings.choices.find(
                            (choice) =>
                              choice.harness === task.harness &&
                              choice.model === task.model,
                          )?.name ?? task.model}
                        </span>
                      </span>
                    )}
                  </div>
                </div>
                {open && (
                  <div className="space-y-2 px-3 pb-3 pl-8 text-[11px] text-content/50">
                    {editable ? (
                      <>
                        <label className="block">
                          Task
                          <input
                            aria-label={`Title for task ${index + 1}`}
                            className={field}
                            value={task.title}
                            onChange={(event) =>
                              change(task.id, { title: event.target.value })
                            }
                          />
                        </label>
                        <label className="block">
                          Instructions
                          <textarea
                            aria-label={`Instructions for task ${index + 1}`}
                            className={`${field} min-h-24 resize-y`}
                            value={task.prompt}
                            onChange={(event) =>
                              change(task.id, { prompt: event.target.value })
                            }
                          />
                        </label>
                        <label className="block">
                          Files and folders, one per line
                          <textarea
                            aria-label={`Files for task ${index + 1}`}
                            className={`${field} font-mono`}
                            value={task.files.join("\n")}
                            onChange={(event) =>
                              change(task.id, {
                                files: event.target.value.split("\n"),
                              })
                            }
                          />
                        </label>
                      </>
                    ) : (
                      <>
                        <p className="whitespace-pre-wrap text-[12px] leading-5 text-content/60">
                          {task.prompt}
                        </p>
                        <p className="break-words font-mono">
                          Files · {task.files.join(", ")}
                        </p>
                      </>
                    )}
                    {!!task.dependsOn.length && (
                      <p>
                        After ·{" "}
                        {task.dependsOn
                          .map(
                            (id) =>
                              proposal.tasks.find((entry) => entry.id === id)
                                ?.title ?? id,
                          )
                          .join(", ")}
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {proposal.tasks.length > 3 && (
        <button
          type="button"
          aria-expanded={showAll}
          onClick={() => setShowAll(!showAll)}
          className="flex h-8 w-full items-center gap-1.5 border-t border-content/10 px-3 text-left text-[11px] text-content/45 hover:bg-content/5 hover:text-content/70"
        >
          {showAll ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
          {showAll
            ? "Show fewer tasks"
            : `Show ${proposal.tasks.length - 3} more ${proposal.tasks.length === 4 ? "task" : "tasks"}`}
        </button>
      )}
      {(error || proposal.error) && (
        <p role="alert" className="px-3 py-2 text-[12px] text-red-400">
          {error ?? proposal.error}
        </p>
      )}
      {!planning && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-content/10 px-3 py-2 text-[11px] text-content/45">
          {editable ? (
            <label>
              Parallel workers
              <select
                aria-label="Parallel workers"
                className="ml-1.5 rounded-md bg-content/8 px-1.5 py-0.5 text-content/70"
                value={proposal.settings.maxWorkers}
                onChange={(event) =>
                  actions?.update(proposal.leadId, block.id, {
                    ...proposal,
                    settings: {
                      ...proposal.settings,
                      maxWorkers: Number(event.target.value),
                    },
                  })
                }
              >
                {[1, 2, 3, 4].map((number) => (
                  <option key={number}>{number}</option>
                ))}
              </select>
            </label>
          ) : (
            <span>{proposal.settings.maxWorkers} parallel</span>
          )}
          <span>
            {run?.status ??
              (proposal.status === "approved"
                ? "Approved"
                : proposal.status === "ready"
                  ? "Awaiting confirmation"
                  : "")}{" "}
            · Shared project folder
          </span>
        </div>
      )}
    </div>
  );
}
