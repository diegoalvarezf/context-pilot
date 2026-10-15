import { z } from "zod";
import type { IContextEngine } from "context-pilot-engine";

export const indexProjectSchema = z.object({
  force: z.boolean().optional().default(false).describe("Force full re-index and re-mine git history"),
});

export type IndexProjectInput = z.infer<typeof indexProjectSchema>;

export async function handleIndexProject(
  input: IndexProjectInput,
  engine: IContextEngine,
  projectPath: string
): Promise<string> {
  const result = await engine.index({ projectPath, force: input.force ?? false });
  return JSON.stringify(result);
}
