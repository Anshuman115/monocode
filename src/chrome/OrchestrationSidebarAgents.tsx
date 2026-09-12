import { findModel } from "../lib/models";
import {
  orchestrationTaskLabel,
  type OrchestrationSummary,
} from "../lib/orchestrationSummary";
import { HarnessIcon } from "./HarnessIcon";

export function OrchestrationSidebarAgents({
  summary,
}: {
  summary: OrchestrationSummary;
}) {
  return (
    <div className="relative mt-2 border-t border-accent/10 pt-2">
      <div className="mb-1 flex items-center justify-between text-[10px] text-content/40">
        <span>
          {summary.tasks.length}{" "}
          {summary.tasks.length === 1 ? "agent" : "agents"}
        </span>
        <span>
          {summary.tasks.filter((task) => task.status === "completed").length}{" "}
          done
        </span>
      </div>
      <div
        aria-label="Orchestrated agents"
        className="max-h-48 touch-pan-y space-y-1.5 overflow-y-auto overscroll-contain"
        onPointerDown={(event) => event.stopPropagation()}
      >
        {summary.tasks.map((task) => {
          const label = orchestrationTaskLabel(task, summary);
          const working =
            summary.live && task.status === "running" && !task.needsInput;
          // A saved provider model may not be in this window's catalog yet.
          // Keep its identity instead of substituting the harness default.
          const model = findModel(task.model)?.name ?? task.model;
          return (
            <div
              key={task.sessionId}
              data-orchestration-agent={task.sessionId}
              title={`${task.title} · ${model} · ${label}`}
            >
              <div className="flex min-w-0 items-center gap-1.5 text-[11px]">
                <HarnessIcon
                  harness={task.harness}
                  className="size-3 shrink-0 opacity-75"
                />
                <span className="min-w-0 flex-1 truncate text-content/75">
                  {task.title}
                </span>
                <span
                  className={`size-1.5 shrink-0 rounded-full ${
                    task.needsInput || task.status === "failed"
                      ? "bg-amber-400"
                      : working
                        ? "bg-accent motion-safe:animate-pulse"
                        : task.status === "completed"
                          ? "bg-emerald-400/70"
                          : "bg-content/25"
                  }`}
                />
              </div>
              <div className="ml-[18px] flex min-w-0 items-center justify-between gap-2 text-[10px] leading-tight text-content/40">
                <span className="min-w-0 truncate">{model}</span>
                <span
                  className={`shrink-0 ${task.needsInput ? "text-amber-400" : ""}`}
                >
                  {label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
