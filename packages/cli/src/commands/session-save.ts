import { Command } from "commander";
import { resolve } from "path";
import chalk from "chalk";
import ora from "ora";
import { randomUUID } from "crypto";
import { ContextEngine } from "@context-pilot/engine";

export const sessionSaveCommand = new Command("session-save")
  .description("Save session notes and TODOs to memory")
  .argument("[path]", "Project root path", ".")
  .option("-s, --summary <text>", "Session summary text")
  .option("-t, --todos <text>", "TODOs to save (newline separated)")
  .option("-d, --decisions <text>", "Decisions made during session")
  .option("-p, --patterns <text>", "Patterns discovered")
  .action(
    async (
      projectPath: string,
      options: {
        summary?: string;
        todos?: string;
        decisions?: string;
        patterns?: string;
      }
    ) => {
      const root = resolve(projectPath);
      const engine = new ContextEngine();
      const sessionId = randomUUID();

      try {
        await engine.init();

        let savedCount = 0;

        if (options.summary) {
          await engine.remember({
            projectPath: root,
            sessionId,
            memoryType: "context_note",
            content: `Session Summary: ${options.summary}`,
          });
          savedCount++;
        }

        if (options.todos) {
          // Handle both \n literal and actual newlines
          const rawTodos = options.todos.replace(/\\n/g, "\n");
          const todos = rawTodos
            .split("\n")
            .filter((t) => t.trim())
            .map((t) => `- ${t.trim()}`)
            .join("\n");

          if (todos) {
            await engine.remember({
              projectPath: root,
              sessionId,
              memoryType: "todo",
              content: `TODOs:\n${todos}`,
            });
            savedCount++;
          }
        }

        if (options.decisions) {
          await engine.remember({
            projectPath: root,
            sessionId,
            memoryType: "decision",
            content: options.decisions,
          });
          savedCount++;
        }

        if (options.patterns) {
          await engine.remember({
            projectPath: root,
            sessionId,
            memoryType: "pattern",
            content: options.patterns,
          });
          savedCount++;
        }

        if (savedCount > 0) {
          console.log(
            chalk.green(`✓ Session saved`) +
              chalk.dim(` (${savedCount} memories stored, session ID: ${sessionId})`)
          );
        } else {
          console.log(
            chalk.yellow(
              "No data provided. Use --summary, --todos, --decisions, or --patterns"
            )
          );
        }
      } catch (err) {
        console.error(chalk.red("Error: ") + String(err));
      } finally {
        engine.close();
      }
    }
  );
