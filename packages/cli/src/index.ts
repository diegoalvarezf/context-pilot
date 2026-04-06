#!/usr/bin/env node
import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { statusCommand } from "./commands/status.js";
import { serveCommand } from "./commands/serve.js";
import { indexCommand } from "./commands/index.js";
import { uiCommand } from "./commands/ui.js";

const program = new Command();

program
  .name("context-pilot")
  .description("Intelligent context middleware for AI coding agents")
  .version("0.1.0");

program.addCommand(initCommand);
program.addCommand(statusCommand);
program.addCommand(serveCommand);
program.addCommand(indexCommand);
program.addCommand(uiCommand);

program.parse();
