import { beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
  args: [] as string[],
  written: [] as string[],
  onLine: undefined as ((line: string) => void) | undefined,
  onExit: undefined as ((code: number | null) => void) | undefined,
  removedExit: undefined as ((code: number | null) => void) | undefined,
  spawnChild: vi.fn(),
  killChild: vi.fn(),
  unwatchChild: vi.fn(),
  writeChild: vi.fn(),
  closeChildStdin: vi.fn(),
}));

vi.mock("../../core/child", () => ({
  resolveCommandCodeBinary: async () => ({ path: "/fake/command-code" }),
  spawnChild: transport.spawnChild,
  killChild: transport.killChild,
  unwatchChild: transport.unwatchChild,
  writeChild: transport.writeChild,
  closeChildStdin: transport.closeChildStdin,
  watchChild: (
    _id: string,
    onLine: (line: string) => void,
    onExit: (code: number | null) => void,
  ) => {
    transport.onLine = onLine;
    transport.onExit = onExit;
  },
}));

import {
  cancelCommandCodeTurn,
  sendCommandCodeTurn,
  stopCommandCodeSession,
} from "./commandCode";
import type { HarnessEvent } from "../../core/types";

function emit(record: Record<string, unknown>): void {
  transport.onLine?.(JSON.stringify(record));
}

describe("Command Code structured transport", () => {
  beforeEach(() => {
    transport.args = [];
    transport.written = [];
    transport.onLine = undefined;
    transport.onExit = undefined;
    transport.removedExit = undefined;
    transport.spawnChild
      .mockReset()
      .mockImplementation(
        async (_id: string, _path: string, args: string[]) => {
          transport.args = args;
        },
      );
    transport.writeChild
      .mockReset()
      .mockImplementation(async (_id: string, line: string) => {
        transport.written.push(line);
      });
    transport.closeChildStdin.mockReset().mockResolvedValue(undefined);
    transport.unwatchChild.mockReset().mockImplementation(() => {
      transport.removedExit = transport.onExit;
      transport.onLine = undefined;
      transport.onExit = undefined;
    });
    transport.killChild.mockReset().mockImplementation(async () => {
      transport.unwatchChild();
    });
  });

  it("streams a fake JSON transport and binds the native session", async () => {
    const events: HarnessEvent[] = [];
    const turn = sendCommandCodeTurn({
      sessionId: "mono-thread",
      cwd: "/repo",
      model: "command-code:deepseek/deepseek-v4.1-flash",
      modelSettings: { effort: "high" },
      runtimeMode: "supervised",
      text: "Read README.md",
      attachments: [],
      onEvent: (event) => events.push(event),
    });

    await vi.waitFor(() => expect(transport.args).toHaveLength(11));
    expect(transport.args).toEqual([
      "--output-format",
      "json",
      "--skip-onboarding",
      "--no-auto-update",
      "--max-turns",
      "100",
      "--model",
      "deepseek/deepseek-v4.1-flash",
      "--effort",
      "high",
      "--print",
    ]);
    // The prompt goes over stdin: argv is world-readable and size-capped.
    expect(transport.written).toEqual(["Read README.md"]);
    expect(transport.closeChildStdin).toHaveBeenCalledWith("mono-thread");
    emit({
      type: "event",
      event: { type: "run_start", sessionId: "cc-session-1" },
    });
    emit({ type: "event", event: { type: "turn_start", turnNumber: 1 } });
    emit({ type: "event", event: { type: "message_start" } });
    emit({ type: "event", event: { type: "text_delta", delta: "Done" } });
    emit({
      type: "event",
      event: {
        type: "tool_queued",
        toolCallId: "read-1",
        toolName: "read_file",
        input: { path: "README.md" },
      },
    });
    emit({
      type: "event",
      event: {
        type: "tool_completed",
        toolCallId: "read-1",
        toolName: "read_file",
        result: { content: [{ type: "text", text: "ok" }] },
      },
    });
    emit({ type: "event", event: { type: "message_end" } });
    emit({
      type: "result",
      subtype: "success",
      usage: { inputTokens: 4, outputTokens: 2 },
    });
    transport.onExit?.(0);
    await turn;

    expect(events).toContainEqual({
      type: "session.providerBound",
      providerSessionId: "cc-session-1",
    });
    expect(events).toContainEqual({ type: "message.delta", text: "Done" });
    expect(events).toContainEqual(
      expect.objectContaining({ type: "tool.started", callId: "read-1" }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool.updated",
        callId: "read-1",
        status: "completed",
        detail: "ok",
      }),
    );
    expect(events).toContainEqual({
      type: "turn.metrics",
      inputTokens: 4,
      outputTokens: 2,
    });
    expect(events).toContainEqual({ type: "session.ended", code: 0 });
    expect(
      events.filter((event) => event.type === "session.error"),
    ).toHaveLength(0);
  });

  it("sends attachment paths over stdin, never in argv", async () => {
    const turn = sendCommandCodeTurn({
      sessionId: "attachment-thread",
      cwd: "/repo",
      model: "command-code:deepseek/deepseek-v4.1-flash",
      runtimeMode: "supervised",
      text: "Look at this",
      attachments: [
        {
          id: "a1",
          name: "shot.png",
          mimeType: "image/png",
          kind: "image",
          size: 12,
          path: "/tmp/shot.png",
        },
      ],
      onEvent: () => undefined,
    });

    await vi.waitFor(() => expect(transport.written).toHaveLength(1));
    expect(transport.written[0]).toContain("Attached file (read from disk)");
    expect(transport.written[0]).toContain("/tmp/shot.png");
    expect(transport.args.join(" ")).not.toContain("shot.png");

    emit({ type: "event", event: { type: "run_start", sessionId: "cc-2" } });
    emit({ type: "result", subtype: "success", finalText: "ok" });
    transport.onExit?.(0);
    await turn;
  });

  it("settles a cancelled turn when killing the child removes its exit watcher", async () => {
    const turn = sendCommandCodeTurn({
      sessionId: "cancel-thread",
      cwd: "/repo",
      model: "command-code:deepseek/deepseek-v4.1-flash",
      runtimeMode: "supervised",
      text: "Keep working",
      attachments: [],
      onEvent: () => undefined,
    });

    await vi.waitFor(() => expect(transport.args).not.toHaveLength(0));
    await cancelCommandCodeTurn("cancel-thread");

    try {
      await expect(
        Promise.race([
          turn.then(() => "settled"),
          new Promise<"timed out">((resolve) =>
            setTimeout(() => resolve("timed out"), 50),
          ),
        ]),
      ).resolves.toBe("settled");
    } finally {
      transport.removedExit?.(130);
      await turn;
    }
  });

  it("settles a stopped turn when killing the child removes its exit watcher", async () => {
    const events: HarnessEvent[] = [];
    const turn = sendCommandCodeTurn({
      sessionId: "stop-thread",
      cwd: "/repo",
      model: "command-code:deepseek/deepseek-v4.1-flash",
      runtimeMode: "supervised",
      text: "Keep working",
      attachments: [],
      onEvent: (event) => events.push(event),
    });

    await vi.waitFor(() => expect(transport.args).not.toHaveLength(0));
    await stopCommandCodeSession("stop-thread");

    try {
      await expect(
        Promise.race([
          turn.then(() => "settled"),
          new Promise<"timed out">((resolve) =>
            setTimeout(() => resolve("timed out"), 50),
          ),
        ]),
      ).resolves.toBe("settled");
    } finally {
      transport.removedExit?.(130);
      await turn;
    }

    expect(events.some((event) => event.type === "session.ended")).toBe(false);
    expect(events.some((event) => event.type === "session.error")).toBe(false);
  });

  it("emits one error for duplicate failure frames and ends the failed process", async () => {
    const events: HarnessEvent[] = [];
    const turn = sendCommandCodeTurn({
      sessionId: "failed-thread",
      cwd: "/repo",
      model: "command-code:deepseek/deepseek-v4.1-flash",
      runtimeMode: "supervised",
      text: "Fail clearly",
      attachments: [],
      onEvent: (event) => events.push(event),
    });

    await vi.waitFor(() => expect(transport.args).not.toHaveLength(0));
    emit({
      type: "event",
      event: {
        type: "run_end",
        result: { stopReason: "error", error: "provider failed" },
      },
    });
    emit({ type: "result", subtype: "error", error: "provider failed" });
    transport.onExit?.(1);

    await expect(turn).rejects.toThrow("code 1");
    expect(events.filter((event) => event.type === "session.error")).toEqual([
      { type: "session.error", message: "provider failed" },
    ]);
    expect(events).toContainEqual({ type: "session.ended", code: 1 });
  });

  it("cleans the startup timeout when no JSON stream appears", async () => {
    vi.useFakeTimers();
    try {
      const turn = sendCommandCodeTurn({
        sessionId: "startup-timeout-thread",
        cwd: "/repo",
        model: "command-code:deepseek/deepseek-v4.1-flash",
        runtimeMode: "supervised",
        text: "Start",
        attachments: [],
        onEvent: () => undefined,
      });
      const outcome = turn.then(
        () => undefined,
        (error: unknown) => error,
      );
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(15_000);
      await expect(outcome).resolves.toMatchObject({
        message: "Command Code did not start its JSON stream in time",
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cleans the turn timeout after startup succeeds", async () => {
    vi.useFakeTimers();
    try {
      const turn = sendCommandCodeTurn({
        sessionId: "turn-timeout-thread",
        cwd: "/repo",
        model: "command-code:deepseek/deepseek-v4.1-flash",
        runtimeMode: "supervised",
        text: "Continue",
        attachments: [],
        onEvent: () => undefined,
      });
      const outcome = turn.then(
        () => undefined,
        (error: unknown) => error,
      );
      await Promise.resolve();
      emit({ type: "event", event: { type: "run_start" } });
      await vi.advanceTimersByTimeAsync(30 * 60_000);
      await expect(outcome).resolves.toMatchObject({
        message: "Command Code turn timed out",
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
