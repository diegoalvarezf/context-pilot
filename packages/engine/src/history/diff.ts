import { runGit } from "./git.js";

export interface WorkingChange {
  status: "A" | "M" | "D" | "R" | "C" | "T" | "?";
  path: string;
  /** Previous path, only for renames (R) and copies (C) */
  oldPath?: string;
}

export interface WorkingChangesOptions {
  /** Only what is staged for commit (pre-commit hook) */
  staged?: boolean;
  /** Compare against the merge-base with this ref instead of HEAD (a branch / PR) */
  base?: string;
}

/** Parses `git diff --name-status` output; `git ls-files` lines (bare paths) become untracked `?` entries. */
export function parseNameStatus(output: string): WorkingChange[] {
  const changes: WorkingChange[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const status = parts[0].charAt(0) as WorkingChange["status"];
    if ((status === "R" || status === "C") && parts.length >= 3) {
      changes.push({ status, oldPath: parts[1], path: parts[2] });
    } else if (parts.length >= 2) {
      changes.push({ status, path: parts[1] });
    }
  }
  return changes;
}

/**
 * Files changed in the working tree, relative to `cwd`. Read-only: `git diff` / `git ls-files` only.
 * Default: staged + unstaged changes vs HEAD, plus untracked files. A repo without commits
 * compares against the empty tree, so every file counts as added.
 */
export async function readWorkingChanges(cwd: string, opts: WorkingChangesOptions = {}): Promise<WorkingChange[]> {
  let against = "HEAD";
  if (opts.base) {
    const mb = await runGit(cwd, ["merge-base", opts.base, "HEAD"]);
    if (mb.code !== 0) throw new Error(`cannot find merge-base with ${opts.base}: ${mb.stderr.trim()}`);
    against = mb.stdout.trim();
  } else {
    const head = await runGit(cwd, ["rev-parse", "--verify", "--quiet", "HEAD"]);
    // Empty tree: works in a repo with no commits yet
    if (head.code !== 0) against = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
  }

  const args = ["diff", "--name-status", "-M", "--relative"];
  if (opts.staged) args.push("--cached");
  args.push(against, "--");
  const diff = await runGit(cwd, args);
  if (diff.code !== 0) throw new Error(`git diff failed: ${diff.stderr.trim()}`);
  const changes = parseNameStatus(diff.stdout);

  if (!opts.staged) {
    const untracked = await runGit(cwd, ["ls-files", "--others", "--exclude-standard"]);
    if (untracked.code === 0) {
      for (const p of untracked.stdout.split(/\r?\n/)) {
        if (p.trim()) changes.push({ status: "?", path: p.trim() });
      }
    }
  }

  return changes;
}
