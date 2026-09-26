import { emitDiagnostic } from "../../features/diagnostics-centre/model/diagnosticsCentre";

/**
 * Wires the Diagnostics Centre up to real runtime failures instead of the
 * "Simulate Log" button's canned messages: any uncaught error or unhandled
 * promise rejection anywhere in the app is recorded automatically.
 *
 * There is no central `invoke()` wrapper in this codebase (every feature
 * imports `invoke` from `@tauri-apps/api/core` directly), so failed Tauri
 * calls aren't captured here — that would need a wider refactor across ~40
 * call sites, which is out of scope for wiring up automatic capture. Most
 * `invoke` failures that matter end up surfacing as thrown errors or
 * rejected promises in the calling code anyway, so a chunk of them still
 * reach this handler indirectly.
 *
 * Safe by construction: every listener body is wrapped in try/catch, and
 * `emitDiagnostic` only touches localStorage, so nothing here can throw back
 * into the window's error handling and loop.
 */
export function installDiagnosticsCapture(target: Window = window): () => void {
  const handleError = (event: ErrorEvent) => {
    try {
      const error = event.error;
      emitDiagnostic(
        "harness",
        "error",
        event.message || (error instanceof Error ? error.message : "Uncaught error"),
        {
          stack: error instanceof Error ? error.stack : undefined,
          filename: event.filename || undefined,
          lineno: event.lineno || undefined,
          colno: event.colno || undefined,
        },
      );
    } catch {
      // Diagnostics capture must never itself throw, or it would recurse
      // back into this same error handler.
    }
  };

  const handleRejection = (event: PromiseRejectionEvent) => {
    try {
      const reason = event.reason;
      const message =
        reason instanceof Error
          ? reason.message
          : typeof reason === "string"
            ? reason
            : "Unhandled promise rejection";
      emitDiagnostic("harness", "error", message, {
        stack: reason instanceof Error ? reason.stack : undefined,
      });
    } catch {
      // See handleError: never let capture throw back into the app.
    }
  };

  target.addEventListener("error", handleError);
  target.addEventListener("unhandledrejection", handleRejection);

  return () => {
    target.removeEventListener("error", handleError);
    target.removeEventListener("unhandledrejection", handleRejection);
  };
}
