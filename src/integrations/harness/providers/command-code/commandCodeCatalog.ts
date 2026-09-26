import { homeDir } from "../../../../platform/tauri/fs";
import {
  setHarnessCatalogLoading,
  setHarnessModels,
  type AgentModel,
} from "../../../../features/sessions/model/models";
import { execChild, resolveCommandCodeBinary } from "../../core/child";
import {
  compareCommandCodeVersions,
  MINIMUM_COMMAND_CODE_VERSION,
  modelNameFromCatalogId,
  parseCommandCodeStatus,
  parseCommandCodeVersion,
  type CommandCodeStatus,
} from "./commandCodeProtocol";

let inflight: Promise<void> | null = null;

export function refreshCommandCodeCatalog(): Promise<void> {
  if (inflight) return inflight;
  setHarnessCatalogLoading("command-code", true);
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
      setHarnessCatalogLoading("command-code", false);
    });
  return inflight;
}

export async function discoverCommandCodeModels(): Promise<AgentModel[]> {
  const { path } = await resolveCommandCodeBinary();
  const cwd = await homeDir();
  const version = parseCommandCodeVersion(
    await execChild(path, ["--no-auto-update", "--version"], cwd, "command-code"),
  );
  if (!version) throw new Error("Unable to determine Command Code version");
  if (compareCommandCodeVersions(version, MINIMUM_COMMAND_CODE_VERSION) < 0) {
    throw new Error(
      `Command Code v${version} is too old. MonoCode requires v${MINIMUM_COMMAND_CODE_VERSION} or newer.`,
    );
  }
  const listed = parseCommandCodeModelList(
    await execChild(path, ["--no-auto-update", "--list-models"], cwd, "command-code"),
  );
  const status = await execChild(
    path,
    ["--no-auto-update", "status", "--json"],
    cwd,
    "command-code",
  )
    .then(parseCommandCodeStatus)
    .catch(() => null);
  return withProviderContextWindow(listed, status);
}

export function withProviderContextWindow(
  models: AgentModel[],
  status: CommandCodeStatus | null,
): AgentModel[] {
  const nativeId = status?.model;
  const contextWindow = status?.contextWindow;
  if (!nativeId || !contextWindow) return models;
  return models.map((model) =>
    model.nativeId === nativeId ? { ...model, contextWindow } : model,
  );
}

export function parseCommandCodeModelList(output: string): AgentModel[] {
  const declaredCount = Number(
    /^\s*Available models\s+[·•]\s+(\d+)\s+models\s*$/im.exec(output)?.[1],
  );
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
    });
  }
  if (declaredCount > 0 && models.length < declaredCount) {
    throw new Error(
      `Incomplete Command Code model catalog: expected at least ${declaredCount} models, received ${models.length}`,
    );
  }
  return models;
}

function redactError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/\b(token|key|password|secret)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .slice(0, 240);
}
