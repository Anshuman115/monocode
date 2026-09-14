import { createContext } from "react";
import type { OrchestrationProposal } from "../lib/orchestrationPlan";
import type { Session } from "../lib/session";

/**
 * Workers have no pane of their own; the lead's sidebar card is where their
 * activity is inspected. Their approvals go to the lead, not to the user.
 */
export const OrchestrationWorkers = createContext<{
  sessions: Session[];
  selectedId: string | null;
  inspect(sessionId: string | null): void;
  /**
   * The one exception to the rule above: open this worker's transcript as a
   * tab beside its lead, for when the card's few lines are not enough. Absent
   * wherever the card renders without a workspace behind it.
   */
  openDetails?(worker: {
    sessionId: string;
    leadId: string;
    title: string;
  }): void;
}>({ sessions: [], selectedId: null, inspect: () => {} });

// Shared by transcript cards in both ordinary and split session panes.
export const OrchestrationActions = createContext<{
  update(
    leadId: string,
    blockId: string,
    proposal: OrchestrationProposal,
  ): void;
  confirm(leadId: string, blockId: string): Promise<void>;
  retry(leadId: string, blockId: string): void;
  open(sessionId: string): void;
} | null>(null);
