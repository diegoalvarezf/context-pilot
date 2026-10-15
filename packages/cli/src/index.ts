#!/usr/bin/env node
// Install the warning filter before anything loads node:sqlite (ESM loads
// static imports during linking, before any module body runs).
import "./quiet-warnings.js";

await import("./main.js");
