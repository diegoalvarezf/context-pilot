import { z } from "zod";
import type { IContextEngine } from "context-pilot-engine";

export const impactOfSchema = z.object({
  files: z
    .array(z.string())
    .min(1)
    .describe("Files you are changing or about to change (relative to project root, or absolute)"),
  limit: z.number().optional().default(10).describe("Max files to return"),
  depth: z.number().optional().default(2).describe("Import hops to follow for dependents"),
});

export type ImpactOfInput = z.infer<typeof impactOfSchema>;

export async function handleImpactOf(
  input: ImpactOfInput,
  engine: IContextEngine,
  projectPath: string
): Promise<string> {
  const response = engine.impact({
    projectPath,
    files: input.files,
    limit: input.limit ?? 10,
    depth: input.depth ?? 2,
  });

  const messages: string[] = [];
  if (!response.graphAvailable) messages.push("Import graph not built: run index_project.");
  if (!response.historyAvailable) messages.push("No git history mined: run index_project.");

  return JSON.stringify({
    results: response.results.map((r) => ({
      path: r.path,
      score: Math.round(r.score * 1000) / 1000,
      is_test: r.isTest,
      reasons: r.reasons,
    })),
    unknown_files: response.unknownFiles,
    ...(messages.length ? { message: messages.join(" ") } : {}),
  });
}
