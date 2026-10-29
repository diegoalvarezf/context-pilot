import { Command } from "commander";
import { resolve } from "path";
import chalk from "chalk";
import { ContextEngine } from "context-pilot-engine";

export const pilotCommand = new Command("pilot")
  .description("Map a task to the code that matters: files, functions with line ranges, related files and tests")
  .argument("<task...>", "What you are about to do, in plain words")
  .option("-p, --project <path>", "Project root path", ".")
  .option("-f, --files <files...>", "Files you already know are involved")
  .option("-b, --budget <tokens>", "Max tokens for the map", "1500")
  .option("--json", "Output raw JSON", false)
  .action(async (task: string[], options: { project: string; files?: string[]; budget: string; json: boolean }) => {
    const root = resolve(options.project);
    const engine = new ContextEngine();
    try {
      await engine.ensureFresh({ projectPath: root });
      const r = engine.pilot({
        projectPath: root,
        task: task.join(" "),
        files: options.files?.map((f) => resolve(f)),
        budget: parseInt(options.budget, 10),
      });
      if (options.json) {
        console.log(JSON.stringify(r, null, 2));
        return;
      }
      if (r.files.length === 0) {
        console.log(chalk.dim("Nothing in the index matches this task."));
        return;
      }
      console.log(r.text);
      console.log(chalk.dim(`\n~${r.tokens} tokens (reading these files in full: ~${r.tokensIfRead}), confidence ${Math.round(r.confidence * 100)}%`));
    } finally {
      engine.close();
    }
  });
