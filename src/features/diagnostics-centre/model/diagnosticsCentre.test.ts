import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  loadDiagnosticLogs,
  saveDiagnosticLogs,
  emitDiagnostic,
  clearDiagnosticLogs,
  type DiagnosticLogEntry,
} from "./diagnosticsCentre";

function mockLocalStorage() {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    writable: true,
    configurable: true,
  });
}

describe("diagnostics centre", () => {
  beforeEach(() => {
    mockLocalStorage();
    localStorage.clear();
  });

  it("records diagnostic events and clears logs", () => {
    expect(loadDiagnosticLogs()).toEqual([]);

    emitDiagnostic("pty", "error", "PTY stream broken");
    const logs = loadDiagnosticLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].subsystem).toBe("pty");
    expect(logs[0].level).toBe("error");

    clearDiagnosticLogs();
    expect(loadDiagnosticLogs()).toEqual([]);
  });

  it("treats malformed JSON in storage as an empty log", () => {
    localStorage.setItem("monocode.diagnosticsLogs", "{not valid json");
    expect(loadDiagnosticLogs()).toEqual([]);
  });

  it("treats well-formed but non-array JSON in storage as an empty log", () => {
    localStorage.setItem("monocode.diagnosticsLogs", JSON.stringify({ oops: true }));
    expect(loadDiagnosticLogs()).toEqual([]);

    localStorage.setItem("monocode.diagnosticsLogs", JSON.stringify("just a string"));
    expect(loadDiagnosticLogs()).toEqual([]);
  });

  it("truncates to the 200-entry ring buffer and appends a visible meta warning", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const entries: DiagnosticLogEntry[] = Array.from({ length: 205 }, (_, i) => ({
      id: `diag_${i}`,
      timestamp: i,
      subsystem: "pty",
      level: "info",
      message: `entry ${i}`,
    }));
    saveDiagnosticLogs(entries);

    const stored = loadDiagnosticLogs();
    expect(stored).toHaveLength(200);
    // The oldest 6 entries (205 - 199 kept + 1 meta slot) are dropped; the
    // newest real entries survive, in order, followed by the meta warning.
    expect(stored[0].message).toBe("entry 6");
    expect(stored[stored.length - 2].message).toBe("entry 204");

    const meta = stored[stored.length - 1];
    expect(meta.level).toBe("warn");
    expect(meta.subsystem).toBe("storage");
    expect(meta.message).toContain("truncated");
    expect(meta.message).toContain("5 oldest entries");

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("truncated");

    warnSpy.mockRestore();
  });

  it("does not truncate or warn when at or under the entry limit", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const entries: DiagnosticLogEntry[] = Array.from({ length: 200 }, (_, i) => ({
      id: `diag_${i}`,
      timestamp: i,
      subsystem: "network",
      level: "info",
      message: `entry ${i}`,
    }));
    saveDiagnosticLogs(entries);

    expect(loadDiagnosticLogs()).toHaveLength(200);
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("supports the debug level and skills subsystem", () => {
    const entry = emitDiagnostic("skills", "debug", "Skill discovery scan finished");
    expect(entry.subsystem).toBe("skills");
    expect(entry.level).toBe("debug");
    expect(loadDiagnosticLogs()).toHaveLength(1);
  });
});
