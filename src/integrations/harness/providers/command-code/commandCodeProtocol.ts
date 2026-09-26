import type {
  RuntimeMode,
  TurnIntent,
} from "../../../../features/sessions/model/session";

export const MINIMUM_COMMAND_CODE_VERSION = "1.0.0";

export type CommandCodeEvent = Record<string, unknown> & { type: string };

export type ParsedCommandCodeLine =
  | { kind: "event"; event: CommandCodeEvent }
  | { kind: "result"; result: Record<string, unknown> }
  | null;

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function stringField(
  value: Record<string, unknown> | null | undefined,
  key: string,
): string | undefined {
  const candidate = value?.[key];
  return typeof candidate === "string" && candidate.trim()
    ? candidate
    : undefined;
}

export function parseCommandCodeLine(line: string): ParsedCommandCodeLine {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const outer = asRecord(JSON.parse(trimmed));
    if (!outer) return null;
    if (outer.type === "event") {
      const event = asRecord(outer.event);
      const type = stringField(event, "type");
      return type ? { kind: "event", event: { ...event, type } } : null;
    }
    if (outer.type === "result") {
      return { kind: "result", result: outer };
    }
  } catch {}
  return null;
}

export function parseCommandCodeVersion(output: string): string | null {
  return output.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/)?.[0] ?? null;
}

export function compareCommandCodeVersions(
  left: string,
  right: string,
): number {
  const parse = (version: string) =>
    version.match(/\d+(?:\.\d+){0,2}/)?.[0] ?? "0";
  const a = parse(left)
    .split(".")
    .map((part) => Number(part) || 0);
  const b = parse(right)
    .split(".")
    .map((part) => Number(part) || 0);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function commandCodePermissionArgs(
  runtimeMode: RuntimeMode,
  intent?: TurnIntent,
): string[] {
  if (intent === "plan") return ["--plan"];
  switch (runtimeMode) {
    case "auto-accept-edits":
      return ["--accept-edits"];
    case "auto":
    case "full-access":
      return ["--yolo"];
    default:
      return [];
  }
}

export function buildCommandCodeArgs(input: {
  text: string;
  model?: string;
  effort?: string;
  runtimeMode: RuntimeMode;
  intent?: TurnIntent;
  resume?: string;
}): string[] {
  const args = [
    "--output-format",
    "json",
    "--skip-onboarding",
    "--no-auto-update",
    "--max-turns",
    "100",
    ...commandCodePermissionArgs(input.runtimeMode, input.intent),
  ];
  if (input.model) args.push("--model", input.model);
  if (input.effort) args.push("--effort", input.effort);
  args.push("--print");
  if (input.resume) args.push("--resume", input.resume);
  args.push(input.text);
  return args;
}

export function contentText(value: unknown): string {
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

export function toolResultText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => {
      const record = asRecord(item);
      return typeof record?.text === "string" ? record.text : "";
    })
    .join("");
}

export function toolKind(toolName: string): string {
  const name = toolName.toLowerCase();
  if (name.includes("shell") || name.includes("command")) return "shell";
  if (name.includes("read") || name.includes("list") || name.includes("file")) {
    return name.includes("write") || name.includes("edit") ? "write" : "read";
  }
  if (
    name.includes("search") ||
    name.includes("grep") ||
    name.includes("glob")
  ) {
    return "search";
  }
  return "other";
}

export function redactCommandCodeDiagnostic(value: string): string {
  return value
    .replace(
      /(?:api[_-]?key|token|password|secret)\s*[:=]\s*\S+/gi,
      "$1=[redacted]",
    )
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[redacted]")
    .replace(/https?:\/\/\S+/gi, "provider URL")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export function modelNameFromCatalogId(nativeId: string): string {
  const parts = nativeId.split("/");
  const leaf = parts[parts.length - 1] ?? nativeId;
  return leaf
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}
