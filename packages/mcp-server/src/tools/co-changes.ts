import { z } from "zod";
import type { IContextEngine } from "context-pilot-engine";

export const coChangesSchema = z.object({
  files: z
    .array(z.string())
    .min(1)
    .describe("Files you are changing or about to change (relative to project root, or absolute)"),
  limit: z.number().optional().default(10).describe("Max files to return"),
  min_support: z
    .number()
    .optional()
    .describe("Minimum number of past commits where the files changed together"),
});

export type CoChangesInput = z.infer<typeof coChangesSchema>;

export async function handleCoChanges(
  input: CoChangesInput,
  engine: IContextEngine,
  projectPath: string
): Promise<string> {
  const response = engine.coChanges({
    projectPath,
    files: input.files,
    limit: input.limit ?? 10,
    minSupport: input.min_support,
  });

  if (!response.historyAvailable) {
    return JSON.stringify({
      ...response,
      message: "No git history mined for this project yet. Run index_project first.",
    });
  }

  return JSON.stringify({
    results: response.results.map((r) => ({
      path: r.path,
      score: Math.round(r.score * 1000) / 1000,
      last_changed_together: new Date(r.lastChangedTogether * 1000).toISOString().slice(0, 10),
      reasons: r.sources.map(
        (s) =>
          `changed together with ${s.file} in ${s.support} of ${s.sourceCommits} commits ` +
          `(recency-weighted confidence ${Math.round(s.confidence * 100)}%)`
      ),
    })),
    unknown_files: response.unknownFiles,
  });
}
