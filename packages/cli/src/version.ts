import { createRequire } from "module";

const require = createRequire(import.meta.url);

export const CLI_VERSION: string = (require("../package.json") as { version: string }).version;
