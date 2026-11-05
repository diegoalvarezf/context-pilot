import { z } from "zod";
import type { IContextEngine } from "context-pilot-engine";

export const usageStatsSchema = z.object({
  path: z.string().optional().describe("Optional project root path on disk; defaults to the server working directory"),
});

export type UsageStatsInput = z.infer<typeof usageStatsSchema>;

export async function handleUsageStats(
  input: UsageStatsInput,
  engine: IContextEngine,
  projectPath: string
): Promise<string> {
  const stats = engine.getUsageStats({ projectPath });
  return JSON.stringify(stats, null, 2);
}
