// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { installDiagnosticsCapture } from "./diagnosticsCapture";
import { loadDiagnosticLogs, clearDiagnosticLogs } from "../../features/diagnostics-centre/model/diagnosticsCentre";

function mockLocalStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  });
}

describe("diagnostics capture", () => {
  let target: EventTarget & { addEventListener: typeof window.addEventListener; removeEventListener: typeof window.removeEventListener };
  let listeners: Map<string, EventListener>;
  let uninstall: () => void;

  beforeEach(() => {
    mockLocalStorage();
    clearDiagnosticLogs();
    listeners = new Map();
    target = {
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        listeners.set(type, listener);
      }) as unknown as typeof window.addEventListener,
      removeEventListener: vi.fn((type: string) => {
        listeners.delete(type);
      }) as unknown as typeof window.removeEventListener,
    } as unknown as typeof target;
    uninstall = installDiagnosticsCapture(target as unknown as Window);
  });

  afterEach(() => {
    uninstall();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("registers exactly one error and one unhandledrejection listener", () => {
    expect(listeners.has("error")).toBe(true);
    expect(listeners.has("unhandledrejection")).toBe(true);
  });

  it("records uncaught errors as a diagnostic entry with message and stack", () => {
    const error = new Error("boom");
    const handler = listeners.get("error")!;
    handler({
      message: "boom",
      error,
      filename: "app.tsx",
      lineno: 42,
      colno: 7,
    } as unknown as ErrorEvent);

    const logs = loadDiagnosticLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe("error");
    expect(logs[0].message).toBe("boom");
    expect(logs[0].context?.stack).toBe(error.stack);
    expect(logs[0].context?.filename).toBe("app.tsx");
  });

  it("records unhandled promise rejections, including non-Error reasons", () => {
    const handler = listeners.get("unhandledrejection")!;
    handler({ reason: new Error("rejected!") } as unknown as PromiseRejectionEvent);
    handler({ reason: "a plain string reason" } as unknown as PromiseRejectionEvent);
    handler({ reason: { weird: "object" } } as unknown as PromiseRejectionEvent);

    const logs = loadDiagnosticLogs();
    expect(logs).toHaveLength(3);
    expect(logs[0].message).toBe("rejected!");
    expect(logs[1].message).toBe("a plain string reason");
    expect(logs[2].message).toBe("Unhandled promise rejection");
    expect(logs.every((log) => log.level === "error")).toBe(true);
  });

  it("never throws back out of the handler even if emitDiagnostic-adjacent state is broken", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("storage exploded");
      },
      setItem: () => {
        throw new Error("storage exploded");
      },
    });

    const handler = listeners.get("error")!;
    expect(() =>
      handler({ message: "boom", error: new Error("boom") } as unknown as ErrorEvent),
    ).not.toThrow();
  });

  it("removes both listeners on uninstall", () => {
    uninstall();
    expect(listeners.size).toBe(0);
  });
});
