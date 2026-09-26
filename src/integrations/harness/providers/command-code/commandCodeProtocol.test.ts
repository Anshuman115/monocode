import { describe, expect, it } from "vitest";
import {
  buildCommandCodeArgs,
  compareCommandCodeVersions,
  parseCommandCodeLine,
  parseCommandCodeVersion,
} from "./commandCodeProtocol";

describe("Command Code protocol", () => {
  it("builds safe structured headless args with explicit resume", () => {
    expect(
      buildCommandCodeArgs({
        text: "continue the task",
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
      "continue the task",
    ]);
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
});
