import type { HarnessId } from "../../../features/sessions/model/session";
export type ImportedTranscriptMessage = {
  id: string;
  parentId?: string;
  role: "user" | "assistant" | "reasoning" | "tool" | "system";
  text: string;
  timestamp?: string;
  model?: string;
  metadata?: Record<string, unknown>;
};

export type ProviderNeutralImportedSession = {
  provider: HarnessId;
  providerSessionId: string;
  sourcePath: string;
  cwd?: string;
  title?: string;
  createdAt?: string;
  activityAt?: string;
  messages: ImportedTranscriptMessage[];
  metadata?: Record<string, unknown>;
};

export type TranscriptImporter = {
  provider: HarnessId;
  parse(
    text: string,
    sourcePath: string,
  ): ProviderNeutralImportedSession | null;
};

const importers = new Map<HarnessId, TranscriptImporter>();

export function registerTranscriptImporter(importer: TranscriptImporter): void {
  importers.set(importer.provider, importer);
}

export function getTranscriptImporter(
  provider: HarnessId,
): TranscriptImporter | undefined {
  return importers.get(provider);
}
