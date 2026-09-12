import { createContext } from "react";
import type { OrchestrationProposal } from "../lib/orchestrationPlan";
import type { Session } from "../lib/session";

/** Worker activity is rendered inside the lead's pane, without workspace tabs. */
export const OrchestrationWorkers = createContext<{
  sessions: Session[];
  selectedId: string | null;
  inspect(sessionId: string | null): void;
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
