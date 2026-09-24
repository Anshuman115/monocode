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
import { registerTranscriptImporter } from "../../core/sessionImport";
import { commandCodeTranscriptImporter } from "./commandCodeTranscript";

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
    approvals: false,
    questions: false,
    nativeResume: true,
    transcriptImport: true,
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
  registerTranscriptImporter(commandCodeTranscriptImporter);
  registered = true;
}
