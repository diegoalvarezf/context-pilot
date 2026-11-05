import { Command } from "commander";
import { resolve } from "path";
import chalk from "chalk";
import { ContextEngine } from "context-pilot-engine";

export const statsCommand = new Command("stats")
  .description("Show token savings telemetry and MCP usage summary")
  .argument("[path]", "Optional project root path to filter", "")
  .action(async (projectArg?: string) => {
    const filterPath = projectArg ? resolve(projectArg) : undefined;
    const engine = new ContextEngine();

    try {
      const stats = engine.getUsageStats({ projectPath: filterPath });
      console.log("");
      console.log(chalk.bold.cyan("context-pilot token savings telemetry"));
      console.log("");

      const g = stats.global;
      console.log(chalk.bold("Global summary:"));
      console.log(`  Total calls:        ${chalk.white(g.calls.toLocaleString())}`);
      console.log(`  Tokens returned:    ${chalk.white(g.responseTokens.toLocaleString())}`);
      console.log(`  Full files avoided: ${chalk.white(g.fullFilesTokens.toLocaleString())}`);
      console.log(`  Tokens saved:       ${chalk.green(g.savedTokens.toLocaleString())}`);
      console.log(`  Estimated savings:  ${chalk.green.bold(g.savingsPercent + "%")}`);
      console.log("");

      const projects = Object.entries(stats.byProject);
      if (projects.length === 0) {
        console.log(chalk.dim("No MCP usage recorded yet."));
      } else {
        console.log(chalk.bold("By project:"));
        for (const [proj, s] of projects) {
          if (filterPath && resolve(proj) !== filterPath) continue;
          console.log(`  ${chalk.cyan(proj)}`);
          console.log(
            `    Calls: ${s.calls.toLocaleString()} | Returned: ${s.responseTokens.toLocaleString()} | Full: ${s.fullFilesTokens.toLocaleString()} | Saved: ${chalk.green(s.savedTokens.toLocaleString())} (${chalk.green.bold(s.savingsPercent + "%")})`
          );
        }
      }
      console.log("");
    } finally {
      engine.close();
    }
  });
