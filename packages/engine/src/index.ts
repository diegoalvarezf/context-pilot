export { ContextEngine, toProjectPath } from "./engine.js";
export { openDatabase } from "./storage/sqlite.js";
export { parseGitLog } from "./history/git.js";
export {
  mineCommits,
  combineCoChanges,
  defaultIgnore,
  DEFAULT_MIN_SUPPORT,
  DEFAULT_MIN_CONFIDENCE,
} from "./history/cochange.js";
export type { CombineMethod } from "./history/cochange.js";
export { backtestCoChanges, backtestRepo, DEFAULT_TEST_COMMITS } from "./history/backtest.js";
export type { BacktestOptions, BacktestReport, BacktestMetrics } from "./history/backtest.js";
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
