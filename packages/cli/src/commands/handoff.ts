import { Command } from "commander";
import { resolve } from "path";
import chalk from "chalk";
import { ContextEngine } from "context-pilot-engine";

export const handoffCommand = new Command("handoff")
  .description("Get or set cross-session context handoff for a project")
  .argument("[summary...]", "Summary of work done or current state")
  .option("-p, --path <path>", "Project root path", ".")
  .option("-f, --files <files...>", "Active or touched files")
  .option("-n, --next <steps>", "Next steps or pending tasks")
  .option("-a, --agent <name>", "Origin agent name (e.g. 'antigravity', 'claude')")
  .option("--clear", "Clear handoff for this project", false)
  .option("--json", "Output raw JSON", false)
  .action(async (summaryArgs: string[], options: {
    path: string;
    files?: string[];
    next?: string;
    agent?: string;
    clear: boolean;
    json: boolean;
  }) => {
    const root = resolve(options.path);
    const engine = new ContextEngine();
    try {
      if (options.clear) {
        engine.clearHandoff({ projectPath: root });
        if (options.json) {
          console.log(JSON.stringify({ cleared: true, path: root }));
        } else {
          console.log(chalk.green("✓") + ` Handoff cleared for ${root}`);
        }
        return;
      }

      const summaryText = summaryArgs && summaryArgs.length > 0 ? summaryArgs.join(" ").trim() : undefined;

      if (summaryText) {
        const saved = engine.setHandoff({
          projectPath: root,
          summary: summaryText,
          activeFiles: options.files,
          nextSteps: options.next,
          agent: options.agent,
        });

        if (options.json) {
          console.log(JSON.stringify(saved, null, 2));
          return;
        }

        console.log(chalk.green("✓") + ` Session handoff recorded for ${chalk.bold(root)}:`);
        console.log(`  ${chalk.dim("Updated:")} ${saved.updatedAt}`);
        if (saved.agent) console.log(`  ${chalk.dim("Agent:")}   ${saved.agent}`);
        console.log(`  ${chalk.dim("Summary:")} ${saved.summary}`);
        if (saved.activeFiles.length > 0) {
          console.log(`  ${chalk.dim("Files:")}   ${saved.activeFiles.join(", ")}`);
        }
        if (saved.nextSteps) {
          console.log(`  ${chalk.dim("Next:")}    ${saved.nextSteps}`);
        }
        return;
      }

      // Read mode (get)
      const result = await engine.getHandoff({ projectPath: root });
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (!result.handoff) {
        console.log(chalk.dim(`No session handoff recorded for ${root}`));
        return;
      }

      const h = result.handoff;
      console.log(chalk.green("✓") + ` Session handoff for ${chalk.bold(root)}:`);
      console.log(`  ${chalk.dim("Updated:")} ${h.updatedAt}`);
      if (h.agent) console.log(`  ${chalk.dim("Agent:")}   ${h.agent}`);
      console.log(`  ${chalk.dim("Summary:")} ${h.summary}`);
      if (h.activeFiles.length > 0) {
        console.log(`  ${chalk.dim("Files:")}   ${h.activeFiles.join(", ")}`);
      }
      if (h.nextSteps) {
        console.log(`  ${chalk.dim("Next:")}    ${h.nextSteps}`);
      }
      if (result.gitStatus) {
        console.log(`\n  ${chalk.dim("Git status (active files):")}\n${result.gitStatus.split("\n").map((l: string) => "    " + l).join("\n")}`);
      }
    } finally {
      engine.close();
    }
  });
