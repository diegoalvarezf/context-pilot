import { z } from "zod";
import { formatHandoffHeader, isRecentHandoff, type IContextEngine } from "context-pilot-engine";

export const pilotSchema = z.object({
  task: z.string().min(1).describe("What you are about to do, in plain words (the user's request works)"),
  files: z.array(z.string()).optional().describe("Files you already know are involved, if any"),
  budget: z.number().optional().default(1500).describe("Max tokens for the map"),
  path: z.string().optional().describe("Optional project root path on disk; defaults to the server working directory"),
});

export type PilotInput = z.infer<typeof pilotSchema>;

export async function handlePilot(input: PilotInput, engine: IContextEngine, projectPath: string): Promise<string> {
  await engine.ensureFresh({ projectPath });
  const r = engine.pilot({ projectPath, task: input.task, files: input.files, budget: input.budget ?? 1500 });

  let header = "";
  const handoff = engine.getHandoffRecord?.({ projectPath });
  if (handoff && isRecentHandoff(handoff)) {
    header = `${formatHandoffHeader(handoff)}\n\n`;
  }

  if (r.files.length === 0) {
    const emptyMsg = "context-pilot: nothing in the index matches this task. Explore as usual.";
    return header ? `${header}${emptyMsg}` : emptyMsg;
  }
  return `${header}${r.text}\n(map: ~${r.tokens} tokens; reading these files in full: ~${r.tokensIfRead})`;
}
