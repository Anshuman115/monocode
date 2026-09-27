import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDiagnosticLogs,
  loadDiagnosticLogs,
} from "../../features/diagnostics-centre/model/diagnosticsCentre";
import { invoke } from "./invoke";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function mockLocalStorage() {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
      clear: () => data.clear(),
      key: (i: number) => [...data.keys()][i] ?? null,
      get length() {
        return data.size;
      },
    },
    configurable: true,
    writable: true,
  });
}

const invokeMock = vi.mocked(tauriInvoke);

describe("invoke", () => {
  beforeEach(() => {
    mockLocalStorage();
    clearDiagnosticLogs();
    invokeMock.mockReset();
  });

  it("returns the value and records nothing on success", async () => {
    invokeMock.mockResolvedValue("ok");
    await expect(invoke<string>("list_skills", { cwd: "/a" })).resolves.toBe(
      "ok",
    );
    expect(loadDiagnosticLogs()).toEqual([]);
  });

  it("records the command and message when the call rejects", async () => {
    invokeMock.mockRejectedValue(new Error("no such file"));
    await expect(invoke("read_text_file", { path: "/a" })).rejects.toThrow(
      "no such file",
    );

    const logs = loadDiagnosticLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].subsystem).toBe("tauri-core");
    expect(logs[0].level).toBe("error");
    expect(logs[0].message).toContain("read_text_file failed");
    expect(logs[0].message).toContain("no such file");
    expect(logs[0].context?.command).toBe("read_text_file");
  });

  it("files remote-service failures under network, not tauri-core", async () => {
    invokeMock.mockRejectedValue(new Error("401"));
    await expect(
      invoke("gitlab_list_work_items", { cwd: "/a" }),
    ).rejects.toThrow();
    expect(loadDiagnosticLogs()[0].subsystem).toBe("network");

    invokeMock.mockRejectedValue(new Error("offline"));
    await expect(invoke("read_text_file", { path: "/a" })).rejects.toThrow();
    expect(loadDiagnosticLogs()[1].subsystem).toBe("tauri-core");
  });

  it("re-throws so existing call-site handling still runs", async () => {
    invokeMock.mockRejectedValue(new Error("boom"));
    await expect(invoke("pty_spawn", { id: "1" })).rejects.toThrow("boom");
    // The rejection is additive: the caller still has to catch it.
    expect(loadDiagnosticLogs()).toHaveLength(1);
  });

  it("stays quiet for commands that fail on ordinary paths", async () => {
    invokeMock.mockRejectedValue(new Error("gone"));
    await expect(invoke("pty_status", { id: "1" })).rejects.toThrow();
    expect(loadDiagnosticLogs()).toEqual([]);
  });

  it("truncates long string arguments instead of logging file bodies", async () => {
    invokeMock.mockRejectedValue(new Error("boom"));
    const long = "x".repeat(500);
    await expect(invoke("read_text_file", { path: long })).rejects.toThrow();

    const context = loadDiagnosticLogs()[0].context as {
      args: Record<string, string>;
    };
    expect(context.args.path).toBe("<string 500 chars>");
  });

  it("forwards only the arguments the caller actually passed", async () => {
    invokeMock.mockResolvedValue(undefined);

    await invoke("destroy_window");
    expect(invokeMock).toHaveBeenLastCalledWith("destroy_window");

    await invoke("list_skills", { cwd: "/a" });
    expect(invokeMock).toHaveBeenLastCalledWith("list_skills", { cwd: "/a" });

    await invoke("custom", { a: 1 }, { headers: {} });
    expect(invokeMock).toHaveBeenLastCalledWith(
      "custom",
      { a: 1 },
      { headers: {} },
    );
  });

  it("never lets a diagnostic failure replace the original error", async () => {
    invokeMock.mockRejectedValue(new Error("original"));
    // Break storage so emitDiagnostic throws inside the catch block.
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: () => {
          throw new Error("storage exploded");
        },
        setItem: () => {
          throw new Error("storage exploded");
        },
      },
      configurable: true,
      writable: true,
    });

    await expect(invoke("boom_cmd")).rejects.toThrow("original");
  });
});
