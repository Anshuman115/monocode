import { describe, expect, it } from "vitest";
import { parseProviderSession } from "./providerSessionImport";

describe("parseProviderSession", () => {
  it("imports Codex messages whose role is stored directly on payload", () => {
    const raw = [
      {
        type: "session_meta",
        payload: {
          id: "codex-session-1",
          cwd: "/tmp/project",
        },
      },
      {
        type: "response_item",
        timestamp: "2026-09-25T10:00:00.000Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Inspect the project" }],
        },
      },
      {
        type: "response_item",
        timestamp: "2026-09-25T10:00:01.000Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "I will inspect it." }],
        },
      },
    ]
      .map((row) => JSON.stringify(row))
      .join("\n");

    const session = parseProviderSession(
      "codex",
      "/tmp/codex-session-1.jsonl",
      raw,
    );

    expect(session?.providerSessionId).toBe("codex-session-1");
    expect(session?.cwd).toBe("/tmp/project");
    expect(session?.blocks.map(({ role, text }) => ({ role, text }))).toEqual([
      { role: "user", text: "Inspect the project" },
      { role: "assistant", text: "I will inspect it." },
    ]);
  });

  it("imports Claude messages whose role is stored directly on the row", () => {
    const raw = [
      {
        type: "user",
        sessionId: "claude-session-1",
        cwd: "/tmp/project",
        content: "Hello",
      },
      {
        type: "assistant",
        sessionId: "claude-session-1",
        cwd: "/tmp/project",
        content: [{ type: "text", text: "Hi" }],
      },
    ]
      .map((row) => JSON.stringify(row))
      .join("\n");

    const session = parseProviderSession(
      "claude",
      "/tmp/claude-session-1.jsonl",
      raw,
    );

    expect(session?.providerSessionId).toBe("claude-session-1");
    expect(session?.blocks.map((block) => block.text)).toEqual(["Hello", "Hi"]);
  });

  it("imports only OMP messages on the active branch", () => {
    const raw = [
      { type: "title", title: "OMP project chat", updatedAt: "2026-09-25T10:00:03.000Z" },
      { type: "session", id: "omp-session-1", cwd: "/tmp/project" },
      {
        type: "message",
        id: "user-1",
        parentId: "omp-session-1",
        timestamp: "2026-09-25T10:00:00.000Z",
        message: { role: "user", content: [{ type: "text", text: "Keep this" }] },
      },
      {
        type: "message",
        id: "assistant-active",
        parentId: "user-1",
        message: { role: "assistant", content: [{ type: "text", text: "Active reply" }] },
      },
      {
        type: "message",
        id: "assistant-abandoned",
        parentId: "user-1",
        message: { role: "assistant", content: [{ type: "text", text: "Discarded reply" }] },
      },
      { type: "custom", id: "tail", parentId: "assistant-active" },
    ]
      .map((row) => JSON.stringify(row))
      .join("\n");

    const session = parseProviderSession("omp", "/tmp/omp-session.jsonl", raw);

    expect(session).toMatchObject({
      providerSessionId: "omp-session-1",
      cwd: "/tmp/project",
      title: "omp · OMP project chat",
    });
    expect(session?.blocks.map((block) => block.text)).toEqual([
      "Keep this",
      "Active reply",
    ]);
  });

  it("rejects damaged complete transcripts rather than silently importing a subset", () => {
    const raw = [
      JSON.stringify({ type: "user", sessionId: "claude-1", cwd: "/tmp/project", content: "First" }),
      "{broken json",
    ].join("\n");

    expect(parseProviderSession("claude", "/tmp/claude-1.jsonl", raw)).toBeNull();
  });

  it("finds OMP's active branch when an ID-less metadata row follows it", () => {
    const raw = [
      { type: "session", id: "omp-1", cwd: "/tmp/project" },
      { type: "message", id: "user-1", parentId: "omp-1", message: { role: "user", content: "Hi" } },
      { type: "message", id: "reply-1", parentId: "user-1", message: { role: "assistant", content: "Hello" } },
      { type: "title", title: "Later title" },
    ].map((row) => JSON.stringify(row)).join("\n");

    expect(parseProviderSession("omp", "/tmp/omp-1.jsonl", raw)?.blocks.map((block) => block.text))
      .toEqual(["Hi", "Hello"]);
  });
});
