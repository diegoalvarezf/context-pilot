import { z } from "zod";
import type { IContextEngine } from "@context-pilot/engine";
import { rankCandidates, normalizeRecency, type Candidate } from "../context/ranker.js";

export const queryContextSchema = z.object({
  prompt: z.string().describe("The task or question to find context for"),
  active_file: z.string().optional().describe("Current file being edited (relative to project root)"),
  token_budget: z.number().optional().default(8000).describe("Max tokens to return"),
  context_types: z
    .array(z.enum(["code", "decisions", "patterns", "all"]))
    .optional()
    .default(["all"]),
});

export type QueryContextInput = z.infer<typeof queryContextSchema>;

export async function handleQueryContext(
  input: QueryContextInput,
  engine: IContextEngine,
  projectPath: string
): Promise<string> {
  const searchResponse = await engine.search({
    query: input.prompt,
    projectPath,
    k: 20,
  });

  if (!searchResponse.results?.length) {
    return JSON.stringify({
      context: "",
      sources: [],
      token_count: 0,
      message: "No results. Index the project first with index_project.",
    });
  }

  let candidates: Candidate[] = searchResponse.results.map((r) => ({
    chunk_id: r.chunk_id,
    score: r.score,
    content: r.content,
    chunk_type: r.chunk_type,
    name: r.name,
    path: r.path,
    start_line: r.start_line,
    end_line: r.end_line,
  }));

  // If we know the active file, enrich with graph distances
  if (input.active_file) {
    try {
      // Find a chunk from the active file to use as the anchor node
      const anchor = candidates.find((c) =>
        c.path === input.active_file || c.path.endsWith("/" + input.active_file)
      );

      if (anchor) {
        const distResponse = await engine.graphDistances({
          projectPath,
          activeChunkId: anchor.chunk_id,
          candidateIds: candidates.map((c) => c.chunk_id),
        });

        candidates = candidates.map((c) => ({
          ...c,
          graph_distance: distResponse.distances[c.chunk_id] ?? 0.5,
        }));
      }
    } catch {
      // graph not available yet — skip distance enrichment
    }
  }

  const ranked = rankCandidates(candidates);

  // Assemble context within token budget
  const budget = input.token_budget ?? 8000;
  const sources: { path: string; name: string | null; lines: string; score: number }[] = [];
  const contextParts: string[] = [];
  let tokenCount = 0;

  for (const result of ranked) {
    const estimated = Math.ceil(result.content.length / 4);
    if (tokenCount + estimated > budget) break;

    contextParts.push(
      `// ${result.path}:${result.start_line}-${result.end_line}` +
      `${result.name ? ` (${result.name})` : ""}\n${result.content}`
    );
    sources.push({
      path: result.path,
      name: result.name,
      lines: `${result.start_line}-${result.end_line}`,
      score: result.final_score,
    });
    tokenCount += estimated;
  }

  return JSON.stringify({ context: contextParts.join("\n\n"), sources, token_count: tokenCount });
}
