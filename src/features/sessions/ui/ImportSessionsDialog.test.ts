// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { afterEach, beforeEach, vi } from "vitest";

const { scanProviderSessions, importProviderSessions } = vi.hoisted(() => ({
  scanProviderSessions: vi.fn(),
  importProviderSessions: vi.fn(),
}));

vi.mock("../model/providerSessionImport", async (importOriginal) => {
  const original = await importOriginal<typeof import("../model/providerSessionImport")>();
  return { ...original, scanProviderSessions, importProviderSessions };
});

import { groupProviderSessionsByProvider, ImportSessionsDialog } from "./ImportSessionsDialog";
import type {
  DiscoveredProviderSession,
  ProviderImportScan,
} from "../model/providerSessionImport";

function session(
  provider: DiscoveredProviderSession["provider"],
  providerSessionId: string,
  cwd: string,
  updatedAt: number,
): DiscoveredProviderSession {
  return {
    provider,
    providerSessionId,
    cwd,
    updatedAt,
    title: providerSessionId,
    blocks: [{ id: providerSessionId, role: "user", text: "Hi" }],
    sourcePath: `/tmp/${providerSessionId}.jsonl`,
    sourceSizeBytes: 100,
    isPartial: false,
  };
}

describe("groupProviderSessionsByProvider", () => {
  it("keeps the same project separate under each provider", () => {
    const scans: ProviderImportScan[] = [
      {
        provider: "claude",
        sessions: [
          session("claude", "c", "/tmp/project", 10),
          session("claude", "c2", "/tmp/project/", 8),
        ],
      },
      {
        provider: "codex",
        sessions: [
          session("codex", "d", "/tmp/project/", 20),
          session("codex", "other", "/tmp/other", 5),
        ],
      },
    ];

    const groups = groupProviderSessionsByProvider(scans);
    expect(groups.map(({ provider }) => provider).slice(0, 2)).toEqual(["claude", "codex"]);
    expect(groups[0].projects.map(({ cwd }) => cwd)).toEqual(["/tmp/project"]);
    expect(groups[0].projects[0].sessions.map(({ provider }) => provider)).toEqual(["claude", "claude"]);
    expect(groups[1].projects.map(({ cwd }) => cwd)).toEqual(["/tmp/project", "/tmp/other"]);
    expect(groups[1].projects[0].sessions.map(({ provider }) => provider)).toEqual(["codex"]);
    expect(groups.find(({ provider }) => provider === "cursor")).toMatchObject({
      supported: false,
      projects: [],
    });
  });
});

describe("ImportSessionsDialog", () => {
  const container = document.createElement("div");
  const root = createRoot(container);

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    document.body.append(container);
    vi.clearAllMocks();
    scanProviderSessions.mockImplementation(async (onScanned: (scan: ProviderImportScan) => void) => {
      const scans: ProviderImportScan[] = [
        { provider: "claude", sessions: [
          session("claude", "one", "/tmp/shared", 10),
          session("claude", "three", "/tmp/shared/", 8),
        ] },
        { provider: "codex", sessions: [session("codex", "two", "/tmp/shared", 20)] },
      ];
      for (const scan of scans) onScanned(scan);
      return scans;
    });
    importProviderSessions.mockResolvedValue({ sessions: [], skipped: 0, errors: [] });
  });

  afterEach(() => {
    act(() => root.render(null));
    container.remove();
    vi.unstubAllGlobals();
  });

  it("selects a project without changing the same project under another provider", async () => {
    await act(async () => {
      root.render(createElement(ImportSessionsDialog, { onClose: vi.fn(), onImported: vi.fn() }));
    });

    for (const provider of ["Claude Code", "Codex", "Cursor", "Grok", "OpenCode", "Pi", "omp", "fx", "Hermes", "Antigravity"]) {
      expect(document.body.textContent).toContain(provider);
    }

    const projectToggle = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Deselect all Claude Code sessions in shared"]',
    );
    expect(projectToggle).not.toBeNull();
    act(() => projectToggle!.click());
    expect(document.body.textContent).toContain("1 of 3 chats selected");
    expect(document.querySelector('button[aria-label="Deselect all Codex sessions in shared"]')).not.toBeNull();

    const one = [...document.querySelectorAll<HTMLButtonElement>('button[aria-pressed="false"]')]
      .find((button) => button.textContent?.includes("one"));
    expect(one).not.toBeNull();
    act(() => one!.click());
    expect(document.body.textContent).toContain("2 of 3 chats selected");
  });

  it("deselects all sessions globally and toggles selection per provider", async () => {
    await act(async () => {
      root.render(createElement(ImportSessionsDialog, { onClose: vi.fn(), onImported: vi.fn() }));
    });

    expect(document.body.textContent).toContain("3 of 3 chats selected");
    const claudeDeselect = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Deselect all Claude Code sessions"]',
    );
    expect(claudeDeselect).not.toBeNull();
    act(() => claudeDeselect!.click());
    expect(document.body.textContent).toContain("1 of 3 chats selected");

    const deselectAll = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Deselect all sessions"]',
    );
    expect(deselectAll).not.toBeNull();
    act(() => deselectAll!.click());
    expect(document.body.textContent).toContain("0 of 3 chats selected");

    const codexSelect = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Select all Codex sessions"]',
    );
    expect(codexSelect).not.toBeNull();
    act(() => codexSelect!.click());
    expect(document.body.textContent).toContain("1 of 3 chats selected");

    const codexDeselect = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Deselect all Codex sessions"]',
    );
    expect(codexDeselect).not.toBeNull();
    act(() => codexDeselect!.click());
    expect(document.body.textContent).toContain("0 of 3 chats selected");
  });
});
