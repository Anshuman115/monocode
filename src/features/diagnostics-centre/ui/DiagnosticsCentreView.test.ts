// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiagnosticsCentreView } from "./DiagnosticsCentreView";

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

  it("emits a probe event into the log and clears everything", async () => {
    seedLogs();
    await render();

    await act(async () => button("Emit Probe").click());

    expect(
      JSON.parse(localStorage.getItem("monocode.diagnosticsLogs")!),
    ).toHaveLength(3);
    expect(container.textContent).toContain(
      "Subsystem diagnostic check completed with status OK",
    );

    await act(async () => button("Clear Logs").click());

    expect(container.textContent).toContain("No diagnostic events recorded.");
    expect(
      JSON.parse(localStorage.getItem("monocode.diagnosticsLogs") ?? "[]"),
    ).toHaveLength(0);
  });
});
