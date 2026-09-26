import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Loader,
  RefreshCw,
} from "../../../shared/ui/icons";
import { Modal } from "../../../shared/ui/Modal";
import { basename } from "../../../platform/tauri/fs";
import { HarnessIcon } from "./HarnessIcon";
import { HARNESSES, HARNESS_TITLE, type HarnessId } from "../model/session";
import { normalizeProjectPath } from "../../projects/model/recents";
import { pathKey } from "../../../shared/lib/paths";
import {
  importProviderSessions,
  IMPORTABLE_PROVIDERS,
  scanProviderSessions,
  type DiscoveredProviderSession,
  type ImportableProvider,
  type ProviderImportScan,
} from "../model/providerSessionImport";
import type { SessionSummary } from "../data/sessionStore";

type Props = {
  onClose: () => void;
  onImported: (sessions: SessionSummary[]) => void;
};

type ProjectImportGroup = {
  cwd: string;
  sessions: DiscoveredProviderSession[];
  updatedAt: number;
};

type ProviderImportGroup = {
  provider: HarnessId;
  projects: ProjectImportGroup[];
  count: number;
  supported: boolean;
  scanning: boolean;
  error?: string;
};

export function groupProviderSessionsByProvider(
  scans: ProviderImportScan[],
): ProviderImportGroup[] {
  return HARNESSES.map((provider) => {
    const scan = scans.find((item) => item.provider === provider);
    const supported = IMPORTABLE_PROVIDERS.includes(provider as ImportableProvider);
    return {
      provider,
      projects: groupProjects(scan?.sessions ?? []),
      count: scan?.sessions.length ?? 0,
      supported,
      scanning: scan?.scanning ?? false,
      ...(scan?.error ? { error: scan.error } : {}),
    };
  });
}

function groupProjects(sessions: DiscoveredProviderSession[]): ProjectImportGroup[] {
  const groups = new Map<string, ProjectImportGroup>();
  for (const session of sessions) {
    const cwd = normalizeProjectPath(session.cwd);
    const key = pathKey(cwd);
    const current = groups.get(key);
    if (current) {
      current.sessions.push(session);
      current.updatedAt = Math.max(current.updatedAt, session.updatedAt);
    } else {
      groups.set(key, { cwd, sessions: [session], updatedAt: session.updatedAt });
    }
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      sessions: group.sessions.sort((a, b) => b.updatedAt - a.updatedAt),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt || a.cwd.localeCompare(b.cwd));
}

export function ImportSessionsDialog({ onClose, onImported }: Props) {
  const didInitialScan = useRef(false);
  const [scans, setScans] = useState<ProviderImportScan[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [selectedSessions, setSelectedSessions] = useState<Set<string>>(
    () => new Set(),
  );
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(
    () => new Set(),
  );
  const [collapsedProviders, setCollapsedProviders] = useState<Set<HarnessId>>(
    () => new Set(HARNESSES.filter((provider) => !IMPORTABLE_PROVIDERS.includes(provider as ImportableProvider))),
  );
  const [working, setWorking] = useState(false);
  const [complete, setComplete] = useState<number | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const scan = () => {
    setScans(
      IMPORTABLE_PROVIDERS.map((provider) => ({
        provider,
        sessions: [],
        scanning: true,
      })),
    );
    setScanning(true);
    setSelectedSessions(new Set());
    setCollapsedProjects(new Set());
    setCollapsedProviders(new Set(HARNESSES.filter((provider) => !IMPORTABLE_PROVIDERS.includes(provider as ImportableProvider))));
    setComplete(null);
    setSkipped(0);
    setError(null);
    void scanProviderSessions((result) => {
      setScans((current) =>
        (current ?? []).map((scan) =>
          scan.provider === result.provider
            ? { ...result, scanning: false }
            : scan,
        ),
      );
      setSelectedSessions((current) => {
        const next = new Set(current);
        for (const session of result.sessions) next.add(sessionKey(session));
        return next;
      });
    }).then(
      (next) => {
        setScans(next);
        setScanning(false);
      },
      (reason: unknown) => {
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not scan provider sessions",
        );
        setScans([]);
        setScanning(false);
      },
    );
  };

  useEffect(() => {
    if (didInitialScan.current) return;
    didInitialScan.current = true;
    scan();
  }, []);

  const selectedScans = useMemo(
    () =>
      (scans ?? [])
        .map((scan) => ({
          ...scan,
          sessions: scan.sessions.filter((session) =>
            selectedSessions.has(sessionKey(session)),
          ),
        }))
        .filter((scan) => scan.sessions.length > 0),
    [scans, selectedSessions],
  );
  const providers = useMemo(() => groupProviderSessionsByProvider(scans ?? []), [scans]);
  const foundCount = (scans ?? []).reduce(
    (total, scan) => total + scan.sessions.length,
    0,
  );
  const sessionCount = selectedScans.reduce(
    (total, scan) => total + scan.sessions.length,
    0,
  );

  const toggleProject = (project: ProjectImportGroup) => {
    const keys = project.sessions.map(sessionKey);
    setSelectedSessions((current) => {
      const next = new Set(current);
      const allSelected = keys.length > 0 && keys.every((key) => current.has(key));
      for (const key of keys) {
        if (allSelected) next.delete(key);
        else next.add(key);
      }
      return next;
    });
    setComplete(null);
  };

  const toggleSession = (session: DiscoveredProviderSession) => {
    setSelectedSessions((current) => {
      const next = new Set(current);
      const key = sessionKey(session);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setComplete(null);
  };

  const clearSelection = () => {
    setSelectedSessions(new Set());
    setComplete(null);
  };

  const toggleProviderSelection = (provider: HarnessId) => {
    const sessions =
      (scans ?? []).find((scan) => scan.provider === provider)?.sessions ?? [];
    setSelectedSessions((current) => {
      const next = new Set(current);
      const shouldSelect = !sessions.some((session) =>
        current.has(sessionKey(session)),
      );
      for (const session of sessions) {
        const key = sessionKey(session);
        if (shouldSelect) next.add(key);
        else next.delete(key);
      }
      return next;
    });
    setComplete(null);
  };

  const toggleExpanded = (provider: HarnessId, cwd: string) => {
    const key = `${provider}:${pathKey(cwd)}`;
    setCollapsedProjects((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleProvider = (provider: HarnessId) => {
    setCollapsedProviders((current) => {
      const next = new Set(current);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      return next;
    });
  };

  const importSessions = async () => {
    if (working || !scans || sessionCount === 0) return;
    setWorking(true);
    setError(null);
    try {
      const result = await importProviderSessions(selectedScans);
      onImported(result.sessions);
      setComplete(result.sessions.length);
      setSkipped(result.skipped);
      if (result.errors.length > 0) {
        setError(`${result.errors.length} chat${result.errors.length === 1 ? "" : "s"} could not be imported. ${result.errors[0]}`);
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not import sessions",
      );
    } finally {
      setWorking(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      title="Import sessions"
      description="Choose the conversations to bring into MonoCode."
      size="md"
      fitViewport
    >
      <div className="flex min-h-[360px] flex-col">
        <div className="px-5 pb-4 pt-2">
          <p className="max-w-[52ch] text-[12px] leading-5 text-content/55">
            Provider files stay on this Mac. Each selected chat becomes a MonoCode
            session linked to the provider that created it.
          </p>
        </div>

        <div className="flex-1 px-5 pb-5" aria-live="polite">
          {scans === null ? (
            <div className="flex min-h-48 items-center justify-center gap-2 text-[12px] text-content/50">
              <Loader className="size-4 animate-spin" aria-hidden />
              Looking for local sessions...
            </div>
          ) : (
            <>
              {scanning ? (
                <div className="mb-2 flex items-center justify-center gap-2 text-[11px] text-content/45" role="status">
                  <Loader className="size-3 animate-spin" aria-hidden />
                  Scanning local providers. Results appear as each finishes.
                </div>
              ) : null}
              <div className="max-h-[min(52vh,480px)] overflow-y-auto rounded-xl border border-content/8">
                {providers.map((group) => {
                  const providerSelectedCount = group.projects.reduce(
                    (count, project) =>
                      count +
                        project.sessions.filter((session) =>
                          selectedSessions.has(sessionKey(session)),
                        ).length,
                    0,
                  );
                  const providerActionLabel =
                    providerSelectedCount > 0 ? "Deselect all" : "Select all";
                  return (
                    <section key={group.provider} className="border-b border-content/8 last:border-b-0">
                      <div className="flex items-center pr-2">
                        <button
                          type="button"
                          aria-expanded={!collapsedProviders.has(group.provider)}
                          aria-label={`${HARNESS_TITLE[group.provider]} projects`}
                          onClick={() => toggleProvider(group.provider)}
                          className="flex min-w-0 flex-1 items-center gap-2.5 px-3.5 py-3 text-left hover:bg-content/[0.045]"
                        >
                          <ChevronDown
                            className={`size-3.5 shrink-0 text-content/40 transition-transform ${collapsedProviders.has(group.provider) ? "-rotate-90" : ""}`}
                            aria-hidden
                          />
                          <HarnessIcon harness={group.provider} className="size-4 shrink-0 text-content/65" />
                          <span className="min-w-0 flex-1 text-[12px] font-medium text-content/85">
                            {HARNESS_TITLE[group.provider]}
                          </span>
                          <span className="text-[11px] text-content/40">
                            {!group.supported ? "Import unavailable" : group.scanning ? "Scanning..." : `${group.count} chat${group.count === 1 ? "" : "s"}`}
                          </span>
                        </button>
                        {group.count > 0 ? (
                          <button
                            type="button"
                            aria-label={`${providerActionLabel} ${HARNESS_TITLE[group.provider]} sessions`}
                            aria-pressed={providerSelectedCount > 0}
                            onClick={() => toggleProviderSelection(group.provider)}
                            disabled={working || group.scanning}
                            className="shrink-0 rounded-md px-2 py-1.5 text-[11px] text-content/45 hover:bg-content/7 hover:text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 disabled:cursor-default disabled:opacity-35"
                          >
                            {providerActionLabel}
                          </button>
                        ) : null}
                      </div>
                      {!collapsedProviders.has(group.provider) ? (
                        <div className="border-t border-content/6 bg-content/[0.018]">
                          {group.projects.map((project) => (
                            <ProjectImportSection
                              key={pathKey(project.cwd)}
                              provider={group.provider}
                              project={project}
                              expanded={!collapsedProjects.has(`${group.provider}:${pathKey(project.cwd)}`)}
                              selectedSessions={selectedSessions}
                              onToggleExpanded={() => toggleExpanded(group.provider, project.cwd)}
                              onToggleProject={() => toggleProject(project)}
                              onToggleSession={toggleSession}
                            />
                          ))}
                          {group.error ? (
                            <p className="px-4 py-2 text-[11px] text-red-400" role="alert">{group.error}</p>
                          ) : group.supported && !group.scanning && group.count === 0 ? (
                            <p className="px-4 py-2 text-[11px] text-content/40">No local chats found.</p>
                          ) : !group.supported ? (
                            <p className="px-4 py-2 text-[11px] text-content/40">History import is not supported yet.</p>
                          ) : null}
                        </div>
                      ) : null}
                    </section>
                  );
                })}
              </div>
            </>
          )}

          {!scanning && scans?.every((scan) => scan.sessions.length === 0) ? (
            <p className="mt-4 text-center text-[11px] leading-4 text-content/40">
              No readable sessions found in the supported providers.
            </p>
          ) : null}
          {error ? (
            <p className="mt-3 text-[11px] leading-4 text-red-400" role="alert">
              {error}
            </p>
          ) : null}
          {complete !== null ? (
            <div className="mt-4 flex items-center gap-2 text-[12px] text-content/70" role="status">
              <Check className="size-3.5 text-emerald-400" aria-hidden />
              {complete} session{complete === 1 ? "" : "s"} imported
              {skipped > 0 ? `, ${skipped} already in MonoCode` : ""}.
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-content/8 px-5 py-3">
          <button
            type="button"
            onClick={scan}
            disabled={working || scanning || scans === null}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] text-content/55 hover:bg-content/7 hover:text-content disabled:opacity-35"
          >
            <RefreshCw className="size-3.5" aria-hidden />
            Scan again
          </button>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-content/40">
              {sessionCount} of {foundCount} chat{foundCount === 1 ? "" : "s"} selected
            </span>
            <button
              type="button"
              aria-label="Deselect all sessions"
              onClick={clearSelection}
              disabled={working || scanning || sessionCount === 0}
              className="h-8 rounded-lg px-2 text-[11px] text-content/55 hover:bg-content/7 hover:text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 disabled:cursor-default disabled:opacity-35"
            >
              Deselect all
            </button>
            <button
              type="button"
              autoFocus
              onClick={complete !== null ? onClose : () => void importSessions()}
              disabled={working || scanning || (complete === null && sessionCount === 0)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-content px-3 text-[12px] font-medium text-background-base hover:bg-content/85 disabled:cursor-default disabled:opacity-40"
            >
              {working ? <Loader className="size-3.5 animate-spin" aria-hidden /> : null}
              {complete !== null
                ? "Done"
                : working
                  ? "Importing..."
                  : "Import sessions"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ProjectImportSection({
  provider,
  project,
  expanded,
  selectedSessions,
  onToggleExpanded,
  onToggleProject,
  onToggleSession,
}: {
  provider: HarnessId;
  project: ProjectImportGroup;
  expanded: boolean;
  selectedSessions: Set<string>;
  onToggleExpanded: () => void;
  onToggleProject: () => void;
  onToggleSession: (session: DiscoveredProviderSession) => void;
}) {
  const count = project.sessions.length;
  const selectedCount = project.sessions.filter((session) =>
    selectedSessions.has(sessionKey(session)),
  ).length;
  const allSelected = count > 0 && selectedCount === count;
  const projectName = basename(project.cwd) || project.cwd;
  return (
    <section className="border-b border-content/6 last:border-b-0">
      <div className="flex items-center gap-2 py-2.5 pl-8 pr-3.5 hover:bg-content/[0.035]">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={onToggleExpanded}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <ChevronDown
            className={`size-3.5 shrink-0 text-content/40 transition-transform ${expanded ? "" : "-rotate-90"}`}
            aria-hidden
          />
          <span className="min-w-0 flex-1">
            <span className="block text-[12px] font-medium text-content/85">
              {projectName}
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-content/40" title={project.cwd}>
              {project.cwd}
            </span>
          </span>
        </button>
        <button
          type="button"
          aria-pressed={allSelected}
          aria-label={`${allSelected ? "Deselect" : "Select"} all ${HARNESS_TITLE[provider]} sessions in ${projectName}`}
          onClick={onToggleProject}
          className="flex shrink-0 items-center gap-2 rounded-md px-1.5 py-1 text-[11px] text-content/45 hover:bg-content/7 hover:text-content"
        >
          {selectedCount}/{count}
          <span
            aria-hidden
            className={`grid size-4 place-items-center rounded border ${allSelected ? "border-accent bg-accent text-background-base" : "border-content/20"}`}
          >
            {allSelected ? <Check className="size-3" strokeWidth={2} /> : null}
          </span>
        </button>
      </div>
      {expanded ? (
        <div className="border-t border-content/6 bg-content/[0.018] py-1.5 pl-9 pr-2">
          {project.sessions.map((session) => (
            <ChatImportRow
              key={sessionKey(session)}
              session={session}
              selected={selectedSessions.has(sessionKey(session))}
              onToggle={() => onToggleSession(session)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ChatImportRow({
  session,
  selected,
  onToggle,
}: {
  session: DiscoveredProviderSession;
  selected: boolean;
  onToggle: () => void;
}) {
  const updated = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(session.updatedAt);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-content/[0.05]"
    >
      <span
        aria-hidden
        className={`grid size-4 shrink-0 place-items-center rounded border ${selected ? "border-accent bg-accent text-background-base" : "border-content/20"}`}
      >
        {selected ? <Check className="size-3" strokeWidth={2} /> : null}
      </span>
      <HarnessIcon harness={session.provider} className="size-4 shrink-0 text-content/50" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] text-content/80" title={session.title}>
          {session.title}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-content/40">
          {HARNESS_TITLE[session.provider]} · {updated}
        </span>
      </span>
      <span className="shrink-0 text-[10px] text-content/35">
        {session.isPartial ? "~" : ""}{session.blocks.length}{session.isPartial ? "+" : ""} msg{session.blocks.length === 1 && !session.isPartial ? "" : "s"}
      </span>
    </button>
  );
}

function sessionKey(session: DiscoveredProviderSession): string {
  return `${session.provider}:${session.providerSessionId}`;
}
