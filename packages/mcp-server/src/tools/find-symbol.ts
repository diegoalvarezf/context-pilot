import { z } from "zod";
import { formatFindSymbol, type IContextEngine } from "context-pilot-engine";

export const findSymbolSchema = z.object({
  name: z.string().min(1).describe("Function, class, method, type or constant name (Class.method works)"),
  limit: z.number().optional().default(30).describe("Max files with uses to list"),
});

export type FindSymbolInput = z.infer<typeof findSymbolSchema>;

export async function handleFindSymbol(
  input: FindSymbolInput,
  engine: IContextEngine,
  projectPath: string
): Promise<string> {
  await engine.ensureFresh({ projectPath });
  return formatFindSymbol(engine.findSymbol({ projectPath, name: input.name, limit: input.limit ?? 30 }));
}
