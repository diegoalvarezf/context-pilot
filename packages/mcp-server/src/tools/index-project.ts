import { z } from "zod";
import type { IContextEngine } from "@context-pilot/engine";

export const indexProjectSchema = z.object({
  project_path: z.string().optional().describe("Path to project root (defaults to cwd)"),
  force: z.boolean().optional().default(false).describe("Force full re-index"),
  paths: z.array(z.string()).optional().describe("Specific paths to index"),
});

export type IndexProjectInput = z.infer<typeof indexProjectSchema>;

export async function handleIndexProject(
  input: IndexProjectInput,
  engine: IContextEngine
): Promise<string> {
  const result = await engine.index({
    projectPath: input.project_path ?? process.cwd(),
    force: input.force ?? false,
  });
  return JSON.stringify(result);
}
