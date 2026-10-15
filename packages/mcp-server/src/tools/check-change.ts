import { z } from "zod";
import type { IContextEngine } from "context-pilot-engine";

export const checkChangeSchema = z.object({
  staged: z.boolean().optional().default(false).describe("Only look at staged changes (what will be committed)"),
  base: z
    .string()
    .optional()
    .describe("Compare against the merge-base with this ref (e.g. main) to check a whole branch"),
  min_score: z.number().optional().default(0.3).describe("Only report files whose strongest single signal reaches this (0-1)"),
  limit: z.number().optional().default(10).describe("Max files to return"),
});

export type CheckChangeInput = z.infer<typeof checkChangeSchema>;

export async function handleCheckChange(
  input: CheckChangeInput,
  engine: IContextEngine,
  projectPath: string
): Promise<string> {
  const response = await engine.checkChange({
    projectPath,
    staged: input.staged,
    base: input.base,
    minScore: input.min_score,
    limit: input.limit,
  });

  const messages: string[] = [];
  if (response.skipped) messages.push(`Not checked: ${response.skipped}.`);
  else if (response.changed.length === 0) messages.push("No changes found.");
  else if (response.missing.length === 0) messages.push("Nothing obviously missing from this change.");
  if (response.changed.length > 0 && !response.skipped) {
    if (!response.graphAvailable) messages.push("Import graph not built: run index_project.");
    if (!response.historyAvailable) messages.push("No git history mined: run index_project.");
  }

  return JSON.stringify({
    changed: response.changed.map((c) => c.path),
    likely_missing: response.missing.map((r) => ({
      path: r.path,
      score: Math.round(r.score * 1000) / 1000,
      is_test: r.isTest,
      reasons: r.reasons,
    })),
    unknown_files: response.unknownFiles,
    ...(messages.length ? { message: messages.join(" ") } : {}),
  });
}
