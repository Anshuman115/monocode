// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  resetHarnessModelOverlays,
  saveLastModelChoice,
  savePickerProviderVisible,
  setHarnessModels,
} from "../../sessions/model/models";
import { initialQuickChoice, resolveQuickModel } from "./quickComposer";

beforeEach(() => {
  localStorage.clear();
  resetHarnessModelOverlays();
});
afterEach(() => resetHarnessModelOverlays());

it("uses the configured Codex default instead of the last quick-composer model", () => {
  localStorage.setItem("monocode.quickComposerHarness", "cursor");
  localStorage.setItem("monocode.quickComposerModel", "cursor:composer-2.5");
  saveLastModelChoice("codex", "codex:gpt-5.6-luna");
  expect(initialQuickChoice()).toEqual({
    harness: "codex",
    model: "codex:gpt-5.6-luna",
  });
});

it("rereads the Providers default when opening another quick session", () => {
  saveLastModelChoice("cursor", "cursor:composer-2.5");
  expect(initialQuickChoice().harness).toBe("cursor");
  saveLastModelChoice("codex", "codex:gpt-5.6-luna");
  expect(initialQuickChoice()).toEqual({
    harness: "codex",
    model: "codex:gpt-5.6-luna",
  });
});

it("preserves a live-only model until its provider catalog arrives", () => {
  saveLastModelChoice("codex", "codex:gpt-5.6-luna");
  const choice = initialQuickChoice();
  expect(resolveQuickModel(choice)).toBeNull();
  setHarnessModels("codex", [
    { id: "codex:other", name: "Another model", harness: "codex" },
    { id: "codex:gpt-5.6-luna", name: "GPT-5.6-Luna", harness: "codex" },
  ]);
  expect(resolveQuickModel(choice)?.id).toBe("codex:gpt-5.6-luna");
  expect(initialQuickChoice()).toEqual(choice);
});

it("does not replace an explicit default just because its provider tab is hidden", () => {
  saveLastModelChoice("codex", "codex:gpt-5.6-luna");
  savePickerProviderVisible("codex", false);
  expect(initialQuickChoice().harness).toBe("codex");
});
