// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AccessPicker } from "./AccessPicker";
import type { HarnessId } from "../model/session";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

function triggerTitleFor(harness: HarnessId): string {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root.render(
      createElement(AccessPicker, {
        value: "auto",
        harness,
        onChange: vi.fn(),
        onClose: vi.fn(),
      }),
    ),
  );
  return (
    container
      .querySelector<HTMLButtonElement>("[data-access-picker-trigger]")
      ?.getAttribute("title") ?? ""
  );
}

it("describes a provider that cannot approve tools by what it can do", () => {
  const title = triggerTitleFor("command-code");
  expect(title).toContain("Read-only");
  expect(title).toContain("no reviewer");
  expect(title).not.toContain("An AI reviewer can approve or deny actions");
});

it("keeps the stock wording for a provider that can approve", () => {
  expect(triggerTitleFor("claude")).toContain(
    "An AI reviewer can approve or deny actions",
  );
});
