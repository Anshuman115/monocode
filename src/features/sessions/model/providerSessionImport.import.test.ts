import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, upsertSession, readProviderSessionFile } = vi.hoisted(() => ({
  getSession: vi.fn(),
  upsertSession: vi.fn(),
  readProviderSessionFile: vi.fn(),
}));

vi.mock("../data/sessionStore", () => ({ getSession, upsertSession }));
vi.mock("../../../platform/tauri/fs", () => ({
  listDir: vi.fn(),
  readProviderSessionPreview: vi.fn(),
  readProviderSessionFile,
}));

import {
  importProviderSessions,
  type DiscoveredProviderSession,
} from "./providerSessionImport";

const discovered: DiscoveredProviderSession = {
  provider: "codex",
  providerSessionId: "provider-1",
  cwd: "/tmp/project",
  title: "A conversation",
  blocks: [{ id: "user", role: "user", text: "Original" }],
  updatedAt: 1,
  sourcePath: "/tmp/provider-1.jsonl",
  sourceSizeBytes: 100,
  isPartial: false,
};

describe("importProviderSessions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("preserves an imported conversation that was continued in MonoCode", async () => {
    getSession.mockResolvedValue({
      harness: "codex",
      providerSessionId: "provider-1",
      blocks: [{ id: "later", role: "user", text: "Continued in MonoCode" }],
    });

    const result = await importProviderSessions([
      { provider: "codex", sessions: [discovered] },
    ]);

    expect(result).toEqual({ sessions: [], skipped: 1, errors: [] });
    expect(readProviderSessionFile).not.toHaveBeenCalled();
    expect(upsertSession).not.toHaveBeenCalled();
  });

  it("does not overwrite another conversation if import IDs collide", async () => {
    getSession.mockResolvedValue({
      harness: "codex",
      providerSessionId: "someone-else",
    });

    const result = await importProviderSessions([
      { provider: "codex", sessions: [discovered] },
    ]);

    expect(result.errors).toHaveLength(1);
    expect(upsertSession).not.toHaveBeenCalled();
  });
});
