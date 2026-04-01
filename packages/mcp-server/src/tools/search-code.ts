import { z } from "zod";
import type { IContextEngine } from "@context-pilot/engine";

export const searchCodeSchema = z.object({
  query: z.string().describe("Semantic search query"),
  k: z.number().optional().default(10).describe("Number of results"),
  filter_type: z.enum(["function", "class", "module", "any"]).optional().default("any"),
});

export type SearchCodeInput = z.infer<typeof searchCodeSchema>;

export async function handleSearchCode(
  input: SearchCodeInput,
  engine: IContextEngine,
  projectPath: string
): Promise<string> {
  const result = await engine.search({
    query: input.query,
    projectPath,
    k: input.k ?? 10,
    filterType: input.filter_type ?? "any",
  });
  return JSON.stringify(result);
}
