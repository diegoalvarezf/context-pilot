import { z } from "zod";
import type { IContextEngine } from "context-pilot-engine";

export const pilotSchema = z.object({
  task: z.string().min(1).describe("What you are about to do, in plain words (the user's request works)"),
  files: z.array(z.string()).optional().describe("Files you already know are involved, if any"),
  budget: z.number().optional().default(1500).describe("Max tokens for the map"),
});

export type PilotInput = z.infer<typeof pilotSchema>;

export async function handlePilot(input: PilotInput, engine: IContextEngine, projectPath: string): Promise<string> {
  await engine.ensureFresh({ projectPath });
  const r = engine.pilot({ projectPath, task: input.task, files: input.files, budget: input.budget ?? 1500 });
  if (r.files.length === 0) return "context-pilot: nothing in the index matches this task. Explore as usual.";
  return `${r.text}\n(map: ~${r.tokens} tokens; reading these files in full: ~${r.tokensIfRead})`;
}
