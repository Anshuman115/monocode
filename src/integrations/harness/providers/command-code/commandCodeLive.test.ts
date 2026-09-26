import { beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
  args: [] as string[],
  onLine: undefined as ((line: string) => void) | undefined,
  onExit: undefined as ((code: number | null) => void) | undefined,
  spawnChild: vi.fn(),
  killChild: vi.fn(),
}));

vi.mock("../../core/child", () => ({
  resolveCommandCodeBinary: async () => ({ path: "/fake/command-code" }),
  spawnChild: transport.spawnChild,
  killChild: transport.killChild,
  unwatchChild: vi.fn(),
  watchChild: (
    _id: string,
    onLine: (line: string) => void,
    onExit: (code: number | null) => void,
  ) => {
    transport.onLine = onLine;
    transport.onExit = onExit;
  },
}));

import { sendCommandCodeTurn } from "./commandCode";
import type { HarnessEvent } from "../../core/types";

function emit(record: Record<string, unknown>): void {
  transport.onLine?.(JSON.stringify(record));
}

describe("Command Code structured transport", () => {
  beforeEach(() => {
    transport.args = [];
    transport.onLine = undefined;
    transport.onExit = undefined;
    transport.spawnChild
      .mockReset()
      .mockImplementation(
        async (_id: string, _path: string, args: string[]) => {
          transport.args = args;
        },
      );
    transport.killChild.mockReset().mockResolvedValue(undefined);
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

    await vi.waitFor(() => expect(transport.args).toHaveLength(12));
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
      "Read README.md",
    ]);
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
        result: "ok",
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
      }),
    );
    expect(events).toContainEqual({
      type: "turn.metrics",
      inputTokens: 4,
      outputTokens: 2,
    });
  });
});
