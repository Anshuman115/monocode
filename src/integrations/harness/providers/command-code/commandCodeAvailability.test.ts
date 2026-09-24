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

  it("distinguishes an installed unauthenticated CLI", async () => {
    child.execChild
      .mockResolvedValueOnce("command-code 1.0.0")
      .mockResolvedValueOnce('{"authenticated":false}');

    await expect(probeCommandCodeAvailability()).resolves.toEqual({
      available: true,
      detail: expect.objectContaining({
        state: "unauthenticated",
        version: "1.0.0",
      }),
    });
  });

  it("reports a version with an unavailable status command as limited", async () => {
    child.execChild
      .mockResolvedValueOnce("command-code 1.0.0")
      .mockRejectedValueOnce(new Error("status unavailable"));

    await expect(probeCommandCodeAvailability()).resolves.toEqual({
      available: true,
      detail: expect.objectContaining({ state: "limited", version: "1.0.0" }),
    });
  });
});
