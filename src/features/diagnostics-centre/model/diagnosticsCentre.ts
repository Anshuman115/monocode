export type DiagnosticLevel = "info" | "warn" | "error" | "debug";

export type DiagnosticLogEntry = {
  id: string;
  timestamp: number;
  subsystem: "tauri-core" | "pty" | "harness" | "storage" | "network" | "skills";
  level: DiagnosticLevel;
  message: string;
  context?: Record<string, any>;
};

const DIAGNOSTICS_STORAGE_KEY = "monocode.diagnosticsLogs";

/** Ring buffer size. Kept in sync with the `.slice(-N)` truncation below. */
const MAX_DIAGNOSTIC_ENTRIES = 200;

export function loadDiagnosticLogs(): DiagnosticLogEntry[] {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(DIAGNOSTICS_STORAGE_KEY) : null;
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    // Guard against corrupted/foreign values under the same key (e.g. an
    // object or a stray primitive) rather than handing callers a non-array.
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function makeEntryId(): string {
  return "diag_" + Math.random().toString(36).substring(2, 9);
}

export function saveDiagnosticLogs(logs: DiagnosticLogEntry[]): void {
  let next = logs;
  if (logs.length > MAX_DIAGNOSTIC_ENTRIES) {
    const droppedCount = logs.length - MAX_DIAGNOSTIC_ENTRIES;
    const message = `Diagnostic log truncated: dropped ${droppedCount} oldest entr${
      droppedCount === 1 ? "y" : "ies"
    } to stay within the ${MAX_DIAGNOSTIC_ENTRIES}-entry limit.`;
    // Console-visible signal for developers, plus a meta entry appended
    // below so the truncation itself is visible inside the panel — this
    // is constructed directly rather than via emitDiagnostic() to avoid
    // recursing back into saveDiagnosticLogs().
    console.warn(`[diagnostics] ${message}`);
    const meta: DiagnosticLogEntry = {
      id: makeEntryId(),
      timestamp: Date.now(),
      subsystem: "storage",
      level: "warn",
      message,
    };
    next = [...logs.slice(-(MAX_DIAGNOSTIC_ENTRIES - 1)), meta];
  }
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(DIAGNOSTICS_STORAGE_KEY, JSON.stringify(next));
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("monocode:diagnostics-logs-change"));
  }
}

export function emitDiagnostic(
  subsystem: DiagnosticLogEntry["subsystem"],
  level: DiagnosticLevel,
  message: string,
  context?: Record<string, any>
): DiagnosticLogEntry {
  const current = loadDiagnosticLogs();
  const entry: DiagnosticLogEntry = {
    id: makeEntryId(),
    timestamp: Date.now(),
    subsystem,
    level,
    message,
    context,
  };
  current.push(entry);
  saveDiagnosticLogs(current);
  return entry;
}

export function clearDiagnosticLogs(): void {
  saveDiagnosticLogs([]);
}
