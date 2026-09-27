import {
  listDir,
  readProviderSessionFile,
  readProviderSessionPreview,
} from "../../../platform/tauri/fs";
import {
  defaultModelId,
  preferredModelSettings,
  resolveModel,
} from "./models";
import {
  formatSessionTitle,
  type Block,
  type Session,
} from "./session";
import { getSession, upsertSession, type SessionSummary } from "../data/sessionStore";

export const IMPORTABLE_PROVIDERS = ["claude", "codex", "pi", "omp"] as const;
export type ImportableProvider = (typeof IMPORTABLE_PROVIDERS)[number];

export type DiscoveredProviderSession = {
  provider: ImportableProvider;
  providerSessionId: string;
  cwd: string;
  title: string;
  model?: string;
  blocks: Block[];
  updatedAt: number;
  sourcePath: string;
  sourceSizeBytes: number;
  isPartial: boolean;
};

export type ProviderImportScan = {
  provider: ImportableProvider;
  sessions: DiscoveredProviderSession[];
  scanning?: boolean;
  error?: string;
};

type ImportedSession = Session;

const PROVIDER_ROOTS: Record<ImportableProvider, string> = {
  claude: "~/.claude/projects",
  codex: "~/.codex/sessions",
  pi: "~/.pi/agent/sessions",
  omp: "~/.omp/agent/sessions",
};

export async function scanProviderSessions(
  onProviderScanned?: (scan: ProviderImportScan) => void,
): Promise<ProviderImportScan[]> {
  const scans = await Promise.all(
    IMPORTABLE_PROVIDERS.map(async (provider) => {
      try {
        const files = await sessionFiles(PROVIDER_ROOTS[provider]);
        const sessions = (await mapConcurrent(files, 8, async (sourcePath) => {
          try {
            const preview = await readProviderSessionPreview(sourcePath);
            const parsed = parseProviderSession(provider, sourcePath, preview.text, true);
            if (!parsed) return null;
            return {
              ...parsed,
              sourceSizeBytes: preview.sizeBytes,
              isPartial: preview.sizeBytes > new TextEncoder().encode(preview.text).length,
              ...(preview.modifiedAtMs ? { updatedAt: preview.modifiedAtMs } : {}),
            };
          } catch {
            return null;
          }
        }))
          .filter((session): session is DiscoveredProviderSession => session != null)
          .sort((a, b) => b.updatedAt - a.updatedAt);
        const scan = { provider, sessions };
        onProviderScanned?.(scan);
        return scan;
      } catch (error) {
        const scan = {
          provider,
          sessions: [],
          error: error instanceof Error ? error.message : "Session store unavailable",
        };
        onProviderScanned?.(scan);
        return scan;
      }
    }),
  );
  return scans;
}

export async function importProviderSessions(
  scans: ProviderImportScan[],
): Promise<{ sessions: SessionSummary[]; skipped: number; errors: string[] }> {
  const imported: SessionSummary[] = [];
  let skipped = 0;
  const errors: string[] = [];
  for (const scan of scans) {
    for (const discovered of scan.sessions) {
      try {
        const id = importId(discovered.provider, discovered.providerSessionId);
        const existing = await getSession(id);
        if (existing) {
          if (
            existing.harness !== discovered.provider ||
            existing.providerSessionId !== discovered.providerSessionId
          ) {
            throw new Error("Import ID is already used by another conversation");
          }
          skipped += 1;
          continue;
        }
        const raw = await readProviderSessionFile(discovered.sourcePath);
        const full = parseProviderSession(discovered.provider, discovered.sourcePath, raw);
        if (!full) throw new Error("Could not read a complete conversation from this file");
        const session = sessionFromParsed(full);
        const summary = await upsertSession(session);
        if (summary) imported.push(summary);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Import failed";
        errors.push(`${discovered.title}: ${reason}`);
      }
    }
  }
  return { sessions: imported, skipped, errors };
}

async function sessionFiles(root: string, depth = 0): Promise<string[]> {
  if (depth > 8) return [];
  let entries: Awaited<ReturnType<typeof listDir>>;
  try {
    entries = await listDir(root);
  } catch (error) {
    if (depth === 0 && /(?:No such file or directory|os error 2|cannot find the path specified)/i.test(String(error))) {
      return [];
    }
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDir) {
      if (entry.name === "subagents") continue;
      files.push(...(await sessionFiles(entry.path, depth + 1)));
    } else if (entry.name.endsWith(".jsonl")) {
      files.push(entry.path);
    }
  }
  return files;
}

export function parseProviderSession(
  provider: ImportableProvider,
  sourcePath: string,
  raw: string,
  previewOnly = false,
): DiscoveredProviderSession | null {
  const rows: Record<string, unknown>[] = [];
  for (const line of raw.split(/\r?\n/g)) {
    if (!line.trim()) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (!isRecord(value)) {
        if (!previewOnly) return null;
        continue;
      }
      rows.push(value);
    } catch {
      if (!previewOnly) return null;
    }
  }
  if (rows.length === 0) return null;

  const metadata = rows.find((row) =>
    ["session_meta", "session", "session_start"].includes(stringField(row, "type") ?? ""),
  );
  const payload = asRecord(metadata?.payload) ?? metadata;
  const providerSessionId =
    firstString(
      payload,
      "session_id",
      "sessionId",
      "id",
    ) ??
    firstString(rows[0], "sessionId", "session_id", "id") ??
    sourcePath.split("/").pop()?.replace(/\.jsonl$/, "");
  if (!providerSessionId) return null;

  const cwd =
    firstString(payload, "cwd", "working_directory", "workdir") ??
    firstString(rows.find((row) => firstString(row, "cwd") != null), "cwd");
  if (!cwd || cwd === "~") return null;

  const importRows = provider === "omp" && !previewOnly ? activeOmpRows(rows) : rows;
  const blocks = blocksFromRows(provider, importRows);
  if (!blocks.some((block) => block.role === "user")) return null;

  const title =
    firstString(
      rows.find((row) => ["custom-title", "title"].includes(stringField(row, "type") ?? "")),
      "customTitle",
      "title",
    ) ?? titleFromBlocks(blocks, provider);
  const updatedAt = rows.reduce(
    (latest, row) => Math.max(latest, timestampFrom(row) ?? 0),
    0,
  );

  return {
    provider,
    providerSessionId,
    cwd,
    title: formatSessionTitle(provider, title),
    model:
      firstString(
        rows.find((row) => firstString(row, "model") != null),
        "model",
      ) ?? firstString(payload, "model", "model_id", "modelId"),
    blocks,
    updatedAt: updatedAt || Date.now(),
    sourcePath,
    sourceSizeBytes: raw.length,
    isPartial: false,
  };
}

async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  map: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await map(items[index]);
      }
    }),
  );
  return results;
}

function sessionFromParsed(discovered: DiscoveredProviderSession): ImportedSession {
  const provider = discovered.provider;
  const model = resolveModel(
    provider,
    discovered.model ?? defaultModelId(provider),
  );
  return {
    id: importId(provider, discovered.providerSessionId),
    harness: provider,
    model: model.id,
    modelSettings: preferredModelSettings(model),
    runtimeMode: "supervised",
    title: discovered.title,
    cwd: discovered.cwd,
    blocks: discovered.blocks,
    providerSessionId: discovered.providerSessionId,
  };
}

function blocksFromRows(
  provider: ImportableProvider,
  rows: Record<string, unknown>[],
): Block[] {
  const blocks: Block[] = [];
  for (const [index, row] of rows.entries()) {
    const type = stringField(row, "type");
    const payload = asRecord(row.payload) ?? row;
    const message = asRecord(payload.message) ?? asRecord(row.message);
    const role =
      stringField(message, "role") ??
      stringField(payload, "role") ??
      stringField(row, "role") ??
      (type === "user" || type === "user_message"
        ? "user"
        : type === "assistant" || type === "assistant_message"
          ? "assistant"
          : undefined);
    if (role !== "user" && role !== "assistant") continue;

    const text = textFromContent(message?.content ?? payload.content ?? row.content);
    if (!text.trim()) continue;
    const id =
      firstString(row, "uuid", "id") ??
      firstString(message, "id") ??
      `${provider}-import-${index}`;
    const block: Block = {
      id: `${provider}-${id}`.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 160),
      role,
      text,
      ...(timestampFrom(row) ? { startedAt: timestampFrom(row) } : {}),
    };
    blocks.push(block);
  }
  return dedupeBlocks(blocks);
}

function activeOmpRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const id = stringField(row, "id");
    if (id) byId.set(id, row);
  }
  const active = new Set<string>();
  let cursor = rows.slice().reverse()
    .map((row) => stringField(row, "id"))
    .find((id) => id != null);
  while (cursor && !active.has(cursor)) {
    active.add(cursor);
    cursor = stringField(byId.get(cursor), "parentId");
  }
  return rows.filter((row) => {
    const type = stringField(row, "type");
    if (type !== "message") return false;
    const id = stringField(row, "id");
    return id != null && active.has(id);
  });
}

function dedupeBlocks(blocks: Block[]): Block[] {
  const seen = new Set<string>();
  return blocks.filter((block) => {
    if (seen.has(block.id)) return false;
    seen.add(block.id);
    return true;
  });
}

function titleFromBlocks(blocks: Block[], provider: ImportableProvider): string {
  const first = blocks.find((block) => block.role === "user")?.text ?? "Imported session";
  return first.split(/\r?\n/g)[0]?.trim().slice(0, 72) || `${provider} session`;
}

function textFromContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .flatMap((item) => {
      if (typeof item === "string") return [item];
      if (!isRecord(item)) return [];
      const type = stringField(item, "type");
      if (
        type === "tool_result" ||
        type === "toolCall" ||
        type === "thinking" ||
        type === "input_image"
      ) {
        return [];
      }
      const text = firstString(item, "text", "output_text", "input_text");
      return text ? [text] : [];
    })
    .join("\n");
}

function timestampFrom(value: Record<string, unknown>): number | undefined {
  const raw = firstString(value, "timestamp", "created_at", "createdAt");
  if (!raw) return undefined;
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function firstString(
  value: Record<string, unknown> | undefined,
  ...keys: string[]
): string | undefined {
  if (!value) return undefined;
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

function stringField(
  value: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  return firstString(value, key);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function importId(provider: ImportableProvider, providerSessionId: string): string {
  let hash = 2166136261;
  for (const char of `${provider}:${providerSessionId}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `import-${provider}-${(hash >>> 0).toString(16)}`;
}
