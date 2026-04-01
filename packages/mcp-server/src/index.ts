import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ContextEngine } from "@context-pilot/engine";
import { createServer } from "./server.js";

const PROJECT_PATH = process.env.CONTEXT_PILOT_PROJECT ?? process.cwd();

async function main(): Promise<void> {
  const engine = new ContextEngine();
  await engine.init();
  const server = createServer(engine, PROJECT_PATH);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("context-pilot: fatal error", err);
  process.exit(1);
});
