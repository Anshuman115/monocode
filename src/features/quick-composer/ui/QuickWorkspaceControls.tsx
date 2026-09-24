import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Folder, FolderTree } from "../../../shared/ui/icons";
import { notifyGitChanged } from "../../../platform/tauri/fs";
import { GitPickerTrigger } from "../../source-control/ui/GitPickerTrigger";
import { useProjectBranchesState } from "../../source-control/hooks/useProjectBranches";
import {
  QUICK_GIT_RESULT,
  type QuickGitKind,
  type QuickGitRequest,
  type QuickGitResult,
} from "../model/quickGitPopup";
import type { QuickWorkspace } from "../model/quickWorkspace";

export function QuickWorkspaceControls({
  value,
  enabled,
  onChange,
  onOpenChange,
  onClose,
  onError,
}: {
  value: QuickWorkspace;
  enabled: boolean;
  onChange: (choice: QuickWorkspace) => void;
  onOpenChange: (open: boolean) => void;
  onClose: () => void;
  onError?: (error: string) => void;
}) {
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState<QuickGitKind | null>(null);
  const active = useRef<string | null>(null);
  const props = useRef({ value, onChange, onOpenChange, onClose, onError });
  props.current = { value, onChange, onOpenChange, onClose, onError };
  const cwd = value.tree?.path ?? value.cwd ?? "";
  const { branches, settled } = useProjectBranchesState(cwd, enabled && !!cwd);
  const base = value.base || branches?.current || "HEAD";

  const cancel = () => {
    const id = active.current;
    active.current = null;
    setOpen(null);
    props.current.onOpenChange(false);
    if (id)
      void invoke("quick_git_complete", {
        id,
        choice: null,
        restoreFocus: false,
      }).catch(() => undefined);
  };
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen<QuickGitResult>(QUICK_GIT_RESULT, ({ payload }) => {
      if (payload.id !== active.current) return;
      active.current = null;
      setOpen(null);
      props.current.onOpenChange(false);
      if (payload.choice && payload.choice.cwd === props.current.value.cwd)
        props.current.onChange(payload.choice);
      notifyGitChanged();
      if (payload.restoreFocus) props.current.onClose();
    })
      .then((unlisten) => {
        if (disposed) unlisten();
        else {
          stop = unlisten;
          setReady(true);
        }
      })
      .catch((error) => props.current.onError?.(String(error)));
    return () => {
      disposed = true;
      stop?.();
      const id = active.current;
      active.current = null;
      if (id)
        void invoke("quick_git_complete", {
          id,
          choice: null,
          restoreFocus: false,
        }).catch(() => undefined);
    };
  }, []);
  useEffect(() => {
    if (!enabled) cancel();
  }, [enabled]);

  const show = async (kind: QuickGitKind, button: HTMLButtonElement) => {
    if (open === kind) {
      cancel();
      return;
    }
    const id = crypto.randomUUID();
    const bounds = button.getBoundingClientRect();
    const request: QuickGitRequest = {
      id,
      kind,
      choice: { ...value, base: value.mode === "worktree" ? base : undefined },
      branches: branches ?? undefined,
      anchor: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      },
    };
    active.current = id;
    setOpen(kind);
    onOpenChange(true);
    try {
      await invoke("quick_git_open", { request });
    } catch (error) {
      if (active.current !== id) return;
      active.current = null;
      setOpen(null);
      props.current.onOpenChange(false);
      props.current.onError?.(String(error));
    }
  };
  const disabled = !enabled || !ready || !branches?.current;
  const Icon = value.mode === "worktree" ? FolderTree : Folder;
  const label = value.mode === "worktree" ? "New worktree" : "Current checkout";
  return (
    <div className="flex min-w-0 items-center gap-2 pl-1.5">
      <button
        type="button"
        disabled={disabled}
        aria-label={`Workspace ${label}`}
        aria-haspopup="dialog"
        aria-expanded={open === "workspace"}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => void show("workspace", event.currentTarget)}
        className="-ml-1.5 flex h-6 min-w-0 max-w-48 items-center gap-1.5 rounded-md px-1.5 text-[12px] text-content/55 hover:bg-content/8 hover:text-content aria-expanded:bg-content/8 aria-expanded:text-content disabled:opacity-40"
      >
        <Icon className="size-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </button>
      <GitPickerTrigger
        label={
          value.mode === "worktree"
            ? `From ${base}`
            : branches?.current || (settled ? "No repo" : "Loading…")
        }
        aria-label={
          value.mode === "worktree"
            ? `Create worktree from ${base}`
            : "Choose branch"
        }
        aria-haspopup="dialog"
        aria-expanded={open === "branch" || open === "base"}
        loading={!settled}
        disabled={disabled}
        worktree={!!value.tree && !value.tree.isMain}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) =>
          void show(
            value.mode === "worktree" ? "base" : "branch",
            event.currentTarget,
          )
        }
      />
    </div>
  );
}
