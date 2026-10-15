import type { DatabaseSync } from "node:sqlite";
import { headSha, isAncestor, isGitRepo, readGitLog } from "./git.js";
import { mineCommits, type MineOptions } from "./cochange.js";
import {
  addCoChanges,
  clearCoChanges,
  getCoChangeState,
  getCoChangeStats,
  setCoChangeState,
  tx,
  upsertProject,
} from "../storage/sqlite.js";
import type { HistoryResult } from "../types.js";

export const DEFAULT_MAX_COMMITS = 5000;

export async function mineHistory(
  db: DatabaseSync,
  pid: string,
  projectPath: string,
  opts: MineOptions & { force?: boolean; maxCommits?: number } = {}
): Promise<HistoryResult> {
  const empty = { commitsProcessed: 0, commitsSkipped: 0, files: 0, pairs: 0 };

  if (!(await isGitRepo(projectPath))) return { status: "not-a-git-repo", ...empty };
  const head = await headSha(projectPath);
  if (!head) return { status: "no-commits", ...empty };

  upsertProject(db, pid, projectPath);
  const state = getCoChangeState(db, pid);

  if (!opts.force && state?.head_sha === head) {
    return {
      status: "up-to-date",
      headSha: head,
      commitsProcessed: state.commits_processed,
      commitsSkipped: state.commits_skipped,
      ...getCoChangeStats(db, pid),
    };
  }

  // Incremental only on a fast-forward without renames: a rename would require
  // re-attributing already stored history to the new path.
  if (!opts.force && state && (await isAncestor(projectPath, state.head_sha, head))) {
    const commits = await readGitLog(projectPath, { range: `${state.head_sha}..${head}` });
    const hasRename = commits.some((c) => c.files.some((f) => f.status === "R"));
    if (!hasRename) {
      const mined = mineCommits(commits, opts);
      const next = {
        head_sha: head,
        commits_processed: state.commits_processed + mined.commitsProcessed,
        commits_skipped: state.commits_skipped + mined.commitsSkipped,
        mined_at: Date.now(),
      };
      tx(db, () => {
        addCoChanges(db, pid, mined.files.values(), mined.pairs.values());
        setCoChangeState(db, pid, next);
      });
      return {
        status: "incremental",
        headSha: head,
        commitsProcessed: next.commits_processed,
        commitsSkipped: next.commits_skipped,
        ...getCoChangeStats(db, pid),
      };
    }
  }

  const commits = await readGitLog(projectPath, { maxCommits: opts.maxCommits ?? DEFAULT_MAX_COMMITS });
  const mined = mineCommits(commits, opts);
  tx(db, () => {
    clearCoChanges(db, pid);
    addCoChanges(db, pid, mined.files.values(), mined.pairs.values());
    setCoChangeState(db, pid, {
      head_sha: head,
      commits_processed: mined.commitsProcessed,
      commits_skipped: mined.commitsSkipped,
      mined_at: Date.now(),
    });
  });

  return {
    status: "full",
    headSha: head,
    commitsProcessed: mined.commitsProcessed,
    commitsSkipped: mined.commitsSkipped,
    files: mined.files.size,
    pairs: mined.pairs.size,
  };
}
