import { spawn } from "child_process";

export interface CommitFileChange {
  status: "A" | "M" | "D" | "R" | "C" | "T";
  path: string;
  /** Previous path, only for renames (R) and copies (C) */
  oldPath?: string;
}

export interface GitCommit {
  sha: string;
  /** Commit timestamp, unix seconds */
  timestamp: number;
  files: CommitFileChange[];
}

const RECORD_SEP = "\x1e";
const FIELD_SEP = "\x1f";

export function runGit(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("git", ["-c", "core.quotePath=false", ...args], { cwd, windowsHide: true });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => err.push(d));
    child.on("error", reject);
    child.on("close", (code) =>
      resolvePromise({
        code: code ?? 1,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      })
    );
  });
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    const r = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
    return r.code === 0 && r.stdout.trim() === "true";
  } catch {
    return false;
  }
}

/** Returns the HEAD sha, or null for a repo without commits. */
export async function headSha(cwd: string): Promise<string | null> {
  const r = await runGit(cwd, ["rev-parse", "--verify", "--quiet", "HEAD"]);
  return r.code === 0 ? r.stdout.trim() : null;
}

/** Absolute hooks directory (honours core.hooksPath and worktrees), or null outside a repo. */
export async function gitHooksDir(cwd: string): Promise<string | null> {
  const r = await runGit(cwd, ["rev-parse", "--path-format=absolute", "--git-path", "hooks"]);
  return r.code === 0 ? r.stdout.trim() : null;
}

export async function isAncestor(cwd: string, ancestor: string, descendant: string): Promise<boolean> {
  const r = await runGit(cwd, ["merge-base", "--is-ancestor", ancestor, descendant]);
  return r.code === 0;
}

/**
 * Reads commit history newest-first, without merges, with rename detection.
 * Paths are relative to `cwd` (`--relative`), so a project living in a
 * subdirectory of a larger repo only sees its own files.
 */
export async function readGitLog(
  cwd: string,
  opts: { range?: string; maxCommits?: number } = {}
): Promise<GitCommit[]> {
  const args = [
    "log",
    "--no-merges",
    "--name-status",
    "-M",
    "--relative",
    `--format=${RECORD_SEP}%H${FIELD_SEP}%ct`,
  ];
  if (opts.maxCommits) args.push(`--max-count=${opts.maxCommits}`);
  if (opts.range) args.push(opts.range);
  args.push("--");

  const r = await runGit(cwd, args);
  if (r.code !== 0) throw new Error(`git log failed: ${r.stderr.trim()}`);
  return parseGitLog(r.stdout);
}

export function parseGitLog(output: string): GitCommit[] {
  const commits: GitCommit[] = [];

  for (const record of output.split(RECORD_SEP)) {
    if (!record.trim()) continue;
    const lines = record.split(/\r?\n/);
    const [sha, ts] = lines[0].split(FIELD_SEP);
    if (!sha || !ts) continue;

    const files: CommitFileChange[] = [];
    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;
      const parts = line.split("\t");
      const status = parts[0].charAt(0) as CommitFileChange["status"];
      if ((status === "R" || status === "C") && parts.length >= 3) {
        files.push({ status, oldPath: parts[1], path: parts[2] });
      } else if (parts.length >= 2) {
        files.push({ status, path: parts[1] });
      }
    }

    commits.push({ sha: sha.trim(), timestamp: Number(ts), files });
  }

  return commits;
}
