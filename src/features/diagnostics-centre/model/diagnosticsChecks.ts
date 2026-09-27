import { invoke } from "../../../platform/tauri/invoke";
import {
  emitDiagnostic,
  loadDiagnosticLogs,
  type DiagnosticLevel,
  type DiagnosticLogEntry,
} from "./diagnosticsCentre";

type CheckResult = {
  subsystem: DiagnosticLogEntry["subsystem"];
  level: DiagnosticLevel;
  message: string;
};

/**
 * A real, registered command that is cheap and side-effect free: reading the
 * last workspace snapshot exercises the whole IPC stack without mutating
 * anything. Inventing a dedicated `app_health` command would need a Rust
 * change and a rebuild to say nothing more.
 */
const HEALTH_COMMAND = "workspace_get_snapshot";

/**
 * Real checks behind the Diagnostics Centre's "Run Checks" button. Each one
 * exercises a layer the user is about to depend on and reports what actually
 * happened, so the output is a diagnosis rather than a reassurance.
 */
export async function runDiagnosticChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // 1. IPC round trip: proves the frontend can reach the Rust backend at all.
  try {
    await invoke(HEALTH_COMMAND);
    results.push({
      subsystem: "tauri-core",
      level: "info",
      message: `IPC round trip ok (${HEALTH_COMMAND})`,
    });
  } catch (error) {
    results.push({
      subsystem: "tauri-core",
      level: "error",
      message: `IPC round trip failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }

  // 2. Storage: proves the log buffer itself is writable, since a full or
  //    unavailable store would silently drop every entry above.
  try {
    emitDiagnostic("storage", "debug", "Storage write probe");
    const written = loadDiagnosticLogs().some(
      (entry) => entry.message === "Storage write probe",
    );
    results.push(
      written
        ? {
            subsystem: "storage",
            level: "info",
            message: "Diagnostics storage is writable",
          }
        : {
            subsystem: "storage",
            level: "error",
            message: "Diagnostics storage did not persist the probe entry",
          },
    );
  } catch (error) {
    results.push({
      subsystem: "storage",
      level: "error",
      message: `Diagnostics storage is unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }

  // 3. Event bus: the panel only refreshes when this fires, so a broken
  //    subscription would otherwise look like an empty log.
  try {
    let seen = false;
    const onChange = () => {
      seen = true;
    };
    window.addEventListener("monocode:diagnostics-logs-change", onChange);
    try {
      emitDiagnostic("storage", "debug", "Event bus probe");
    } finally {
      window.removeEventListener("monocode:diagnostics-logs-change", onChange);
    }
    results.push(
      seen
        ? {
            subsystem: "storage",
            level: "info",
            message: "Live log updates are wired up",
          }
        : {
            subsystem: "storage",
            level: "warn",
            message: "The log changed but no update event fired",
          },
    );
  } catch (error) {
    results.push({
      subsystem: "storage",
      level: "error",
      message: `Could not verify live updates: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }

  return results;
}
