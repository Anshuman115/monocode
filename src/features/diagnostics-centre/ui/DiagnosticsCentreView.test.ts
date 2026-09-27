// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "../../../platform/tauri/invoke";
import { DiagnosticsCentreView } from "./DiagnosticsCentreView";

// Mock the wrapper (not @tauri-apps/api/core) so the checks' IPC call can be
// driven directly, including into a failure.
vi.mock("../../../platform/tauri/invoke", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

let container: HTMLDivElement;
let root: Root;

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

function button(label: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll("button")).find(
    (node) => node.textContent?.trim() === label,
  );
  if (!match) throw new Error(`no button labelled "${label}"`);
  return match;
}

function setValue(element: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(element, value);
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function selects(): HTMLSelectElement[] {
  return Array.from(container.querySelectorAll("select"));
}

function seedLogs() {
  localStorage.setItem(
    "monocode.diagnosticsLogs",
    JSON.stringify([
      {
        id: "diag_1",
        timestamp: 1_700_000_000_000,
        subsystem: "pty",
        level: "info",
        message: "PTY supervisor attached",
      },
      {
        id: "diag_2",
        timestamp: 1_700_000_001_000,
        subsystem: "network",
        level: "error",
        message: "Relay connection dropped",
      },
    ]),
  );
}

async function render() {
  await act(async () => root.render(createElement(DiagnosticsCentreView)));
  await act(async () => {});
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mockLocalStorage();
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("diagnostics centre", () => {
  it("shows an empty console when nothing was recorded", async () => {
    await render();

    expect(container.textContent).toContain("No diagnostic events recorded.");
  });

  it("filters recorded events by level and by subsystem", async () => {
    seedLogs();
    await render();

    expect(container.textContent).toContain("PTY supervisor attached");
    expect(container.textContent).toContain("Relay connection dropped");

    setValue(selects()[0], "error");
    expect(container.textContent).toContain("Relay connection dropped");
    expect(container.textContent).not.toContain("PTY supervisor attached");

    setValue(selects()[0], "all");
    setValue(selects()[1], "pty");
    expect(container.textContent).toContain("PTY supervisor attached");
    expect(container.textContent).not.toContain("Relay connection dropped");
  });

  it("runs real checks and clears everything", async () => {
    seedLogs();
    await render();

    await act(async () => button("Run Checks").click());

    // The IPC check runs a real invoke, so assert on the outcome it recorded
    // rather than on a canned string.
    expect(container.textContent).toMatch(/IPC round trip/);
    expect(container.textContent).toContain("Diagnostics storage is writable");

    await act(async () => button("Clear Logs").click());

    expect(container.textContent).toContain("No diagnostic events recorded.");
    expect(
      JSON.parse(localStorage.getItem("monocode.diagnosticsLogs") ?? "[]"),
    ).toHaveLength(0);
  });

  it("reports an IPC failure as an error entry", async () => {
    invokeMock.mockRejectedValue(new Error("backend gone"));
    await render();

    await act(async () => button("Run Checks").click());

    expect(container.textContent).toContain("backend gone");
    const logs = JSON.parse(
      localStorage.getItem("monocode.diagnosticsLogs")!,
    ) as { level: string; message: string }[];
    expect(
      logs.some(
        (l) => l.level === "error" && l.message.includes("backend gone"),
      ),
    ).toBe(true);
  });

  it("gives debug its own muted badge instead of the info colour", async () => {
    localStorage.setItem(
      "monocode.diagnosticsLogs",
      JSON.stringify([
        {
          id: "diag_debug",
          timestamp: 1_700_000_000_000,
          subsystem: "skills",
          level: "debug",
          message: "Discovered 3 skills",
        },
      ]),
    );
    await render();

    const badge = Array.from(container.querySelectorAll("span")).find(
      (node) => node.textContent?.trim() === "debug",
    );
    expect(badge).toBeDefined();
    expect(badge!.className).toContain("text-content/45");
    expect(badge!.className).not.toContain("blue-500");
  });
});
