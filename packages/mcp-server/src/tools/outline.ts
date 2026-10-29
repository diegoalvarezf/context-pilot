import { z } from "zod";
import { formatOutline, type IContextEngine } from "context-pilot-engine";

export const outlineSchema = z.object({
  files: z.array(z.string()).min(1).describe("Files to outline (relative to project root, or absolute)"),
});

export type OutlineInput = z.infer<typeof outlineSchema>;

export async function handleOutline(input: OutlineInput, engine: IContextEngine, projectPath: string): Promise<string> {
  await engine.ensureFresh({ projectPath });
  return input.files.map((file) => formatOutline(engine.outline({ projectPath, file }))).join("\n\n");
}
