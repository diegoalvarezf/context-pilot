import { z } from "zod";
import type { PythonBridge } from "../bridge/python-bridge.js";
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

interface SearchResult {
  chunk_id: string;
  score: number;
  content: string;
  chunk_type: string;
  name: string | null;
  path: string;
  start_line: number;
  end_line: number;
}

export async function handleQueryContext(
  input: QueryContextInput,
  bridge: PythonBridge,
  projectPath: string
): Promise<string> {
  const searchResponse = await bridge.call<{ results: SearchResult[]; message?: string }>(
    "search",
    {
      query: input.prompt,
      project_path: projectPath,
      k: 20,
      filter_type: "any",
    }
  );

  if (!searchResponse.results?.length) {
    return JSON.stringify({
      context: "",
      sources: [],
      token_count: 0,
      message: searchResponse.message ?? "No results. Index the project first with index_project.",
    });
  }

  let candidates: Candidate[] = searchResponse.results.map((r) => ({ ...r }));

  // If we know the active file, enrich with graph distances
  if (input.active_file) {
    try {
      const distResponse = await bridge.call<{
        distances: Record<string, number>;
      }>("graph_distances", {
        project_path: projectPath,
        active_file: input.active_file,
        candidate_ids: candidates.map((c) => c.chunk_id),
      });

      candidates = candidates.map((c) => ({
        ...c,
        graph_distance: distResponse.distances[c.chunk_id] ?? 0.5,
      }));
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
