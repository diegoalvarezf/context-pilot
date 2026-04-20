import { Command } from "commander";
import { resolve } from "path";
import chalk from "chalk";
import { ContextEngine } from "@context-pilot/engine";

export const sessionRecallCommand = new Command("session-recall")
  .description("Recall previous session notes, TODOs, and decisions")
  .argument("[path]", "Project root path", ".")
  .option("-t, --type <type>", "Filter by memory type (todo, decision, pattern, context_note)")
  .option("-l, --limit <n>", "Number of recent memories to show", "10")
  .action(
    async (
      projectPath: string,
      options: {
        type?: string;
        limit: string;
      }
    ) => {
      const root = resolve(projectPath);
      const engine = new ContextEngine();
      const limit = parseInt(options.limit, 10);

      try {
        await engine.init();

        // Search for all memories (query with wildcard)
        const result = await engine.searchMemories({
          query: options.type || "*",
          projectPath: root,
          k: limit,
        });

        if (!result.results || result.results.length === 0) {
          console.log(chalk.dim("No previous session memories found."));
          return;
        }

        // Group by type
        const byType = new Map<string, typeof result.results>();
        for (const memory of result.results) {
          if (!options.type || memory.memory_type === options.type) {
            if (!byType.has(memory.memory_type)) {
              byType.set(memory.memory_type, []);
            }
            byType.get(memory.memory_type)!.push(memory);
          }
        }

        if (byType.size === 0) {
          console.log(chalk.dim(`No memories found of type: ${options.type}`));
          return;
        }

        console.log(chalk.bold("\n📚 Previous Session Memories\n"));

        // Display grouped
        const typeLabels: Record<string, string> = {
          todo: "📋 TODOs",
          decision: "⚡ Decisions",
          pattern: "🔄 Patterns",
          context_note: "📝 Notes",
        };

        for (const [type, memories] of byType) {
          console.log(chalk.bold(chalk.cyan(typeLabels[type] || type)));
          for (const memory of memories) {
            const date = new Date(memory.created_at).toLocaleDateString("es-ES", {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });
            console.log(chalk.dim(`  [${date}]`));
            console.log(`  ${memory.content.split("\n").join("\n  ")}`);
            console.log("");
          }
        }
      } catch (err) {
        console.error(chalk.red("Error: ") + String(err));
      } finally {
        engine.close();
      }
    }
  );
