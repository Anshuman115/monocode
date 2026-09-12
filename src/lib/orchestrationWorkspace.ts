import { closeLeaf, leafIds, type WorkspaceTab } from "./layout";
import type { OrchestrationRun } from "./orchestration";
import type { Session } from "./session";

/** Adopt worker tabs made by the earlier preview into an already-open lead. */
export function consolidateOrchestrationTabs(
  tabs: WorkspaceTab[],
  activeTabId: string,
  runs: OrchestrationRun[],
) {
  const parents = new Map(
    runs.flatMap((run) =>
      tabs.some((tab) => leafIds(tab.layout).includes(run.leadId))
        ? run.tasks.map((task) => [task.sessionId, run.leadId] as const)
        : [],
    ),
  );
  const active = tabs.find((tab) => tab.id === activeTabId);
  const lead = active && parents.get(active.focusedId);
  let changed = false;
  const next = tabs.flatMap((tab) => {
    let remaining: WorkspaceTab | null = tab;
    for (const id of leafIds(tab.layout)) {
      if (remaining && parents.has(id)) {
        remaining = closeLeaf(remaining, id);
        changed = true;
      }
    }
    return remaining ? [remaining] : [];
  });
  return {
    tabs: changed ? next : tabs,
    activeTabId: lead
      ? next.find((tab) => leafIds(tab.layout).includes(lead))!.id
      : activeTabId,
  };
}

export function attachOrchestrationWorkers(
  sessions: Session[],
  runs: OrchestrationRun[],
) {
  const parents = new Map(
    runs.flatMap((run) =>
      run.tasks.map((task) => [task.sessionId, run.leadId] as const),
    ),
  );
  let changed = false;
  const next = sessions.map((session) => {
    const parent = parents.get(session.id);
    if (!parent || session.orchestrationLeadId === parent) return session;
    changed = true;
    return { ...session, orchestrationLeadId: parent };
  });
  return changed ? next : sessions;
}
