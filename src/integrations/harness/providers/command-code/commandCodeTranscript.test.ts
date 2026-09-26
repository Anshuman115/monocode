import { describe, expect, it } from "vitest";
import {
  commandCodeImportKey,
  parseCommandCodeTranscript,
  parseCommandCodeTranscriptRecords,
} from "./commandCodeTranscript";

describe("Command Code transcript import", () => {
  it("imports messages, tree parents, usage metadata, and skips bad JSONL", () => {
    const transcript = [
      '{"type":"session","version":3,"id":"session-1234","timestamp":"2026-09-24T10:00:00Z","cwd":"/repo"}',
      "not json",
      '{"type":"message","id":"u1","parentId":null,"timestamp":"2026-09-24T10:01:00Z","message":{"role":"user","content":[{"type":"text","text":"Read the file"}]}}',
      '{"type":"message","id":"a1","parentId":"u1","timestamp":"2026-09-24T10:02:00Z","message":{"role":"assistant","content":[{"type":"text","text":"Done"}],"meta":{"source":"model"}},"usage":{"inputTokens":4},"model":"deepseek/deepseek-v4.1-flash"}',
      '{"type":"compaction","id":"c1","summary":"kept as provider metadata"}',
    ].join("\n");
    const imported = parseCommandCodeTranscript(
      transcript,
      "/sessions/session-1234.jsonl",
    );
    expect(imported).toMatchObject({
      provider: "command-code",
      providerSessionId: "session-1234",
      cwd: "/repo",
      messages: [
        { id: "u1", role: "user", text: "Read the file" },
        {
          id: "a1",
          parentId: "u1",
          role: "assistant",
          text: "Done",
          model: "deepseek/deepseek-v4.1-flash",
        },
        { id: "c1", role: "system", text: "kept as provider metadata" },
      ],
    });
    expect(commandCodeImportKey(imported!)).toBe("command-code:session-1234");
  });

  it("rejects a file without a valid Command Code session header", () => {
    expect(
      parseCommandCodeTranscript(
        '{"type":"message","id":"u1"}',
        "/tmp/unknown.jsonl",
      ),
    ).toBeNull();
  });

  it("accepts streamed lines without joining the whole transcript", () => {
    const lines = function* () {
      yield '{"type":"session","version":3,"id":"streamed-1234"}';
      yield '{"type":"message","id":"u1","message":{"role":"user","content":"hello"}}';
    };
    expect(
      parseCommandCodeTranscriptRecords(lines(), "/tmp/streamed.jsonl"),
    ).toMatchObject({
      providerSessionId: "streamed-1234",
      messages: [{ id: "u1", role: "user", text: "hello" }],
    });
  });
});
