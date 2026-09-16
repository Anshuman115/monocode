// @vitest-environment happy-dom
// Keep this as .ts because the project test glob intentionally excludes .test.tsx.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  loginHarness: vi.fn<(_harness: string) => Promise<void>>(),
}));

vi.mock("../lib/harness/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/harness/auth")>()),
  loginHarness: auth.loginHarness,
}));

import { UsageFooter } from "./UsageFooter";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  auth.loginHarness.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function button(label: string): HTMLButtonElement {
  const result = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find(
    (item) => (item.getAttribute("aria-label") ?? item.textContent) === label,
  );
  expect(result, label).toBeDefined();
  return result!;
}

describe("UsageFooter provider authentication", () => {
  it("keeps a healthy Grok provider label non-interactive", () => {
    act(() =>
      root.render(
        createElement(UsageFooter, {
          providers: [],
          session: {
            id: "grok-session",
            harness: "grok",
            authRequired: false,
          },
        }),
      ),
    );

    expect(container.textContent).toContain("grok");
    expect(container.textContent).not.toContain("sign in");
    expect(container.querySelector("button")).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("opens Grok sign-in from its footer provider popover", async () => {
    let finishLogin: (() => void) | undefined;
    auth.loginHarness.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishLogin = resolve;
        }),
    );
    act(() =>
      root.render(
        createElement(UsageFooter, {
          providers: [],
          session: {
            id: "grok-session",
            harness: "grok",
            authRequired: true,
          },
        }),
      ),
    );

    expect(container.textContent).toContain("grok");
    expect(container.textContent).toContain("sign in");
    act(() => button("Grok Build sign-in required").click());

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Authentication required");
    expect(dialog?.querySelector(".size-9")).not.toBeNull();

    act(() => button("Sign in to Grok Build").click());
    expect(auth.loginHarness).toHaveBeenCalledWith("grok");
    expect(dialog?.textContent).toContain("Waiting for browser…");

    await act(async () => finishLogin?.());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).not.toContain("sign in");
  });
});
