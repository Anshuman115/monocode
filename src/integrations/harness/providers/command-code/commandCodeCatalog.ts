import { homeDir } from "../../../../platform/tauri/fs";
import {
  setHarnessModels,
  type AgentModel,
} from "../../../../features/sessions/model/models";
import { execChild, resolveCommandCodeBinary } from "../../core/child";
import {
  compareCommandCodeVersions,
  MINIMUM_COMMAND_CODE_VERSION,
  modelNameFromCatalogId,
  parseCommandCodeVersion,
} from "./commandCodeProtocol";

let inflight: Promise<void> | null = null;

export function refreshCommandCodeCatalog(): Promise<void> {
  if (inflight) return inflight;
  inflight = discoverCommandCodeModels()
    .then((models) => {
      if (models.length > 0) setHarnessModels("command-code", models);
    })
    .catch((error: unknown) => {
      console.debug(
        "[monocode] command-code catalog unavailable",
        redactError(error),
      );
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export async function discoverCommandCodeModels(): Promise<AgentModel[]> {
  const { path } = await resolveCommandCodeBinary();
  const cwd = await homeDir();
  const version = parseCommandCodeVersion(
    await execChild(path, ["--version"], cwd),
  );
  if (!version) throw new Error("Unable to determine Command Code version");
  if (compareCommandCodeVersions(version, MINIMUM_COMMAND_CODE_VERSION) < 0) {
    throw new Error(
      `Command Code v${version} is too old. MonoCode requires v${MINIMUM_COMMAND_CODE_VERSION} or newer.`,
    );
  }
  return parseCommandCodeModelList(
    await execChild(path, ["--list-models"], cwd),
  );
}

export function parseCommandCodeModelList(output: string): AgentModel[] {
  const models: AgentModel[] = [];
  const seen = new Set<string>();
  for (const line of output.split("\n")) {
    const match = /^\s*([A-Za-z0-9][A-Za-z0-9._:/-]*)(?:\s{2,}(.+?))?\s*$/.exec(
      line,
    );
    const nativeId = match?.[1];
    if (
      !nativeId ||
      nativeId.endsWith(":") ||
      !match?.[2] ||
      /^(available|models|open|anthropic|openai|google)$/i.test(nativeId)
    ) {
      continue;
    }
    if (seen.has(nativeId)) continue;
    seen.add(nativeId);
    models.push({
      id: `command-code:${nativeId}`,
      harness: "command-code",
      nativeId,
      name: modelNameFromCatalogId(nativeId),
      ...(nativeId.includes("deepseek") || nativeId.includes("qwen")
        ? { contextWindow: 1_000_000 }
        : {}),
    });
  }
  return models;
}

function redactError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(?:token|key|password|secret)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .slice(0, 240);
}
