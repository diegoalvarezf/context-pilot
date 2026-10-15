import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { statusCommand } from "./commands/status.js";
import { serveCommand } from "./commands/serve.js";
import { indexCommand } from "./commands/index.js";
import { coChangesCommand } from "./commands/co-changes.js";
import { impactCommand } from "./commands/impact.js";
import { backtestCommand } from "./commands/backtest.js";

const program = new Command();

program
  .name("context-pilot")
  .description("Change-impact analysis for AI coding agents")
  .version("0.3.0");

program.addCommand(initCommand);
program.addCommand(statusCommand);
program.addCommand(serveCommand);
program.addCommand(indexCommand);
program.addCommand(impactCommand);
program.addCommand(coChangesCommand);
program.addCommand(backtestCommand);

program.parse();
