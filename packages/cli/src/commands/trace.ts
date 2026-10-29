import { Command } from "commander";
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "fs";
import { resolve } from "path";
import chalk from "chalk";
import {
  filterTrace,
  FOLLOW_WINDOW,
  parseSince,
  parseTrace,
  readTrace,
  summarize,
  traceFile,
  usefulness,
  type TraceRecord,
} from "../trace.js";
import { DOCTOR_SESSION } from "./doctor.js";

const RESULT_COLOR: Record<string, (s: string) => string> = {
  said: chalk.green,
  silent: chalk.dim,
  error: chalk.red,
  skipped: chalk.yellow,
};

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");

function line(r: TraceRecord): string {
  const time = new Date(r.ts).toLocaleString();
  const color = RESULT_COLOR[r.result] ?? ((s: string) => s);
  const details = [
    r.reason,
    r.confidence !== undefined ? `confidence ${r.confidence}` : null,
    r.files?.length ? `${r.files.length} file${r.files.length === 1 ? "" : "s"}: ${r.files.slice(0, 3).join(", ")}${r.files.length > 3 ? "…" : ""}` : null,
  ].filter(Boolean);
  const project = r.project ? r.project.split(/[\\/]/).pop() : "-";
  return `${chalk.dim(time)}  ${r.agent.padEnd(7)} ${r.event.padEnd(6)} ${color(r.result.padEnd(7))} ${String(r.ms).padStart(5)}ms  ${chalk.cyan(project)}  ${chalk.dim(details.join(" · "))}`;
}

function readTranscript(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** Prints new trace lines as hooks write them, until interrupted. */
function follow(file: string, keep: (r: TraceRecord) => boolean): void {
  console.log(chalk.dim(`Following ${file} — use your agent; Ctrl+C to stop.\n`));
  let offset = existsSync(file) ? statSync(file).size : 0;
  let partial = "";
  setInterval(() => {
    if (!existsSync(file)) return;
    const size = statSync(file).size;
    if (size < offset) offset = 0; // rotated
    if (size === offset) return;
    const fd = openSync(file, "r");
    try {
      const buf = Buffer.alloc(size - offset);
      readSync(fd, buf, 0, buf.length, offset);
      offset = size;
      const text = partial + buf.toString("utf8");
      const cut = text.lastIndexOf("\n");
      partial = text.slice(cut + 1);
      for (const r of parseTrace(text.slice(0, cut + 1))) if (keep(r)) console.log(line(r));
    } finally {
      closeSync(fd);
    }
  }, 400);
}

export const traceCommand = new Command("trace")
  .description("What the hooks did: when they spoke, stayed silent or failed, how fast, and whether agents used what they suggested")
  .option("--since <age>", "Only calls newer than this (e.g. 30m, 24h, 7d)")
  .option("-p, --project <path>", "Only calls for this project")
  .option("-f, --follow", "Show calls live as they happen", false)
  .option("-n, --last <n>", "How many recent calls to list", "10")
  .option("--json", "Output raw JSON", false)
  .action((options: { since?: string; project?: string; follow: boolean; last: string; json: boolean }) => {
    const file = traceFile();
    const project = options.project ? resolve(options.project) : null;
    const sinceMs = options.since ? parseSince(options.since) : null;
    if (options.since && sinceMs === null) {
      console.error(chalk.red(`Not a duration: ${options.since} (use e.g. 30m, 24h, 7d)`));
      process.exitCode = 1;
      return;
    }

    if (options.follow) {
      follow(file, (r) => !project || (r.project ?? "").toLowerCase() === project.toLowerCase());
      return;
    }

    // doctor's own test calls are not agent sessions
    const records = filterTrace(readTrace(file), { sinceMs, project }).filter((r) => r.session !== DOCTOR_SESSION);
    const summary = summarize(records);
    const useful = usefulness(records, readTranscript);
    const last = records.slice(-parseInt(options.last, 10));

    if (options.json) {
      console.log(JSON.stringify({ file, calls: records.length, events: summary, usefulness: useful, last }, null, 2));
      return;
    }

    if (records.length === 0) {
      console.log(chalk.dim(`No hook calls recorded${options.since ? ` in the last ${options.since}` : ""}${project ? ` for ${project}` : ""}.`));
      console.log(chalk.dim(`Trace: ${file}. Run \`context-pilot doctor\` if you expected some.`));
      return;
    }

    const first = new Date(records[0].ts).toLocaleString();
    console.log(chalk.bold(`${records.length} hook calls`) + chalk.dim(` since ${first}${project ? ` in ${project}` : ""}\n`));

    console.log(chalk.bold("  event   calls  said  silent  error  skipped   mean    p95"));
    for (const e of summary) {
      console.log(
        `  ${e.event.padEnd(7)} ${String(e.calls).padStart(5)} ${chalk.green(String(e.said).padStart(5))} ${chalk.dim(String(e.silent).padStart(7))} ${(e.error ? chalk.red : chalk.dim)(String(e.error).padStart(6))} ${chalk.dim(String(e.skipped).padStart(8))} ${String(e.meanMs).padStart(5)}ms ${String(e.p95Ms).padStart(5)}ms`
      );
      const reasons = Object.entries(e.reasons).sort((a, b) => b[1] - a[1]);
      for (const [reason, n] of reasons.slice(0, 4)) console.log(chalk.dim(`            ${String(n).padStart(4)} × ${reason}`));
    }

    console.log(chalk.bold(`\nSuggestions used`) + chalk.dim(` (agent opened or changed the file within its next ${FOLLOW_WINDOW} tool calls)`));
    if (useful.length === 0) {
      console.log(chalk.dim("  Nothing to measure yet: no suggestions with a readable transcript."));
    } else {
      for (const u of useful) {
        console.log(
          `  ${u.event.padEnd(7)} ${chalk.green(pct(u.used, u.suggested).padStart(5))} of ${u.suggested} suggested files` +
            chalk.dim(` · at least one used in ${pct(u.callsWithUse, u.calls)} of ${u.calls} calls`)
        );
      }
      console.log(chalk.dim("  Some of these files the agent would have opened anyway: read it as an upper bound."));
    }

    console.log(chalk.bold(`\nLast ${last.length} calls`));
    for (const r of last) console.log("  " + line(r));
    console.log(chalk.dim(`\nTrace: ${file}`));
  });
