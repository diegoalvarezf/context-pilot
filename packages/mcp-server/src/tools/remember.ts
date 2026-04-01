import { z } from "zod";
import type { IContextEngine } from "@context-pilot/engine";

export const rememberSchema = z.object({
  content: z.string().describe("The decision or note to remember"),
  memory_type: z.enum(["decision", "pattern", "todo", "context_note"]),
  related_files: z.array(z.string()).optional(),
});

export type RememberInput = z.infer<typeof rememberSchema>;

export async function handleRemember(
  engine: IContextEngine,
  projectPath: string,
  sessionId: string,
  input: RememberInput
): Promise<string> {
  const result = await engine.remember({
    projectPath,
    sessionId,
    memoryType: input.memory_type,
    content: input.content,
  });
  return JSON.stringify({ ...result, memory_type: input.memory_type });
}
