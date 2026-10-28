// Pure helpers for `context-pilot hint`: what to tell Claude Code right after it edits a file.

export interface HintCandidate {
  path: string;
  score: number;
  isTest: boolean;
  reasons: string[];
}

/** What this Claude Code session already did, so we never repeat ourselves */
export interface HintState {
  /** Files the agent edited (no point suggesting them) */
  edited: string[];
  /** Files we already pointed at */
  hinted: string[];
}

export const EMPTY_HINT_STATE: HintState = { edited: [], hinted: [] };

/** Strongest candidates not yet edited nor already suggested in this session. */
export function pickHints(
  candidates: HintCandidate[],
  state: HintState,
  opts: { minScore: number; limit: number }
): HintCandidate[] {
  const skip = new Set([...state.edited, ...state.hinted]);
  return candidates
    .filter((c) => c.score >= opts.minScore && !skip.has(c.path))
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit);
}

export function recordHint(state: HintState, edited: string, hinted: HintCandidate[]): HintState {
  return {
    edited: state.edited.includes(edited) ? state.edited : [...state.edited, edited],
    hinted: [...state.hinted, ...hinted.map((h) => h.path).filter((p) => !state.hinted.includes(p))],
  };
}

export function formatHint(edited: string, hints: HintCandidate[]): string {
  const lines = hints.map((h) => {
    const pct = `${Math.round(h.score * 100)}%`;
    const why = h.reasons[0] ? ` — ${h.reasons[0]}` : "";
    return `- ${h.path}${h.isTest ? " [test]" : ""} (${pct})${why}`;
  });
  return (
    `context-pilot: in this repo's history, ${edited} usually changes together with these files. ` +
    "Check whether they need updating as part of this change:\n" +
    lines.join("\n")
  );
}

/** PostToolUse hook output that adds context for Claude without blocking anything. */
export function hookOutput(text: string): string {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: text } });
}

/** The edited file in a PostToolUse payload (Edit, Write, MultiEdit, NotebookEdit). */
export function editedFile(input: { tool_input?: Record<string, unknown> }): string | null {
  const ti = input.tool_input ?? {};
  const p = ti.file_path ?? ti.notebook_path;
  return typeof p === "string" && p ? p : null;
}

/** Session ids become file names: keep them safe. */
export function stateFileName(sessionId: string): string {
  return `hints-${sessionId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "default"}.json`;
}
