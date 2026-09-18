use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use tauri::State;

use crate::fs::{expand_home, git_checked, path_to_js};
use crate::session_store::SessionStore;

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub path: String,
    pub branch: Option<String>,
    pub head: String,
    pub is_main: bool,
    pub locked: bool,
    pub prunable: bool,
    pub missing: bool,
    pub dirty: Option<bool>,
    pub unpushed: Option<u64>,
    pub session_ids: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktrees {
    pub worktrees: Vec<Worktree>,
    pub default_root: String,
}

fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    let mut command = Command::new("git");
    crate::hide_window_console(&mut command);
    let output = command
        .arg("-C")
        .arg(root)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    String::from_utf8(output.stdout).map_err(|_| "Git returned a non-UTF-8 path".into())
}

fn parse_worktrees(text: &str) -> Vec<Worktree> {
    let mut result = Vec::new();
    let mut current = Worktree::default();
    for field in text.split('\0') {
        if field.is_empty() {
            if !current.path.is_empty() {
                current.is_main = result.is_empty();
                result.push(std::mem::take(&mut current));
            }
        } else if let Some(path) = field.strip_prefix("worktree ") {
            current.path = path_to_js(Path::new(path));
        } else if let Some(head) = field.strip_prefix("HEAD ") {
            current.head = head.into();
        } else if let Some(branch) = field.strip_prefix("branch refs/heads/") {
            current.branch = Some(branch.into());
        } else if field == "locked" || field.starts_with("locked ") {
            current.locked = true;
        } else if field == "prunable" || field.starts_with("prunable ") {
            current.prunable = true;
        }
    }
    result
}

fn list(root: &Path) -> Result<Vec<Worktree>, String> {
    Ok(parse_worktrees(&git(
        root,
        &["worktree", "list", "--porcelain", "-z"],
    )?))
}

fn same_path(a: &Path, b: &Path) -> bool {
    let a = a.canonicalize().unwrap_or_else(|_| a.to_path_buf());
    let b = b.canonicalize().unwrap_or_else(|_| b.to_path_buf());
    if cfg!(windows) {
        a.to_string_lossy()
            .eq_ignore_ascii_case(&b.to_string_lossy())
    } else {
        a == b
    }
}

pub(crate) fn contains_working_dir(root: &Path, cwd: &Path) -> bool {
    let root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let cwd = cwd.canonicalize().unwrap_or_else(|_| cwd.to_path_buf());
    if cfg!(windows) {
        let root = path_to_js(&root).to_lowercase();
        let cwd = path_to_js(&cwd).to_lowercase();
        cwd == root || cwd.starts_with(&format!("{}/", root.trim_end_matches('/')))
    } else {
        cwd.starts_with(root)
    }
}

fn session_ids(conn: &rusqlite::Connection, path: &Path) -> Result<Vec<String>, String> {
    let mut query = conn
        .prepare("SELECT id, COALESCE(NULLIF(worktree_cwd, ''), cwd) FROM sessions")
        .map_err(|e| e.to_string())?;
    let rows = query
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let mut ids = Vec::new();
    for row in rows {
        let (id, cwd) = row.map_err(|e| e.to_string())?;
        let cwd = expand_home(&cwd);
        if contains_working_dir(path, &cwd) {
            ids.push(id);
        }
    }
    Ok(ids)
}

fn default_root(main: &Path) -> PathBuf {
    let name = main.file_name().unwrap_or_default().to_string_lossy();
    main.with_file_name(format!("{name}-worktrees"))
}

#[tauri::command(async)]
pub fn git_worktrees(cwd: String, store: State<'_, SessionStore>) -> Result<Worktrees, String> {
    let mut worktrees = list(&expand_home(&cwd))?;
    let main = worktrees.first().ok_or("No working copies found")?;
    let default_root = path_to_js(&default_root(Path::new(&main.path)));
    {
        let conn = store.lock_conn()?;
        for tree in &mut worktrees {
            tree.session_ids = session_ids(&conn, Path::new(&tree.path))?;
        }
    }
    for tree in &mut worktrees {
        let path = Path::new(&tree.path);
        tree.missing = !path.is_dir();
        if !tree.missing {
            tree.dirty = git(path, &["status", "--porcelain", "--untracked-files=normal"])
                .ok()
                .map(|status| !status.is_empty());
            tree.unpushed = git(path, &["rev-list", "--count", "HEAD", "--not", "--remotes"])
                .ok()
                .and_then(|count| count.trim().parse().ok());
        }
    }
    Ok(Worktrees {
        worktrees,
        default_root,
    })
}

fn create(root: &Path, branch: &str, base: &str, existing: bool) -> Result<Worktree, String> {
    let branch = branch.trim();
    if branch.starts_with('-') || branch.starts_with('@') || branch.is_empty() {
        return Err("Enter a valid branch name".into());
    }
    git(root, &["check-ref-format", "--branch", branch])?;
    let trees = list(root)?;
    if trees
        .iter()
        .any(|tree| tree.branch.as_deref() == Some(branch))
    {
        return Err("This branch already has a working copy. Select it from the picker.".into());
    }
    let main = trees.first().ok_or("No working copies found")?;
    let parent = default_root(Path::new(&main.path));
    let slug: String = branch
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let path = parent.join(slug);
    if path.exists() {
        return Err(format!(
            "{} already exists. Choose another branch name.",
            path.display()
        ));
    }
    // Resolve user-supplied refs before passing them to worktree add. Never
    // interpret a ref as an option, and only accept existing local branches.
    let source = if existing {
        format!("refs/heads/{branch}")
    } else {
        base.trim().to_owned()
    };
    let commit = git(
        root,
        &[
            "rev-parse",
            "--verify",
            "--end-of-options",
            &format!("{source}^{{commit}}"),
        ],
    )?;
    std::fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
    let path_str = path_to_js(&path);
    if existing {
        git_checked(root, &["worktree", "add", "--", &path_str, branch])?;
    } else {
        git_checked(
            root,
            &[
                "worktree",
                "add",
                "--no-track",
                "-b",
                branch,
                "--",
                &path_str,
                commit.trim(),
            ],
        )?;
    }
    list(root)?
        .into_iter()
        .find(|tree| same_path(Path::new(&tree.path), &path))
        .ok_or_else(|| {
            "Worktree created, but could not be found. Refresh the working copies.".into()
        })
}

#[tauri::command(async)]
pub fn git_worktree_create(
    cwd: String,
    branch: String,
    base: String,
    existing: bool,
) -> Result<Worktree, String> {
    create(&expand_home(&cwd), &branch, &base, existing)
}

fn removal_target(root: &Path, path: &Path) -> Result<Worktree, String> {
    let tree = list(root)?
        .into_iter()
        .find(|tree| same_path(Path::new(&tree.path), path))
        .ok_or("This path is not a registered worktree of this repository")?;
    if tree.is_main {
        return Err("The main working copy cannot be deleted".into());
    }
    if tree.locked {
        return Err("This worktree is locked. Unlock it in Git before deleting it.".into());
    }
    if tree.branch.is_none() {
        // There is no branch retaining detached commits after removal.
        return Err("Create a branch for this detached worktree before deleting it.".into());
    }
    Ok(tree)
}

#[tauri::command(async)]
pub fn git_worktree_check_remove(
    cwd: String,
    path: String,
    force: bool,
    terminals: State<'_, crate::pty::PtyHost>,
) -> Result<(), String> {
    let path = expand_home(&path);
    check_removal(
        &expand_home(&cwd),
        &path,
        force,
        terminals.has_working_dir(&path),
    )
}

fn check_removal(root: &Path, path: &Path, force: bool, has_terminals: bool) -> Result<(), String> {
    let tree = removal_target(root, path)?;
    if has_terminals {
        return Err("Close the terminals using this worktree first.".into());
    }
    // Sessions and their agents still exist during preflight. The actual
    // removal below checks them again after the session deletion lifecycle.
    if !force
        && !git(
            Path::new(&tree.path),
            &["status", "--porcelain", "--untracked-files=normal"],
        )?
        .is_empty()
    {
        return Err("This worktree has uncommitted or untracked changes.".into());
    }
    Ok(())
}

fn remove(root: &Path, path: &Path, force: bool) -> Result<(), String> {
    let tree = removal_target(root, path)?;
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.extend(["--", tree.path.as_str()]);
    git_checked(root, &args)
}

#[tauri::command(async)]
pub fn git_worktree_remove(
    cwd: String,
    path: String,
    force: bool,
    store: State<'_, SessionStore>,
    terminals: State<'_, crate::pty::PtyHost>,
    agents: State<'_, crate::harness::HarnessHost>,
) -> Result<(), String> {
    let path = expand_home(&path);
    if terminals.has_working_dir(&path) || agents.has_working_dir(&path) {
        return Err("Close the terminals and agent processes using this worktree first.".into());
    }
    // Hold the store lock through deletion so a concurrent save cannot attach
    // a conversation between the reference check and git worktree remove.
    let conn = store.lock_conn()?;
    if !session_ids(&conn, &path)?.is_empty() {
        return Err("Sessions still use this worktree. Move or delete those sessions first (including archived sessions).".into());
    }
    remove(&expand_home(&cwd), &path, force)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Repo(PathBuf);
    impl Drop for Repo {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn repo() -> Repo {
        let dir =
            std::env::temp_dir().join(format!("monocode-worktree-test-{}", uuid::Uuid::new_v4()));
        let root = dir.join("repo");
        std::fs::create_dir_all(&root).unwrap();
        git_checked(&root, &["init", "-b", "main"]).unwrap();
        git_checked(
            &root,
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "--allow-empty",
                "-m",
                "initial",
            ],
        )
        .unwrap();
        Repo(dir)
    }

    #[test]
    fn parses_literal_paths_and_worktree_flags() {
        let trees = parse_worktrees("worktree /repo\0HEAD abc\0branch refs/heads/main\0\0worktree /a\nquoted\"path\0HEAD def\0detached\0locked reason\0prunable missing\0\0");
        assert!(trees[0].is_main);
        assert_eq!(trees[1].path, "/a\nquoted\"path");
        assert!(trees[1].locked && trees[1].prunable);
        assert!(!trees[1].is_main);
    }

    #[test]
    fn isolates_changes_and_preserves_branch_on_removal() {
        let repo = repo();
        let root = repo.0.join("repo");
        std::fs::write(root.join("main-only"), "main change").unwrap();
        git_checked(&root, &["add", "main-only"]).unwrap();
        let tree = create(&root, "feature/test", "main", false).unwrap();
        let path = Path::new(&tree.path);
        assert!(!path.join("main-only").exists());
        assert!(git(path, &["diff", "--cached", "--name-only"])
            .unwrap()
            .is_empty());
        std::fs::write(path.join("feature-only"), "feature change").unwrap();
        git_checked(path, &["add", "feature-only"]).unwrap();
        git_checked(
            path,
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "-m",
                "feature commit",
            ],
        )
        .unwrap();
        let commit = git(path, &["rev-parse", "HEAD"]).unwrap();
        assert_ne!(commit, git(&root, &["rev-parse", "HEAD"]).unwrap());
        assert_eq!(
            git(&root, &["diff", "--cached", "--name-only"])
                .unwrap()
                .trim(),
            "main-only"
        );
        assert!(!root.join("feature-only").exists());
        std::fs::write(path.join("uncommitted"), "keep unless forced").unwrap();
        assert!(remove(&root, path, false).is_err());
        assert!(path.join("uncommitted").exists());
        assert!(remove(&root, &root, true).is_err());
        remove(&root, path, true).unwrap();
        assert!(root.join("main-only").exists());
        assert_eq!(
            git(&root, &["rev-parse", "--verify", "refs/heads/feature/test"]).unwrap(),
            commit
        );
    }

    #[test]
    fn reuses_branches_and_rejects_locked_or_unregistered_paths() {
        let repo = repo();
        let root = repo.0.join("repo");
        git_checked(&root, &["branch", "existing"]).unwrap();
        let tree = create(&root, "existing", "HEAD", true).unwrap();
        assert!(create(&root, "existing", "HEAD", true).is_err());
        assert!(create(&root, "main", "HEAD", true).is_err());
        assert!(create(&root, "bad name", "HEAD", false).is_err());
        assert!(create(&root, "valid", "--help", false).is_err());
        git_checked(&root, &["worktree", "lock", &tree.path]).unwrap();
        assert!(remove(&root, Path::new(&tree.path), true).is_err());
        assert!(remove(&root, &repo.0, true).is_err());
    }

    #[test]
    fn removal_preflight_is_read_only_and_rejects_blockers() {
        let repo = repo();
        let root = repo.0.join("repo");
        let tree = create(&root, "feature", "main", false).unwrap();
        let path = Path::new(&tree.path);
        std::fs::write(path.join("keep-me"), "local changes").unwrap();
        assert!(check_removal(&root, path, true, true)
            .unwrap_err()
            .contains("terminals"));
        assert!(check_removal(&root, path, false, false).is_err());
        check_removal(&root, path, true, false).unwrap();
        assert!(path.join("keep-me").exists());
        assert_eq!(list(&root).unwrap().len(), 2);
        assert!(check_removal(&root, &root, true, false).is_err());
        assert!(check_removal(&root, &repo.0, true, false).is_err());
        git_checked(&root, &["worktree", "lock", &tree.path]).unwrap();
        assert!(check_removal(&root, path, true, false)
            .unwrap_err()
            .contains("locked"));
        assert!(path.join("keep-me").exists());
    }

    #[test]
    fn references_include_archived_sessions_and_directly_opened_worktrees() {
        let repo = repo();
        let root = repo.0.join("repo");
        let tree = create(&root, "feature", "main", false).unwrap();
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        for (id, cwd, worktree, archived) in [
            ("shared", path_to_js(&root), Some(tree.path.clone()), 0),
            ("archived", path_to_js(&root), Some(tree.path.clone()), 1),
            ("direct", tree.path.clone(), None, 0),
            ("main", path_to_js(&root), None, 0),
        ] {
            conn.execute(
                "INSERT INTO sessions (id, cwd, harness, model, runtime_mode, title, blocks_json, created_at, updated_at, worktree_cwd, archived) VALUES (?1, ?2, 'codex', 'test', 'supervised', 'Test', '[]', 0, 0, ?3, ?4)",
                rusqlite::params![id, cwd, worktree, archived],
            ).unwrap();
        }
        let mut ids = session_ids(&conn, Path::new(&tree.path)).unwrap();
        ids.sort();
        assert_eq!(ids, vec!["archived", "direct", "shared"]);
        assert!(!contains_working_dir(
            &root,
            &PathBuf::from(format!("{}-other", root.display()))
        ));
    }
}
