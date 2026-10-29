// Child process of parseInChild(): reads ParseJob[] as JSON on stdin, writes (ParsedFile | null)[].
import { parseInProcess, type ParseJob, type ParsedFile } from "./parse.js";

const chunks: Buffer[] = [];
for await (const c of process.stdin) chunks.push(c as Buffer);
const jobs = JSON.parse(Buffer.concat(chunks).toString("utf8")) as ParseJob[];
const results: (ParsedFile | null)[] = [];
for (const job of jobs) {
  try {
    results.push(await parseInProcess(job));
  } catch {
    results.push(null);
  }
}
process.stdout.write(JSON.stringify(results));
