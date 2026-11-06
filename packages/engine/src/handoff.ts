import type { HandoffState } from "./types.js";

/** Whether the handoff was updated within the last maxAgeMs (default: 24h) */
export function isRecentHandoff(handoff: HandoffState, maxAgeMs = 24 * 60 * 60 * 1000): boolean {
  const ts = new Date(handoff.updatedAt).getTime();
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts <= maxAgeMs;
}

/** Formats a compact one-line header for pilot and hooks */
export function formatHandoffHeader(handoff: HandoffState): string {
  const parts = [`[Session Handoff (${handoff.updatedAt})]: ${handoff.summary}`];
  if (handoff.activeFiles && handoff.activeFiles.length > 0) {
    parts.push(`Files: ${handoff.activeFiles.join(", ")}`);
  }
  if (handoff.nextSteps && handoff.nextSteps.trim().length > 0) {
    parts.push(`Next: ${handoff.nextSteps.trim()}`);
  }
  return parts.join(" | ");
}
