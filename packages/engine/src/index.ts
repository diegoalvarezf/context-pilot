export { ContextEngine, toProjectPath } from "./engine.js";
export { openDatabase } from "./storage/sqlite.js";
export { parseGitLog } from "./history/git.js";
export { mineCommits, combineCoChanges, defaultIgnore } from "./history/cochange.js";
export type {
  IContextEngine,
  IndexResult,
  StatusResult,
  SubgraphResult,
  HistoryResult,
  HistoryStatus,
  CoChangeQuery,
  CoChangeResponse,
  CoChangeResult,
  CoChangeSource,
  Chunk,
  GraphNode,
  GraphEdge,
} from "./types.js";
