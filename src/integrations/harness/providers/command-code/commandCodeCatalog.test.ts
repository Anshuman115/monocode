import { describe, expect, it, vi } from "vitest";

const child = vi.hoisted(() => ({
  execChild: vi.fn(),
  resolveCommandCodeBinary: vi.fn(),
}));

vi.mock("../../core/child", () => ({
  execChild: child.execChild,
  resolveCommandCodeBinary: child.resolveCommandCodeBinary,
}));

vi.mock("../../../../platform/tauri/fs", () => ({
  homeDir: async () => "/home/test",
}));

import {
  discoverCommandCodeModels,
  parseCommandCodeModelList,
  withProviderContextWindow,
} from "./commandCodeCatalog";

describe("Command Code model catalog", () => {
  it("parses model ids while skipping headings and deduplicating", () => {
    const models = parseCommandCodeModelList(`
Available models  ·  2 models

Open Source
deepseek/deepseek-v4.1-flash           fast reasoning
deepseek/deepseek-v4.1-flash           duplicate
Anthropic
claude-sonnet-5                         recommended
`);
    expect(models.map((model) => model.nativeId)).toEqual([
      "deepseek/deepseek-v4.1-flash",
      "claude-sonnet-5",
    ]);
    expect(models[0]?.id).toBe("command-code:deepseek/deepseek-v4.1-flash");
    // No window in the list: it is only applied from the reported status.
    expect(models[0]?.contextWindow).toBeUndefined();
    expect(models.map((model) => model.name)).toEqual([
      "DeepSeek V4.1 Flash",
      "Claude Sonnet 5",
    ]);
    expect(models[0]?.settings).toEqual([
      expect.objectContaining({
        id: "effort",
        kind: "select",
        value: "default",
      }),
    ]);
    expect(
      models[0]?.settings?.[0]?.options.map((option) => option.value),
    ).toEqual(["default", "low", "medium", "high"]);
  });

  it("applies the reported window to the active model only", () => {
    const models = parseCommandCodeModelList(`
Available models  ·  2 models

Open Source
deepseek/deepseek-v4-flash             fast reasoning
claude-sonnet-5                        recommended
`);
    const withWindow = withProviderContextWindow(models, {
      authenticated: true,
      model: "deepseek/deepseek-v4-flash",
      contextWindow: 1_000_000,
    });
    expect(withWindow[0]?.contextWindow).toBe(1_000_000);
    expect(withWindow[1]?.contextWindow).toBeUndefined();
    expect(withProviderContextWindow(models, { authenticated: true })).toEqual(
      models,
    );
    expect(withProviderContextWindow(models, null)).toEqual(models);
  });

  it("does not turn provider headings or documentation into models", () => {
    const models = parseCommandCodeModelList(`
Stealth
stealth/space-bunny-alpha              free
Anthropic
claude-sonnet-5                         recommended
Docs:  https://commandcode.ai/docs
Decision models (headless only)
typesafe/jev                            typed questions
`);

    expect(models.map((model) => model.nativeId)).toEqual([
      "stealth/space-bunny-alpha",
      "claude-sonnet-5",
      "typesafe/jev",
    ]);
  });

  it("rejects a truncated model list", () => {
    expect(() =>
      parseCommandCodeModelList(`
Available models  ·  81 models

Open Source
deepseek/deepseek-v4.1-flash           fast reasoning
`),
    ).toThrow("expected at least 81 models, received 1");
  });

  it("tags every catalog probe with the provider so the exec gate accepts it", async () => {
    child.resolveCommandCodeBinary.mockReset().mockResolvedValue({
      path: "/fake/command-code",
    });
    child.execChild
      .mockReset()
      .mockResolvedValueOnce("command-code 1.66.0")
      .mockResolvedValueOnce(
        "Available models  ·  1 models\n\nOpen Source\ndeepseek/deepseek-v4.1-flash           fast reasoning\n",
      )
      .mockResolvedValueOnce(
        '{"authenticated":true,"model":"deepseek/deepseek-v4.1-flash","context_window":1000}',
      );

    const models = await discoverCommandCodeModels();

    expect(models[0]?.contextWindow).toBe(1000);
    expect(child.execChild).toHaveBeenNthCalledWith(
      1,
      "/fake/command-code",
      ["--no-auto-update", "--version"],
      "/home/test",
      "command-code",
    );
    expect(child.execChild).toHaveBeenNthCalledWith(
      2,
      "/fake/command-code",
      ["--no-auto-update", "--list-models"],
      "/home/test",
      "command-code",
    );
    expect(child.execChild).toHaveBeenNthCalledWith(
      3,
      "/fake/command-code",
      ["--no-auto-update", "status", "--json"],
      "/home/test",
      "command-code",
    );
  });
});
