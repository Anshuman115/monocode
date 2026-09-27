import {
  invoke as tauriInvoke,
  type InvokeOptions,
} from "@tauri-apps/api/core";
import { emitDiagnostic } from "../../features/diagnostics-centre/model/diagnosticsCentre";

/**
 * Every Tauri command call in the app goes through here, so a Rust-side
 * failure becomes a Diagnostics Centre entry instead of a toast that vanishes.
 *
 * This deliberately does not swallow or alter the rejection: callers keep their
 * existing `.catch` handling, and the entry is purely additive. The wrapped
 * call is also left un-awaited by the diagnostic path, so a slow or throwing
 * logger can never delay or fail the operation the caller actually asked for.
 *
 * Importing `invoke` from `@tauri-apps/api/core` and re-exporting it keeps
 * every existing `vi.mock("@tauri-apps/api/core")` in the test suite working:
 * those tests mock the underlying module, which this wrapper still calls.
 */

/** Command names that fire on ordinary, expected paths and would only add noise. */
const QUIET_COMMANDS = new Set([
  // Polled continuously by the UI; a failure is surfaced by the feature itself.
  "pty_status",
  "quit_poll",
  "inbox_unseen_count",
]);

/**
 * Commands that reach a remote service. A failure here means the user's
 * network, credentials or remote service is at fault, not the local process,
 * so it is filed under `network` rather than `tauri-core` and reads far more
 * usefully when triaging a report.
 */
const NETWORK_PREFIXES = [
  "git_github_",
  "gitlab_",
  "jira_",
  "linear_",
  "azure_devops_",
  "fetch_",
];

function subsystemFor(cmd: string): "tauri-core" | "network" {
  return NETWORK_PREFIXES.some((prefix) => cmd.startsWith(prefix))
    ? "network"
    : "tauri-core";
}

function describeArgs(args: unknown): Record<string, unknown> | undefined {
  if (args == null) return undefined;
  if (typeof args !== "object") return { args };
  const entries = Object.entries(args as Record<string, unknown>);
  // Absolute paths and message bodies are noise in a shared log; keep shapes.
  const safe: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (typeof value === "string" && value.length > 120) {
      safe[key] = `<string ${value.length} chars>`;
    } else {
      safe[key] = value;
    }
  }
  return Object.keys(safe).length ? safe : undefined;
}

export async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
  options?: InvokeOptions,
): Promise<T> {
  try {
    // Only forward the arguments that are actually set. An explicit
    // `undefined` still registers as a positional argument in the recorded
    // call, which would break every `toHaveBeenCalledWith(cmd)` /
    // `toHaveBeenCalledWith(cmd, args)` assertion in the suite.
    if (options !== undefined) return await tauriInvoke<T>(cmd, args, options);
    if (args !== undefined) return await tauriInvoke<T>(cmd, args);
    return await tauriInvoke<T>(cmd);
  } catch (error) {
    if (!QUIET_COMMANDS.has(cmd)) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        emitDiagnostic(
          subsystemFor(cmd),
          "error",
          `${cmd} failed: ${message}`,
          { command: cmd, args: describeArgs(args) },
        );
      } catch {
        // Diagnostics must never mask or replace the original failure.
      }
    }
    throw error;
  }
}

export default invoke;
