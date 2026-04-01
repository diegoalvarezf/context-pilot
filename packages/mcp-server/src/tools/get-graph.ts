import { z } from "zod";
import type { IContextEngine } from "@context-pilot/engine";

export const getGraphSchema = z.object({
  target: z.string().describe("File path or function name"),
  depth: z.number().optional().default(2).describe("Graph traversal depth"),
  direction: z.enum(["incoming", "outgoing", "both"]).optional().default("both"),
});

export type GetGraphInput = z.infer<typeof getGraphSchema>;

export async function handleGetGraph(
  input: GetGraphInput,
  engine: IContextEngine,
  projectPath: string
): Promise<string> {
  const result = await engine.graph({
    target: input.target,
    projectPath,
    depth: input.depth ?? 2,
    direction: input.direction ?? "both",
  });
  return JSON.stringify(result);
}
