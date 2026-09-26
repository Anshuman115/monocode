import { beforeEach, describe, expect, it, vi } from "vitest";

const child = vi.hoisted(() => ({
  execChild: vi.fn(),
  resolveCommandCodeBinary: vi.fn(),
}));

vi.mock("../../core/child", () => child);

import { probeCommandCodeAvailability } from "./commandCodeAvailability";

describe("Command Code availability", () => {
  beforeEach(() => {
    child.resolveCommandCodeBinary.mockReset().mockResolvedValue({
      path: "/fake/command-code",
    });
    child.execChild.mockReset();
  });

  it("marks an unsupported version unavailable", async () => {
    child.execChild.mockResolvedValueOnce("command-code 0.9.0");

    await expect(probeCommandCodeAvailability()).resolves.toEqual({
      available: false,
      detail: expect.objectContaining({ state: "unsupported" }),
    });
  });

  it("rejects a CLI below the verified transport floor without probing it", async () => {
    child.execChild.mockResolvedValueOnce("command-code 1.65.2");

    await expect(probeCommandCodeAvailability()).resolves.toEqual({
      available: false,
      detail: expect.objectContaining({
        state: "unsupported",
        version: "1.65.2",
      }),
    });
    expect(child.execChild).toHaveBeenCalledTimes(1);
  });

  it("requires the CLI's documented JSON headless capability", async () => {
    child.execChild
      .mockResolvedValueOnce("command-code 1.66.0")
      .mockResolvedValueOnce("--print\n--output-format <format>: text only");

    await expect(probeCommandCodeAvailability()).resolves.toEqual({
      available: false,
      detail: expect.objectContaining({
        state: "unsupported",
        version: "1.66.0",
      }),
    });
  });

  it("marks an unauthenticated CLI unavailable", async () => {
    child.execChild
      .mockResolvedValueOnce("command-code 1.66.0")
      .mockResolvedValueOnce("--print\n--output-format <format>: json")
      .mockResolvedValueOnce('{"authenticated":false}');

    await expect(probeCommandCodeAvailability()).resolves.toEqual({
      available: false,
      detail: expect.objectContaining({
        state: "unauthenticated",
        version: "1.66.0",
      }),
    });
  });

  it("marks an unparseable status unavailable", async () => {
    child.execChild
      .mockResolvedValueOnce("command-code 1.66.0")
      .mockResolvedValueOnce("--print\n--output-format <format>: json")
      .mockResolvedValueOnce("not json");

    await expect(probeCommandCodeAvailability()).resolves.toEqual({
      available: false,
      detail: expect.objectContaining({ state: "limited", version: "1.66.0" }),
    });
  });

  it("uses no-auto-update for every probe and accepts verified status", async () => {
    child.execChild
      .mockResolvedValueOnce("command-code 1.66.0")
      .mockResolvedValueOnce(
        "--print\n--output-format <format>: text or json",
      )
      .mockResolvedValueOnce('{"authenticated":true}');

    await expect(probeCommandCodeAvailability()).resolves.toEqual({
      available: true,
      detail: { state: "available", version: "1.66.0" },
    });
    expect(child.execChild).toHaveBeenNthCalledWith(
      1,
      "/fake/command-code",
      ["--no-auto-update", "--version"],
      undefined,
      "command-code",
    );
    expect(child.execChild).toHaveBeenNthCalledWith(
      2,
      "/fake/command-code",
      ["--no-auto-update", "--help"],
      undefined,
      "command-code",
    );
    expect(child.execChild).toHaveBeenNthCalledWith(
      3,
      "/fake/command-code",
      ["--no-auto-update", "status", "--json"],
      undefined,
      "command-code",
    );
  });
});
