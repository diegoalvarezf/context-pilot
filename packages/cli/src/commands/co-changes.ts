import { Command } from "commander";
import { resolve } from "path";
import chalk from "chalk";
import { ContextEngine } from "context-pilot-engine";

export const coChangesCommand = new Command("co-changes")
  .description("Show files that historically change together with the given files")
  .argument("<files...>", "Files you are changing")
  .option("-p, --project <path>", "Project root path", ".")
  .option("-n, --limit <n>", "Max files to show", "10")
  .option("--min-support <n>", "Minimum shared commits", "2")
  .option("--json", "Output raw JSON", false)
  .action(
    async (
      files: string[],
      options: { project: string; limit: string; minSupport: string; json: boolean }
    ) => {
      const root = resolve(options.project);
      const engine = new ContextEngine();

      try {
        // Keep history current before answering; cheap when HEAD has not moved
        const history = await engine.mineHistory({ projectPath: root });
        if (history.status === "not-a-git-repo") {
          console.error(chalk.red("Not a git repository: ") + root);
          process.exitCode = 1;
          return;
        }

        // Paths given on the command line are relative to the shell, not the project
        const absFiles = files.map((f) => resolve(f));
        const response = engine.coChanges({
          projectPath: root,
          files: absFiles,
          limit: parseInt(options.limit, 10),
          minSupport: parseInt(options.minSupport, 10),
        });

        if (options.json) {
          console.log(JSON.stringify(response, null, 2));
          return;
        }

        for (const f of response.unknownFiles) {
          console.log(chalk.yellow("No history for ") + f);
        }

        if (response.results.length === 0) {
          console.log(chalk.dim("No files frequently change together with these."));
          return;
        }

        console.log("");
        for (const r of response.results) {
          const pct = `${Math.round(r.score * 100)}%`.padStart(4);
          const when = new Date(r.lastChangedTogether * 1000).toISOString().slice(0, 10);
          console.log(`  ${chalk.cyan(pct)}  ${chalk.white(r.path)}  ${chalk.dim(`last together ${when}`)}`);
          for (const s of r.sources) {
            console.log(
              chalk.dim(`          with ${s.file}: ${s.support}/${s.sourceCommits} commits`)
            );
          }
        }
        console.log("");
      } finally {
        engine.close();
      }
    }
  );
