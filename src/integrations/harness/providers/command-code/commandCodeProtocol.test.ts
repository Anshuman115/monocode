import { describe, expect, it } from "vitest";
import {
  buildCommandCodeArgs,
  commandCodePermissionArgs,
  compareCommandCodeVersions,
  hasCommandCodeJsonHeadlessSupport,
  parseCommandCodeLine,
  parseCommandCodeStatus,
  parseCommandCodeVersion,
  modelNameFromCatalogId,
  redactCommandCodeDiagnostic,
} from "./commandCodeProtocol";

describe("Command Code protocol", () => {
  it("builds safe structured headless args with explicit resume", () => {
    expect(
      buildCommandCodeArgs({
        model: "deepseek/deepseek-v4.1-flash",
        effort: "high",
        runtimeMode: "full-access",
        resume: "bc14e2c3-d9d2-4a03-b6cd-cea07b15963b",
      }),
    ).toEqual([
      "--output-format",
      "json",
      "--skip-onboarding",
      "--no-auto-update",
      "--max-turns",
      "100",
      "--yolo",
      "--model",
      "deepseek/deepseek-v4.1-flash",
      "--effort",
      "high",
      "--print",
      "--resume",
      "bc14e2c3-d9d2-4a03-b6cd-cea07b15963b",
    ]);
  });

  it("only grants full access to the one mode that can approve its own tools", () => {
    expect(commandCodePermissionArgs("full-access")).toEqual(["--yolo"]);
    // Headless `--print` cannot answer an approval prompt, so these modes must
    // not quietly become full access: the blocked-tool handler explains instead.
    expect(commandCodePermissionArgs("auto")).toEqual([]);
    expect(commandCodePermissionArgs("supervised")).toEqual([]);
    expect(commandCodePermissionArgs("auto-accept-edits")).toEqual([]);
    expect(commandCodePermissionArgs("supervised", "plan")).toEqual(["--plan"]);
  });

  it("parses structured events and ignores unknown or malformed frames", () => {
    expect(
      parseCommandCodeLine(
        '{"type":"event","event":{"type":"text_delta","delta":"hi"}}',
      ),
    ).toEqual({
      kind: "event",
      event: { type: "text_delta", delta: "hi" },
    });
    expect(parseCommandCodeLine('{"type":"future","value":1}')).toBeNull();
    expect(parseCommandCodeLine("not json")).toBeNull();
  });

  it("preserves whitespace in streamed text deltas", () => {
    expect(
      parseCommandCodeLine(
        '{"type":"event","event":{"type":"text_delta","delta":" hi "}}',
      ),
    ).toMatchObject({ event: { delta: " hi " } });
  });

  it("parses versions and compares prerelease-safe numeric components", () => {
    expect(parseCommandCodeVersion("Command Code v1.62.1")).toBe("1.62.1");
    expect(compareCommandCodeVersions("1.62.1", "1.0.0")).toBeGreaterThan(0);
    expect(compareCommandCodeVersions("0.9.9", "1.0.0")).toBeLessThan(0);
  });

  it("verifies JSON headless support from help instead of version", () => {
    expect(
      hasCommandCodeJsonHeadlessSupport(
        "-p, --print [query]\n--output-format <format> text or json",
      ),
    ).toBe(true);
    expect(
      hasCommandCodeJsonHeadlessSupport(
        "-p, --print [query]\n--output-format <format> text only",
      ),
    ).toBe(false);
  });

  it("accepts only boolean authenticated status", () => {
    expect(parseCommandCodeStatus('{"authenticated":true}')).toEqual({
      authenticated: true,
    });
    expect(parseCommandCodeStatus('{"authenticated":"true"}')).toBeNull();
    expect(parseCommandCodeStatus("not json")).toBeNull();
  });

  it("carries the provider-reported window for the active model", () => {
    expect(
      parseCommandCodeStatus(
        '{"authenticated":true,"user":"me","model":"deepseek/deepseek-v4-flash","context_window":1000000}',
      ),
    ).toEqual({
      authenticated: true,
      model: "deepseek/deepseek-v4-flash",
      contextWindow: 1_000_000,
    });
    // A status without a usable window keeps the field absent rather than 0.
    expect(parseCommandCodeStatus('{"authenticated":true,"context_window":0}')).toEqual({
      authenticated: true,
    });
  });

  it("redacts credential diagnostics without leaving a replacement token", () => {
    expect(redactCommandCodeDiagnostic("token=secret-value")).toBe(
      "token=[redacted]",
    );
  });

  it("preserves provider acronym casing in model labels", () => {
    expect(modelNameFromCatalogId("deepseek/deepseek-v4.1-flash")).toBe(
      "DeepSeek V4.1 Flash",
    );
    expect(modelNameFromCatalogId("openai/gpt-5.4-mini")).toBe(
      "GPT 5.4 Mini",
    );
    expect(modelNameFromCatalogId("z-ai/glm-5.3-flash")).toBe(
      "GLM 5.3 Flash",
    );
    expect(modelNameFromCatalogId("qwen/qwen3.8-max")).toBe(
      "Qwen3.8 Max",
    );
    expect(modelNameFromCatalogId("xiaomi/mimo-v2.6-pro")).toBe(
      "MiMo V2.6 Pro",
    );
  });
});
