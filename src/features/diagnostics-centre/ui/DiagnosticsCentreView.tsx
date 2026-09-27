import { useEffect, useState, useMemo } from "react";
import {
  loadDiagnosticLogs,
  emitDiagnostic,
  clearDiagnosticLogs,
  type DiagnosticLogEntry,
} from "../model/diagnosticsCentre";
import { runDiagnosticChecks } from "../model/diagnosticsChecks";

/** Debug is intentionally muted: it is high-volume detail, not a signal. */
const LEVEL_CLASS: Record<DiagnosticLogEntry["level"], string> = {
  error: "bg-rose-500/10 text-rose-500",
  warn: "bg-amber-500/10 text-amber-500",
  info: "bg-blue-500/10 text-blue-500",
  debug: "bg-content/5 text-content/45",
};

export function DiagnosticsCentreView() {
  const [logs, setLogs] = useState<DiagnosticLogEntry[]>(loadDiagnosticLogs);
  const [filterLevel, setFilterLevel] = useState<string>("all");
  const [filterSubsystem, setFilterSubsystem] = useState<string>("all");
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const handleUpdate = () => setLogs(loadDiagnosticLogs());
    window.addEventListener("monocode:diagnostics-logs-change", handleUpdate);
    return () =>
      window.removeEventListener(
        "monocode:diagnostics-logs-change",
        handleUpdate,
      );
  }, []);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (filterLevel !== "all" && log.level !== filterLevel) return false;
      if (filterSubsystem !== "all" && log.subsystem !== filterSubsystem)
        return false;
      return true;
    });
  }, [logs, filterLevel, filterSubsystem]);

  /**
   * Actually exercises the plumbing it claims to: a real IPC round trip, the
   * storage write path and the event bus. Each check reports its own outcome,
   * so a failure here is real information rather than a canned "status OK".
   */
  const handleRunChecks = async () => {
    setChecking(true);
    try {
      const results = await runDiagnosticChecks();
      for (const result of results) {
        emitDiagnostic(result.subsystem, result.level, result.message);
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <div
      data-feature="diagnostics"
      className="flex flex-col overflow-hidden rounded-xl border border-content/10 bg-content/3"
    >
      <div className="p-3 bg-content/5 border-b border-content/10 flex items-center justify-end">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRunChecks}
            disabled={checking}
            className="px-2.5 py-1 text-xs rounded border border-content/10 hover:bg-content/5 disabled:opacity-50 text-content font-medium"
          >
            {checking ? "Running…" : "Run Checks"}
          </button>
          <button
            type="button"
            onClick={clearDiagnosticLogs}
            className="px-2.5 py-1 text-xs rounded bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 font-medium"
          >
            Clear Logs
          </button>
        </div>
      </div>

      <div className="p-3 border-b border-content/10 bg-content/5 flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-content/45">Level:</span>
          <select
            value={filterLevel}
            onChange={(e) => setFilterLevel(e.target.value)}
            className="px-2 py-0.5 text-xs rounded border border-content/10 bg-content/2 text-content"
          >
            <option value="all">All</option>
            <option value="info">Info</option>
            <option value="warn">Warn</option>
            <option value="error">Error</option>
            <option value="debug">Debug</option>
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-content/45">Subsystem:</span>
          <select
            value={filterSubsystem}
            onChange={(e) => setFilterSubsystem(e.target.value)}
            className="px-2 py-0.5 text-xs rounded border border-content/10 bg-content/2 text-content"
          >
            <option value="all">All</option>
            <option value="tauri-core">Tauri Core</option>
            <option value="pty">PTY Supervisor</option>
            <option value="harness">Harness RPC</option>
            <option value="storage">Session Storage</option>
            <option value="network">Network/Relay</option>
            <option value="skills">Skills</option>
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-1 bg-content/5">
        {filteredLogs.length === 0 ? (
          <div className="text-center py-6 text-content/45 italic">
            No diagnostic events recorded.
          </div>
        ) : (
          filteredLogs.map((l) => (
            <div key={l.id} className="flex items-start gap-2 py-0.5">
              <span className="text-[10px] text-content/35 whitespace-nowrap">
                {new Date(l.timestamp).toLocaleTimeString()}
              </span>
              <span
                className={`text-[10px] uppercase font-bold px-1 rounded ${LEVEL_CLASS[l.level]}`}
              >
                {l.level}
              </span>
              <span className="text-[10px] text-content/45 px-1 bg-content/5 rounded">
                [{l.subsystem}]
              </span>
              <span className="text-content">{l.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
