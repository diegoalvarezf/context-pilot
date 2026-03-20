import { z } from "zod";
import type { PythonBridge } from "../bridge/python-bridge.js";

export const getGraphSchema = z.object({
  target: z.string().describe("File path or function name"),
  depth: z.number().optional().default(2).describe("Graph traversal depth"),
  direction: z.enum(["incoming", "outgoing", "both"]).optional().default("both"),
});

export type GetGraphInput = z.infer<typeof getGraphSchema>;

export async function handleGetGraph(
  input: GetGraphInput,
  bridge: PythonBridge,
  projectPath: string
): Promise<string> {
  const result = await bridge.call("graph", {
    target: input.target,
    project_path: projectPath,
    depth: input.depth ?? 2,
    direction: input.direction ?? "both",
  });
  return JSON.stringify(result);
}
