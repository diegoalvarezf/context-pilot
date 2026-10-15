export { ContextEngine, toProjectPath, DEFAULT_CHECK_MIN_SCORE } from "./engine.js";
export { parseNameStatus, readWorkingChanges } from "./history/diff.js";
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
export { computeImpact, isTestFile, testStem, describeSignal, IMPACT_WEIGHTS } from "./impact/impact.js";
export { ImportResolver, resolveFileImports } from "./indexer/imports.js";
export type { ImportEdge } from "./indexer/imports.js";
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
  ImpactQuery,
  CheckQuery,
  CheckResponse,
  WorkingChange,
  ImpactResponse,
  ImpactResult,
  ImpactSignal,
  ImpactSignalKind,
  Chunk,
  GraphNode,
  GraphEdge,
} from "./types.js";
