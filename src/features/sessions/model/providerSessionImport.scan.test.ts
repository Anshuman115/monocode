import { beforeEach, describe, expect, it, vi } from "vitest";

const { listDir, readProviderSessionFile, readProviderSessionPreview } = vi.hoisted(() => ({
  listDir: vi.fn(),
  readProviderSessionFile: vi.fn(),
  readProviderSessionPreview: vi.fn(),
}));

vi.mock("../../../platform/tauri/fs", () => ({
  listDir,
  readProviderSessionFile,
  readProviderSessionPreview,
}));

import { scanProviderSessions } from "./providerSessionImport";

describe("scanProviderSessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listDir.mockImplementation(async (root: string) => {
      if (root.includes("/.pi/")) return [];
      return [{
        name: "session.jsonl",
        path: `${root}/session.jsonl`,
        isDir: false,
        ignored: false,
      }];
    });
    readProviderSessionPreview.mockImplementation(async (path: string) => {
      const raw = path.includes("/.omp/")
        ? [
            { type: "title", title: "OMP chat" },
            { type: "session", id: "omp-id", cwd: "/tmp/omp-project" },
            { type: "message", id: "user", parentId: "omp-id", message: { role: "user", content: "Hi" } },
          ]
        : path.includes("/.codex/")
          ? [
              { type: "session_meta", payload: { id: "codex-id", cwd: "/tmp/codex-project" } },
              { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Hi" }] } },
            ]
          : [{ type: "user", sessionId: "claude-id", cwd: "/tmp/claude-project", content: "Hi" }];
      return {
        text: raw.map((row) => JSON.stringify(row)).join("\n") + "\n",
        sizeBytes: 100_000_000,
        modifiedAtMs: 1_700_000_000_000,
      };
    });
  });

  it("discovers large transcripts from bounded previews without loading their full contents", async () => {
    const completedProviders: string[] = [];

    const scans = await scanProviderSessions((scan) => {
      completedProviders.push(scan.provider);
    });

    expect(readProviderSessionPreview).toHaveBeenCalledTimes(3);
    expect(readProviderSessionFile).not.toHaveBeenCalled();
    expect(completedProviders).toHaveLength(4);
    expect(scans.flatMap((scan) => scan.sessions)).toHaveLength(3);
    expect(scans.find((scan) => scan.provider === "omp")?.sessions[0]).toMatchObject({
      providerSessionId: "omp-id",
      cwd: "/tmp/omp-project",
      isPartial: true,
    });
  });

  it("treats an uninstalled provider's missing root as empty", async () => {
    listDir.mockImplementation(async (root: string) => {
      if (root.includes("/.pi/")) throw new Error(`${root}: No such file or directory (os error 2)`);
      return [];
    });

    const scans = await scanProviderSessions();

    expect(scans.find((scan) => scan.provider === "pi")).toEqual({
      provider: "pi",
      sessions: [],
    });
  });

  it("compares preview size in bytes, not JavaScript characters", async () => {
    const text = [
      { type: "user", sessionId: "unicode", cwd: "/tmp/project", content: "こんにちは" },
    ].map((row) => JSON.stringify(row)).join("\n") + "\n";
    listDir.mockImplementation(async (root: string) => root.includes("/.claude/")
      ? [{ name: "unicode.jsonl", path: `${root}/unicode.jsonl`, isDir: false, ignored: false }]
      : []);
    readProviderSessionPreview.mockResolvedValue({
      text,
      sizeBytes: new TextEncoder().encode(text).length,
      modifiedAtMs: 1_700_000_000_000,
    });

    const scans = await scanProviderSessions();

    expect(scans[0].sessions[0].isPartial).toBe(false);
  });
});
