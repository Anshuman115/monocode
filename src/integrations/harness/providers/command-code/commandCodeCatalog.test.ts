import { describe, expect, it } from "vitest";
import { parseCommandCodeModelList } from "./commandCodeCatalog";

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
    expect(models.map((model) => model.name)).toEqual([
      "Deepseek V4.1 Flash",
      "Claude Sonnet 5",
    ]);
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
});
