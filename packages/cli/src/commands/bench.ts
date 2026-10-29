import { Command } from "commander";
import { readFileSync } from "fs";
import { resolve } from "path";
import chalk from "chalk";
import { benchPilot, ContextEngine, DEFAULT_BENCH_COMMITS, type BenchReport } from "context-pilot-engine";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const k = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString("en-US"));

function print(r: BenchReport): void {
  console.log("");
  console.log(chalk.bold(`  ${r.evaluated} commits evaluated`) + chalk.dim(` (${r.skipped} skipped), budget ${r.budget} tokens${r.expand ? ", with history (optimistic)" : ", text search only"}`));
  console.log(`  map contains an edited file: ${chalk.cyan(pct(r.hitRate))} of commits, ${chalk.cyan(pct(r.recall))} of edited files`);
  for (const c of r.confident) {
    console.log(chalk.dim(`    confidence >= ${c.threshold}: ${pct(c.share)} of tasks, hit ${pct(c.hitRate)}, recall ${pct(c.recall)}`));
  }
  console.log(`  prompt hook answers ${chalk.cyan(pct(r.hook.answered))} of tasks, hit ${pct(r.hook.hitRate)}, recall ${pct(r.hook.recall)}`);
  if (r.negatives) {
    console.log(`  not tasks: silent on ${chalk.cyan(pct(r.negatives.rate))} of ${r.negatives.total} prompts`);
    for (const p of r.negatives.spoke) console.log(chalk.yellow(`    spoke for: ${p}`));
  }
  const t = r.tokens;
  console.log("");
  console.log(`  tokens without context-pilot: ${k(t.without)}  (grep ${k(t.grep)} + reading edited files in full ${k(t.readFull)})`);
  console.log(`  tokens with context-pilot:    ${k(t.with)}  (maps ${k(t.map)} + ranges ${k(t.readRanges)} + grep for what the map missed)`);
  console.log(`  saved: ${chalk.green(pct(t.saved))}`);
  console.log("");
}

export const benchCommand = new Command("bench")
  .description("Replay past commits (message = task) to measure how often the pilot finds the right files and the tokens it saves")
  .argument("[path]", "Repository to measure", ".")
  .option("-n, --commits <n>", "Commits to evaluate", String(DEFAULT_BENCH_COMMITS))
  .option("-b, --budget <tokens>", "Map budget", "1500")
  .option("--expand", "Expand with history and imports (optimistic: today's history knows each commit)", false)
  .option("--tasks <file>", "JSON with tasks to use instead of commit messages: { tasks: { <sha>: <task> } } (e.g. translated)")
  .option("--negatives <file>", "JSON with prompts that are not code tasks, { prompts: [...] }: the hook should stay silent on them")
  .option("--json", "Output raw JSON", false)
  .action(async (path: string, options: { commits: string; budget: string; expand: boolean; tasks?: string; negatives?: string; json: boolean }) => {
    const root = resolve(path);
    const engine = new ContextEngine();
    try {
      await engine.ensureFresh({ projectPath: root });
      const report = await benchPilot(engine, root, {
        commits: parseInt(options.commits, 10),
        budget: parseInt(options.budget, 10),
        expand: options.expand,
        tasks: options.tasks ? (JSON.parse(readFileSync(options.tasks, "utf8")) as { tasks: Record<string, string> }).tasks : undefined,
        negatives: options.negatives ? (JSON.parse(readFileSync(options.negatives, "utf8")) as { prompts: string[] }).prompts : undefined,
      });
      if (options.json) console.log(JSON.stringify(report, null, 2));
      else print(report);
    } finally {
      engine.close();
    }
  });
