import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { statusCommand } from "./commands/status.js";
import { serveCommand } from "./commands/serve.js";
import { indexCommand } from "./commands/index.js";
import { coChangesCommand } from "./commands/co-changes.js";
import { impactCommand } from "./commands/impact.js";
import { checkCommand } from "./commands/check.js";
import { hintCommand } from "./commands/hint.js";
import { hookCommand } from "./commands/hook.js";
import { setupCommand } from "./commands/setup.js";
import { CLI_VERSION } from "./version.js";
import { backtestCommand } from "./commands/backtest.js";
import { pilotCommand } from "./commands/pilot.js";
import { findCommand } from "./commands/find.js";
import { outlineCommand } from "./commands/outline.js";
import { benchCommand } from "./commands/bench.js";

const program = new Command();

program
  .name("context-pilot")
  .description("Pilots your coding agent's context: where to look, what else changes, which tests to run")
  .version(CLI_VERSION);

program.addCommand(setupCommand);
program.addCommand(initCommand);
program.addCommand(statusCommand);
program.addCommand(serveCommand);
program.addCommand(indexCommand);
program.addCommand(pilotCommand);
program.addCommand(findCommand);
program.addCommand(outlineCommand);
program.addCommand(impactCommand);
program.addCommand(checkCommand);
program.addCommand(hintCommand);
program.addCommand(hookCommand);
program.addCommand(coChangesCommand);
program.addCommand(backtestCommand);
program.addCommand(benchCommand);

program.parse();
