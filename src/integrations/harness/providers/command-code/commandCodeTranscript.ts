import type {
  ImportedTranscriptMessage,
  ProviderNeutralImportedSession,
  TranscriptImporter,
} from "../../core/sessionImport";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .flatMap((item) => {
      const block = asRecord(item);
      return block?.type === "text" && typeof block.text === "string"
        ? [block.text]
        : [];
    })
    .join("");
}

export const commandCodeTranscriptImporter: TranscriptImporter = {
  provider: "command-code",
  parse: parseCommandCodeTranscript,
};

export function parseCommandCodeTranscript(
  text: string,
  sourcePath: string,
): ProviderNeutralImportedSession | null {
  return parseCommandCodeTranscriptLines(text.split("\n"), sourcePath);
}

export function parseCommandCodeTranscriptLines(
  lines: Iterable<string>,
  sourcePath: string,
): ProviderNeutralImportedSession | null {
  const messages: ImportedTranscriptMessage[] = [];
  let header: Record<string, unknown> | null = null;
  let lastTimestamp: string | undefined;

  for (const line of lines) {
    const record = parseJsonRecord(line);
    if (!record) continue;
    if (record.type === "session") {
      header ??= record;
      continue;
    }
    if (record.type === "compaction") {
      const summary = stringValue(record.summary);
      const id = stringValue(record.id) ?? `compaction-${messages.length}`;
      if (summary) {
        messages.push({
          id,
          role: "system",
          text: summary,
          metadata: { compaction: true },
        });
      }
      continue;
    }
    if (record.type !== "message") continue;
    const message = asRecord(record.message);
    const role = normalizeRole(message?.role);
    const id = stringValue(record.id) ?? stringValue(message?.id);
    if (!message || !role || !id) continue;
    const textValue = contentText(message.content);
    if (!textValue && role !== "tool") continue;
    const messageMeta = asRecord(message.meta);
    const timestamp =
      stringValue(record.timestamp) ?? stringValue(messageMeta?.createdAt);
    if (timestamp) lastTimestamp = timestamp;
    messages.push({
      id,
      ...(stringValue(record.parentId)
        ? { parentId: stringValue(record.parentId) }
        : {}),
      role,
      text: textValue,
      ...(timestamp ? { timestamp } : {}),
      ...(stringValue(record.model)
        ? { model: stringValue(record.model) }
        : {}),
      metadata: {
        ...(messageMeta ?? {}),
        ...(message.content ? { content: message.content } : {}),
        ...(record.usage ? { usage: record.usage } : {}),
      },
    });
  }

  const providerSessionId = stringValue(header?.id);
  if (!providerSessionId) return null;
  return {
    provider: "command-code",
    providerSessionId,
    sourcePath,
    ...(stringValue(header?.cwd) ? { cwd: stringValue(header?.cwd) } : {}),
    ...(stringValue(header?.timestamp)
      ? { createdAt: stringValue(header?.timestamp) }
      : {}),
    ...(lastTimestamp ? { activityAt: lastTimestamp } : {}),
    messages,
  };
}

export function parseCommandCodeTranscriptRecords(
  lines: Iterable<string>,
  sourcePath: string,
): ProviderNeutralImportedSession | null {
  return parseCommandCodeTranscriptLines(lines, sourcePath);
}

export function commandCodeImportKey(
  session: Pick<
    ProviderNeutralImportedSession,
    "provider" | "providerSessionId"
  >,
): string {
  return `${session.provider}:${session.providerSessionId}`;
}

function parseJsonRecord(line: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(line.trim()));
  } catch {
    return null;
  }
}

function normalizeRole(
  value: unknown,
): ImportedTranscriptMessage["role"] | null {
  if (value === "user" || value === "assistant" || value === "system")
    return value;
  if (value === "tool" || value === "tool_result") return "tool";
  if (value === "reasoning" || value === "thinking") return "reasoning";
  return null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
