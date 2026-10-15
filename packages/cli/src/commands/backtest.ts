import { Command } from "commander";
import { resolve } from "path";
import chalk from "chalk";
import {
  backtestRepo,
  DEFAULT_MIN_CONFIDENCE,
  DEFAULT_MIN_SUPPORT,
  DEFAULT_TEST_COMMITS,
  type CombineMethod,
} from "context-pilot-engine";

const COMBINE_METHODS: CombineMethod[] = ["noisy-or", "max", "mean"];
const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

// DB-free on purpose: replays git history in memory and writes nothing, so it
// does not go through ContextEngine (which opens ~/.context-pilot/db.sqlite).
export const backtestCommand = new Command("backtest")
  .description("Measure how well co-changes predict the rest of past commits (read-only, no init needed)")
  .argument("[path]", "Repository or project path", ".")
  .option("-t, --test-commits <n>", "Newest commits used as the test set", String(DEFAULT_TEST_COMMITS))
  .option("-k <list>", "Cut-offs, comma separated", "5,10")
  .option("-q, --query-files <n>", "Files per query (1 = each file alone)", "1")
  .option("--min-support <n>", "Minimum shared commits", String(DEFAULT_MIN_SUPPORT))
  .option("--min-confidence <x>", "Minimum confidence", String(DEFAULT_MIN_CONFIDENCE))
  .option("--combine <method>", `Multi-file combination: ${COMBINE_METHODS.join(", ")}`, "noisy-or")
  .option("--shrinkage <n>", "Pseudo-commits added to each file's history (damps low-evidence confidence)")
  .option("--with-graph", "Combine co-changes with the import graph and related tests (impact scoring)", false)
  .option("--no-walk-forward", "Do not learn from test commits as they are replayed")
  .option("--json", "Output raw JSON", false)
  .action(
    async (
      path: string,
      options: {
        testCommits: string;
        k: string;
        queryFiles: string;
        minSupport: string;
        minConfidence: string;
        combine: string;
        walkForward: boolean;
        withGraph: boolean;
        shrinkage?: string;
        json: boolean;
      }
    ) => {
      if (!COMBINE_METHODS.includes(options.combine as CombineMethod)) {
        console.error(chalk.red(`--combine must be one of ${COMBINE_METHODS.join(", ")}`));
        process.exitCode = 1;
        return;
      }

      let report;
      try {
        report = await backtestRepo(resolve(path), {
          testCommits: parseInt(options.testCommits, 10),
          ks: options.k.split(",").map((k) => parseInt(k, 10)).filter((k) => k > 0),
          queryFiles: parseInt(options.queryFiles, 10),
          minSupport: parseInt(options.minSupport, 10),
          minConfidence: parseFloat(options.minConfidence),
          combine: options.combine as CombineMethod,
          walkForward: options.walkForward,
          withGraph: options.withGraph,
          shrinkage: options.shrinkage === undefined ? undefined : parseFloat(options.shrinkage),
        });
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exitCode = 1;
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      const o = report.options;
      console.log("");
      console.log(
        chalk.dim(
          `train ${report.trainCommits} commits · test ${report.testCommits} · ` +
            `${o.queryFiles} file(s)/query · ${o.combine} · minSupport ${o.minSupport} · shrinkage ${o.shrinkage} · ` +
            `${o.walkForward ? "walk-forward" : "static split"}` +
            (o.withGraph ? " · + import graph" : "")
        )
      );
      console.log(
        chalk.dim(
          `evaluated ${report.evaluatedCommits} commits (${report.skipped.tooFewFiles} with < 2 known files, ` +
            `${report.skipped.bulk} bulk) · ${report.queries} queries, ${report.answered} answered`
        )
      );
      console.log("");
      console.log(`  ${"k".padEnd(4)}${"precision".padStart(11)}${"recall".padStart(10)}${"hit-rate".padStart(10)}`);
      for (const m of report.metrics) {
        console.log(
          `  ${String(m.k).padEnd(4)}${pct(m.precision).padStart(11)}${pct(m.recall).padStart(10)}${pct(m.hitRate).padStart(10)}`
        );
      }
      console.log(`  ${chalk.dim("coverage")} ${pct(report.coverage)}`);
      if (report.evaluatedCommits < 30) {
        console.log(chalk.yellow(`\n  Only ${report.evaluatedCommits} commits evaluated: treat these numbers as noisy.`));
      }
      console.log("");
    }
  );
