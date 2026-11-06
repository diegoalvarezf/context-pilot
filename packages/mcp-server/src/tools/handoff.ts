import { z } from "zod";
import type { IContextEngine } from "context-pilot-engine";

export const handoffSchema = z.object({
  action: z
    .enum(["get", "set"])
    .optional()
    .describe("Action: 'get' to read handoff, 'set' to record handoff. Defaults to 'set' if summary is provided, otherwise 'get'."),
  summary: z.string().optional().describe("Summary of what was done, key decisions, or current state"),
  activeFiles: z.array(z.string()).optional().describe("Files touched or relevant to the current work"),
  nextSteps: z.string().optional().describe("What remains to be done or pending next steps"),
  agent: z.string().optional().describe("Origin agent name (e.g. 'antigravity', 'claude')"),
  path: z.string().optional().describe("Optional project root path on disk; defaults to the server working directory"),
});

export type HandoffInput = z.infer<typeof handoffSchema>;

export async function handleHandoff(
  input: HandoffInput,
  engine: IContextEngine,
  projectPath: string
): Promise<string> {
  const action = input.action ?? (input.summary ? "set" : "get");

  if (action === "set") {
    if (!input.summary || !input.summary.trim()) {
      return "context-pilot handoff: summary is required when recording a handoff.";
    }

    const saved = engine.setHandoff({
      projectPath,
      summary: input.summary.trim(),
      activeFiles: input.activeFiles,
      nextSteps: input.nextSteps?.trim(),
      agent: input.agent?.trim(),
    });

    const lines: string[] = [
      `Session handoff recorded for ${projectPath}:`,
      `Updated: ${saved.updatedAt}`,
    ];
    if (saved.agent) lines.push(`Agent: ${saved.agent}`);
    lines.push(`Summary: ${saved.summary}`);
    if (saved.activeFiles.length > 0) {
      lines.push(`Active Files: ${saved.activeFiles.join(", ")}`);
    }
    if (saved.nextSteps) {
      lines.push(`Next Steps: ${saved.nextSteps}`);
    }
    return lines.join("\n");
  }

  // action === "get"
  const result = await engine.getHandoff({ projectPath });
  if (!result.handoff) {
    return `No session handoff recorded for ${projectPath}.`;
  }

  const h = result.handoff;
  const lines: string[] = [
    `Session handoff for ${projectPath}:`,
    `Updated: ${h.updatedAt}`,
  ];
  if (h.agent) lines.push(`Agent: ${h.agent}`);
  lines.push(`Summary: ${h.summary}`);
  if (h.activeFiles.length > 0) {
    lines.push(`Active Files: ${h.activeFiles.join(", ")}`);
  }
  if (h.nextSteps) {
    lines.push(`Next Steps: ${h.nextSteps}`);
  }
  if (result.gitStatus && result.gitStatus.trim().length > 0) {
    lines.push(`\nUncommitted git status:\n${result.gitStatus.trim()}`);
  }
  return lines.join("\n");
}
