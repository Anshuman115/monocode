import { useContext, useEffect, useState, useSyncExternalStore } from "react";
import { findModel } from "../lib/models";
import { orchestrator } from "../lib/orchestration";
import {
  orchestrationTaskLabel,
  type OrchestrationSummary,
} from "../lib/orchestrationSummary";
import { pendingApprovalForSession } from "../lib/approvalToast";
import { HARNESS_TITLE, type Session } from "../lib/session";
import { HarnessIcon } from "./HarnessIcon";
import { OrchestrationWorkers } from "./OrchestrationActions";
import { Check, ChevronDown, ChevronRight, CircleAlert } from "./icons";
import { TerminalSpinner } from "./TerminalSpinner";

const TICKER_LINES = 5;

/**
 * What the agent actually said, newest last, one line each. Prose only: tool
 * calls and reasoning are the agent's mechanics, and in a card this narrow
 * they crowd out the reporting the sidebar exists to show. A rolling window,
 * so a long run never grows into a wall of text.
 */
function recentWorkerLines(session: Session | undefined) {
  if (!session) return [];
  const lines: string[] = [];
  for (
    let index = session.blocks.length - 1;
    index >= 0 && lines.length < TICKER_LINES;
    index--
  ) {
    const block = session.blocks[index];
    if (block.role !== "assistant" || block.tool) continue;
    const text = block.text.replace(/\s+/g, " ").trim();
    if (text) lines.unshift(text);
  }
  return lines;
}

export function OrchestrationSidebarAgents({
  leadId,
  summary,
}: {
  leadId: string;
  summary: OrchestrationSummary;
}) {
  const workers = useContext(OrchestrationWorkers);
  const runs = useSyncExternalStore(
    orchestrator.subscribe,
    orchestrator.snapshot,
    orchestrator.snapshot,
  );
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  // Rows expand independently, so several agents can be watched side by side.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // Revealing a worker from its toast opens that row without closing others.
  const revealed = workers.selectedId;
  useEffect(() => {
    if (revealed)
      setExpanded((current) =>
        current.has(revealed) ? current : new Set(current).add(revealed),
      );
  }, [revealed]);
  const toggle = (sessionId: string, isOpen: boolean) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (isOpen) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
    if (isOpen && revealed === sessionId) workers.inspect(null);
  };
  // A saved run has no live entry, so the card stays read-only after a reload.
  const run = runs.find((entry) => entry.leadId === leadId);
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
  const done = summary.tasks.filter(
    (task) => task.status === "completed",
  ).length;
  const action =
    "rounded px-1.5 py-0.5 text-[11px] text-content/55 hover:bg-content/10 hover:text-content disabled:opacity-35";
  // Sits inside an already-lit row, so it needs its own surface to read as a
  // button rather than as another line of text.
  const solidAction =
    "rounded bg-content/15 px-1.5 py-0.5 text-[11px] text-content/75 hover:bg-content/25 hover:text-content disabled:opacity-35";
  return (
    <div className="relative mt-1.5">
      <div className="mb-0.5 px-0.5 flex items-center justify-between text-[11px] text-content/45">
        <span>
          {summary.tasks.length}{" "}
          {summary.tasks.length === 1 ? "agent" : "agents"}
        </span>
        <span className="tabular-nums">
          {done}/{summary.tasks.length} done
        </span>
      </div>
      {/*
        Offset by the rows' own padding so a chevron lands on the card's
        content edge, under the harness icon of the header above.

        No height cap and no scroller: the card grows with whatever the user
        expanded, and the sidebar it sits in does the only scrolling. Nesting
        a second scroll region here made rows clip mid-line.
      */}
      <div
        aria-label="Orchestrated agents"
        className="-mx-2 flex touch-pan-y flex-col gap-px"
        onPointerDown={(event) => event.stopPropagation()}
      >
        {summary.tasks.map((task) => {
          const worker = workers.sessions.find(
            (entry) => entry.id === task.sessionId,
          );
          const approval = worker ? pendingApprovalForSession(worker) : null;
          // Something waiting on the user opens itself; it cannot be missed.
          const open = expanded.has(task.sessionId) || !!approval;
          const live = run?.tasks.find(
            (entry) => entry.sessionId === task.sessionId,
          );
          const label = orchestrationTaskLabel(task, summary);
          const working =
            summary.live && task.status === "running" && !task.needsInput;
          // A saved provider model may not be in this window's catalog yet.
          // Keep its identity instead of substituting the harness default.
          const model = findModel(task.model)?.name ?? task.model;
          const lines = recentWorkerLines(worker);
          // Why it is not moving, when that is not the agent's own doing.
          const blockedOn =
            approval?.label ??
            (run && live ? orchestrator.waitingFor(run, live) : undefined);
          return (
            <div
              key={task.sessionId}
              data-orchestration-agent={task.sessionId}
              // Expanding lights the whole row, header and detail together.
              className={`rounded-md ${open ? "bg-content/10" : ""}`}
            >
              <button
                type="button"
                title={`${task.title} · ${HARNESS_TITLE[task.harness]} · ${model} · ${label}`}
                aria-label={`Agent details: ${task.title}`}
                aria-expanded={open}
                onClick={() => toggle(task.sessionId, open)}
                // Named, because the whole session card is already a `group`.
                className={`group/agent flex w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-left ${
                  open ? "" : "hover:bg-content/10"
                }`}
              >
                {/* One slot: the chevron stands in for the harness mark
                    whenever this row is open or under the pointer. */}
                <span className="grid size-3.5 shrink-0 place-items-center text-content/45">
                  {open ? (
                    <ChevronDown className="size-3" strokeWidth={1.75} />
                  ) : (
                    <>
                      <HarnessIcon
                        harness={task.harness}
                        className="size-3.5 opacity-75 group-focus-visible/agent:hidden group-hover/agent:hidden"
                      />
                      <ChevronRight
                        className="hidden size-3 group-focus-visible/agent:block group-hover/agent:block"
                        strokeWidth={1.75}
                      />
                    </>
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] leading-snug text-content/80">
                  {task.title}
                </span>
                <span
                  className={`flex shrink-0 items-center gap-1 text-[11px] ${
                    task.needsInput || task.status === "failed"
                      ? "text-amber-400"
                      : working
                        ? "text-accent"
                        : task.status === "completed"
                          ? "text-emerald-400"
                          : "text-content/45"
                  }`}
                >
                  {task.needsInput || task.status === "failed" ? (
                    <CircleAlert className="size-3" strokeWidth={1.75} />
                  ) : working ? (
                    <TerminalSpinner className="inline-block w-3 select-none text-center text-[11px] leading-none text-accent" />
                  ) : task.status === "completed" ? (
                    <Check className="size-3" strokeWidth={2.25} />
                  ) : null}
                  <span>{label}</span>
                </span>
              </button>
              {/* Indented to the title's column: the icon slot and its gap. */}
              {open && (
                <div className="space-y-1.5 pb-2 pl-7 pr-2 pt-0.5">
                  <p className="truncate text-[11px] text-content/45">
                    {model}
                  </p>
                  {blockedOn && (
                    <p
                      className="truncate text-[11px] text-content/60"
                      title={blockedOn}
                    >
                      {blockedOn}
                    </p>
                  )}
                  {/* Bounded by line count rather than by a scrollbar: a
                      chatty agent drops its oldest line instead of adding
                      another scroll region to the sidebar. */}
                  {lines.length > 0 && (
                    <ul className="space-y-0.5 text-[11px] leading-4 text-content/60">
                      {lines.map((line, index) => (
                        <li
                          key={`${index}:${line}`}
                          className="truncate"
                          title={line}
                        >
                          {line}
                        </li>
                      ))}
                    </ul>
                  )}
                  {live && (
                    <p
                      className="truncate font-mono text-[10px] text-content/40"
                      title={live.files.join(", ")}
                    >
                      {live.files.join(", ")}
                    </p>
                  )}
                  {live?.error && (
                    <p className="text-[11px] text-red-400">{live.error}</p>
                  )}
                  {approval && (
                    <p className="text-[11px] text-amber-400/80">
                      Waiting on the orchestrator to
                      {approval.kind === "approval"
                        ? " approve this"
                        : " answer this"}
                      .
                    </p>
                  )}
                  {live && ["queued", "running"].includes(live.status) && (
                    <button
                      type="button"
                      className={solidAction}
                      disabled={pending}
                      onClick={() =>
                        void perform(() =>
                          orchestrator.cancelTask(leadId, live.id),
                        )
                      }
                    >
                      Cancel task
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {(error || run?.error) && (
        <p role="alert" className="py-1 text-[11px] text-red-400">
          {error ?? run?.error}
        </p>
      )}
      {/* Stopping a run belongs to the composer, which stops the lead and its
          agents together. Resume has no other home, so it stays. */}
      {run?.status === "paused" && (
        <div className="-mr-1.5 mt-0.5 flex items-center justify-end">
          <button
            type="button"
            className={action}
            disabled={pending}
            onClick={() =>
              void perform(() =>
                orchestrator.start(leadId, run.allowedHarnesses, run.maxWorkers),
              )
            }
          >
            Resume
          </button>
        </div>
      )}
    </div>
  );
}
