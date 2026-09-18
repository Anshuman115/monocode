import { useMemo, useState } from "react";
import { CreateWorktreeDialog } from "../chrome/CreateWorktreeDialog";
import { DeleteWorktreeDialog } from "../chrome/DeleteWorktreeDialog";
import { SearchableProjectPicker } from "../chrome/SearchableProjectPicker";
import {
  FolderOpen,
  FolderTree,
  GitBranch,
  Loader,
  Plus,
  RefreshCw,
  Trash2,
} from "../chrome/icons";
import { revealPath } from "../lib/fs";
import { useProjectWorktrees } from "../hooks/useProjectWorktrees";
import { pathKey, prettyCwd } from "../lib/paths";
import { loadArchivedProjects, type RecentProject } from "../lib/recents";
import type { Session } from "../lib/session";
import {
  checkWorktreeRemoval,
  worktreeSessionIds,
  type RemoveWorktree,
  type Worktree,
} from "../lib/worktrees";

export function WorktreesPage({
  cwd,
  recents = [],
  liveSessions = [],
  onRemove,
  onCheckRemove = checkWorktreeRemoval,
  onDeleteSessions,
}: {
  cwd: string;
  recents?: RecentProject[];
  liveSessions?: Session[];
  onRemove: RemoveWorktree;
  onCheckRemove?: RemoveWorktree;
  onDeleteSessions?: (sessionIds: readonly string[]) => Promise<boolean>;
}) {
  const projects = useMemo(() => {
    const choices: RecentProject[] = [];
    const seen = new Set<string>();
    const add = (choice: RecentProject) => {
      if (!choice.path || choice.path === "~") return;
      const key = pathKey(choice.path);
      if (seen.has(key)) return;
      seen.add(key);
      choices.push(choice);
    };
    add({ path: cwd, openedAt: Number.MAX_SAFE_INTEGER });
    recents.forEach(add);
    loadArchivedProjects().forEach((item) =>
      add({ path: item.path, openedAt: item.archivedAt }),
    );
    return choices;
  }, [cwd, recents]);
  const [project, setProject] = useState(
    cwd === "~" ? (projects[0]?.path ?? "") : cwd,
  );
  const { data, error: loadError, refresh } = useProjectWorktrees(project);
  const [error, setError] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Worktree>();
  return (
    <div
      data-setting-id="project-worktrees"
      id="setting-project-worktrees"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-center gap-1">
        <SearchableProjectPicker
          cwd={project || "~"}
          recents={projects}
          className="w-fit max-w-full shrink-0"
          buttonClassName="h-7.5 max-w-full gap-2 bg-content/5 px-2.5 text-[13px] hover:bg-content/12 active:scale-[0.98]"
          onSelectProject={(path) => {
            setProject(path);
            setError(undefined);
            setDeleting(undefined);
          }}
        />
        <button
          type="button"
          disabled={!data}
          onClick={() => setCreating(true)}
          className="flex h-7.5 items-center gap-1.5 rounded-md px-2 text-[11px] hover:bg-content/12 disabled:opacity-40 active:scale-[0.97]"
        >
          <Plus className="size-3" />
          Create worktree
        </button>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-[12px] text-content/50">
          Sessions can share a worktree. Deleting one also deletes its sessions
          and uncommitted changes. Its branch and commits are kept.
        </p>
        <button
          type="button"
          title={
            loadError
              ? `Refresh failed: ${loadError}. Click to retry.`
              : "Refresh worktrees"
          }
          aria-label="Refresh worktrees"
          disabled={!project}
          onClick={refresh}
          className={`flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-content/8 px-2 text-[11px] hover:bg-content/12 disabled:opacity-40 active:scale-[0.97] ${loadError ? "text-red-400" : "text-content/65"}`}
        >
          <RefreshCw className="size-3.5" />
          <span>Refresh</span>
        </button>
      </div>
      {error && (
        <p role="alert" className="break-words text-[12px] text-red-400">
          {error}
        </p>
      )}
      {!project ? (
        <p className="text-[12px] text-content/50">
          Add a project to manage its worktrees.
        </p>
      ) : !data && loadError ? (
        <p role="alert" className="break-words text-[12px] text-red-400">
          {loadError}
        </p>
      ) : !data ? (
        <p className="flex items-center gap-2 text-[12px] text-content/50">
          <Loader className="size-4 animate-spin" />
          Loading worktrees…
        </p>
      ) : (
        <div className="divide-y divide-stroke overflow-hidden rounded-xl border border-stroke">
          {data.worktrees.map((tree) => {
            const count = worktreeSessionIds(tree, liveSessions).length;
            const blocked = tree.locked
              ? "Unlock this worktree in Git first"
              : !tree.branch
                ? "Create a branch before deleting this detached worktree"
                : undefined;
            return (
              <div key={tree.path} className="flex items-start gap-3 p-4">
                {tree.isMain ? (
                  <GitBranch className="mt-0.5 size-4 shrink-0 text-content/45" />
                ) : (
                  <FolderTree className="mt-0.5 size-4 shrink-0 text-content/45" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium">
                      {tree.branch ?? `Detached ${tree.head.slice(0, 7)}`}
                    </span>
                    {tree.isMain && (
                      <span className="rounded bg-content/8 px-1.5 py-0.5 text-[10px] text-content/50">
                        Main working copy
                      </span>
                    )}
                    {pathKey(tree.path) === pathKey(project) &&
                      !tree.isMain && (
                        <span className="text-[10px] text-content/40">
                          Project working copy
                        </span>
                      )}
                  </div>
                  <p className="mt-1 break-all text-[11px] text-content/40">
                    {prettyCwd(tree.path)}
                  </p>
                  <p className="mt-2 flex flex-wrap gap-x-3 text-[11px] text-content/55">
                    <span>
                      {count} session{count === 1 ? "" : "s"}
                    </span>
                    <span className={tree.dirty ? "text-amber-400" : ""}>
                      {tree.missing
                        ? "Missing folder"
                        : tree.dirty == null
                          ? "Status unavailable"
                          : tree.dirty
                            ? "Uncommitted changes"
                            : "Clean"}
                    </span>
                    {!!tree.unpushed && (
                      <span>
                        {tree.unpushed} unpublished commit
                        {tree.unpushed === 1 ? "" : "s"}
                      </span>
                    )}
                    {tree.locked && <span>Locked</span>}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={tree.missing}
                  aria-label={`Reveal ${tree.branch ?? "worktree"}`}
                  title="Reveal folder"
                  onClick={() =>
                    void revealPath(tree.path).catch((e) => setError(String(e)))
                  }
                  className="rounded-md p-1.5 text-content/40 hover:bg-content/8 hover:text-content disabled:opacity-30"
                >
                  <FolderOpen className="size-4" />
                </button>
                {!tree.isMain && (
                  <button
                    type="button"
                    disabled={!!blocked}
                    aria-label={`Delete ${tree.branch ?? "worktree"}`}
                    title={blocked ?? "Delete worktree"}
                    onClick={() => setDeleting(tree)}
                    className="rounded-md p-1.5 text-content/40 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-25"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {data && (
        <p className="break-all text-[11px] text-content/40">
          New worktrees are created in {prettyCwd(data.defaultRoot)}.
        </p>
      )}
      {creating && (
        <CreateWorktreeDialog
          cwd={project}
          baseCwd={project}
          defaultRoot={data?.defaultRoot}
          onCreated={() => {
            setCreating(false);
            refresh();
          }}
          onCancel={() => setCreating(false)}
        />
      )}
      {deleting && (
        <DeleteWorktreeDialog
          cwd={project}
          tree={deleting}
          sessionCount={worktreeSessionIds(deleting, liveSessions).length}
          onRemove={async (cwd, path, force) => {
            // Check predictable blockers before any conversation is destroyed.
            await onCheckRemove(cwd, path, force);
            const sessionIds = worktreeSessionIds(deleting, liveSessions);
            if (sessionIds.length) {
              if (!onDeleteSessions) {
                throw new Error(
                  "Sessions still use this worktree and could not be deleted.",
                );
              }
              if (!(await onDeleteSessions(sessionIds))) {
                throw new Error(
                  "Some sessions could not be deleted, so the worktree was kept.",
                );
              }
            }
            try {
              await onRemove(cwd, path, force);
            } catch (error) {
              if (sessionIds.length) {
                refresh();
                throw new Error(
                  `The sessions were deleted, but the worktree was kept. ${String(error)}`,
                );
              }
              throw error;
            }
          }}
          onClose={() => setDeleting(undefined)}
          onDeleted={() => {
            setDeleting(undefined);
            refresh();
          }}
        />
      )}
    </div>
  );
}
