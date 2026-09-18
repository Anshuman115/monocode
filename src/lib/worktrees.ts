import { invoke } from "@tauri-apps/api/core";
import { notifyGitChanged } from "./fs";
import { isFilesystemTab, type FilePaneTab } from "./layout";
import { isEqualOrInside, pathKey } from "./paths";
import { isBlankSession } from "./projectReturn";
import { newSession, sessionWorkCwd, type Session } from "./session";

export type Worktree = {
  path: string;
  branch: string | null;
  head: string;
  isMain: boolean;
  locked: boolean;
  prunable: boolean;
  missing: boolean;
  dirty: boolean | null;
  unpushed: number | null;
  sessionIds: string[];
};
export type Worktrees = { worktrees: Worktree[]; defaultRoot: string };

export const listWorktrees = (cwd: string) =>
  invoke<Worktrees>("git_worktrees", { cwd });

export async function createWorktree(
  cwd: string,
  branch: string,
  base: string,
  existing: boolean,
) {
  const tree = await invoke<Worktree>("git_worktree_create", {
    cwd,
    branch,
    base,
    existing,
  });
  notifyGitChanged();
  return tree;
}

export async function removeWorktree(cwd: string, path: string, force = false) {
  await invoke("git_worktree_remove", { cwd, path, force });
  notifyGitChanged();
}

/** Read-only preflight; final removal must still recheck for new blockers. */
export const checkWorktreeRemoval: RemoveWorktree = (cwd, path, force) =>
  invoke("git_worktree_check_remove", { cwd, path, force });

export function assertWorktreeFilesClosed(
  path: string,
  files: readonly FilePaneTab[],
) {
  if (
    files.some(
      (file) =>
        isEqualOrInside(file.cwd, path) ||
        (isFilesystemTab(file) && isEqualOrInside(file.path, path)),
    )
  ) {
    throw new Error(
      "Close the files and terminals open in this worktree first.",
    );
  }
}

export function worktreeSessionIds(
  tree: Worktree,
  sessions: readonly Pick<Session, "id" | "cwd" | "worktreeCwd">[],
) {
  const ids = new Set(tree.sessionIds);
  for (const session of sessions) {
    // Live sessions override their last saved context.
    ids.delete(session.id);
    if (isEqualOrInside(session.worktreeCwd || session.cwd, tree.path))
      ids.add(session.id);
  }
  return [...ids];
}

/** Started conversations stay in their working copy; selecting another starts fresh. */
export function sessionInWorktree(session: Session, tree: Worktree): Session {
  if (pathKey(sessionWorkCwd(session)) === pathKey(tree.path)) return session;
  const target = isBlankSession(session)
    ? session
    : {
        ...newSession(
          session.harness,
          session.cwd,
          session.model,
          session.runtimeMode,
          session.modelSettings,
        ),
        providerAccountId: session.providerAccountId,
      };
  return {
    ...target,
    worktreeCwd:
      pathKey(tree.path) === pathKey(session.cwd) ? undefined : tree.path,
    branch: tree.branch ?? undefined,
    providerSessionId: undefined,
    context: undefined,
    pendingSwitch: undefined,
  };
}

export type RemoveWorktree = (
  cwd: string,
  path: string,
  force: boolean,
) => Promise<void>;
