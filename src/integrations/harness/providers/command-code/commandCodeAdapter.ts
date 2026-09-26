import {
  bindCommandCodeSession,
  cancelCommandCodeTurn,
  forgetCommandCodeSession,
  respondCommandCodeApproval,
  sendCommandCodeTurn,
  steerCommandCodeTurn,
  stopCommandCodeSession,
} from "./commandCode";
import { refreshCommandCodeCatalog } from "./commandCodeCatalog";
import { probeCommandCodeAvailability } from "./commandCodeAvailability";
import { registerHarness, type HarnessAdapter } from "../../core/registry";

export const commandCodeAdapter: HarnessAdapter = {
  id: "command-code",
  live: true,
  canSteer: false,
  capabilities: {
    structuredTransport: true,
    persistentProcess: false,
    streaming: true,
    followUpTurns: true,
    toolActivity: true,
    // Headless JSON has no channel for a permission prompt or a question: the
    // CLI denies the tool and exits 4. Kept false so no approval UI is offered.
    approvals: false,
    questions: false,
    nativeResume: true,
    compactContext: false,
    rewindLastTurn: false,
  },
  availabilityProbe: probeCommandCodeAvailability,
  sendTurn: sendCommandCodeTurn,
  steerTurn: steerCommandCodeTurn,
  cancelTurn: cancelCommandCodeTurn,
  respondApproval: respondCommandCodeApproval,
  stopSession: stopCommandCodeSession,
  forgetSession: forgetCommandCodeSession,
  bindSession: bindCommandCodeSession,
  refreshCatalog: refreshCommandCodeCatalog,
};

let registered = false;

export function ensureCommandCodeRegistered(): void {
  if (registered) return;
  registerHarness(commandCodeAdapter);
  registered = true;
}
