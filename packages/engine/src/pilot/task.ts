import { basename } from "path";
import { fold } from "./lang.js";
import { identifiers, terms } from "./search.js";
import type { IContextEngine, PilotResult } from "../types.js";

// Is this prompt a task about the code? The prompt hook only answers then: a map
// for pasted reports, small talk or "write me a summary" is noise, however well
// some of its words match the code.

/** Below this the task probably isn't about code we can find: say nothing (see `bench`) */
export const PROMPT_MIN_CONFIDENCE = 0.3;
export const PROMPT_BUDGET = 800;
const MIN_PROMPT_CHARS = 12;
/** Longer than this is a report, a log or a diff, not a task */
const MAX_TASK_CHARS = 1500;
const MAX_TASK_LINES = 25;

/** The tool itself: naming it says nothing about where to look */
const TOOL_TERMS = ["context", "pilot", "contextpilot"];

const QUESTION_START =
  /^(qu[eé]|c[oó]mo|cu[aá]l(es)?|cu[aá]nto|d[oó]nde|cu[aá]ndo|por ?qu[eé]|qui[eé]n|hay|tengo|est[aá]|es|son|puedes|podr[ií]as|sabes|what|how|which|where|when|why|who|is|are|was|were|do|does|did|can|could|should|would|will|have|has)\b/i;

/** A request to change, build or investigate code */
const CHANGE_REQUEST =
  /\b(arregl\w*|correg\w*|a[ñn]ad\w*|agreg\w*|cambi\w*|implement\w*|cre[ae]\w*|quit\w*|elimin\w*|borr\w*|muev\w*|mover|renombr\w*|refactori\w*|actualiz\w*|migr\w*|optimiz\w*|mejor\w*|soport\w*|depur\w*|investig\w*|falla\w*|fallo|error\w*|bug|roto|rompe\w*|crash\w*|fix\w*|add\w*|chang\w*|implement\w*|creat\w*|remov\w*|delet\w*|renam\w*|refactor\w*|updat\w*|migrat\w*|mak(e|ing)|mov(e|ing)|replac\w*|support\w*|handl\w*|improv\w*|debug\w*|investigat\w*|fail\w*|broken|break\w*|throw\w*|crash\w*)\b/i;

/** "write me a prompt / give me a summary": the answer is text, not code */
const ASKS_FOR_TEXT =
  /\b(dame|p[aá]same|pasa(me)?|escr[ií]be(me)?|redacta(me)?|haz(me)?|genera(me)?|prepara(me)?|resume(me)?|res[uú]meme|l[ií]stame|give me|write( me)?|draft|summari[sz]e|list)\b[^.\n]{0,50}\b(prompt|resumen|summary|mensaje|message|email|correo|texto|text|tweet|post|lista|list|hecho|done|changelog)\b/i;

export type NotATask =
  | "prompt too short"
  | "pasted text"
  | "too long for a task"
  | "question without a change request"
  | "asks for text, not code"
  | "only the repo or tool name";

export type Screened = { task: string } | { reason: NotATask };

/** Words naming this repo or the tool, folded and split like task terms. */
function nameTerms(repoName: string): Set<string> {
  return new Set([...terms(repoName), ...TOOL_TERMS, fold(repoName.toLowerCase()).replace(/[^a-z0-9]/g, "")]);
}

/**
 * Whether `prompt` is a code task for the repo called `repoName`. A prompt whose only words are
 * the repo's or the tool's own names isn't one: they match code by accident (a "ContextPilotDemo"
 * component, a "portfolio" folder) without saying where to look. Otherwise the whole prompt is
 * the task: in the tool's own repo, "pilot" is code.
 */
export function screenPrompt(prompt: string, repoName: string): Screened {
  const text = prompt.trim();
  if (text.length < MIN_PROMPT_CHARS) return { reason: "prompt too short" };
  if (/<\/?pasted_content\b/i.test(text) || /\[Pasted text #\d+/i.test(text)) return { reason: "pasted text" };
  if (text.length > MAX_TASK_CHARS || text.split("\n").length > MAX_TASK_LINES) return { reason: "too long for a task" };

  const names = nameTerms(repoName);
  const named = identifiers(text).filter((i) => !names.has(i.toLowerCase().replace(/[^a-z0-9]/g, "")));
  const isQuestion = /\?\s*$/.test(text) || text.startsWith("¿") || QUESTION_START.test(fold(text));
  if (isQuestion && !CHANGE_REQUEST.test(text) && named.length === 0) return { reason: "question without a change request" };
  if (ASKS_FOR_TEXT.test(text) && named.length === 0) return { reason: "asks for text, not code" };

  // Without the repo's and tool's names, something must still be left to search for
  const kept = text
    .split(/(\s+)/)
    .filter((w) => !terms(w).length || !terms(w).every((t) => names.has(t)))
    .join("")
    .trim();
  if (terms(kept).length === 0 && identifiers(kept).length === 0) return { reason: "only the repo or tool name" };
  return { task: text };
}

export interface PromptMap {
  map: PilotResult | null;
  /** Why there is no map */
  reason?: NotATask | "no matching code" | "low confidence";
  confidence?: number;
  /** The task searched for, after screening */
  task?: string;
}

/** What the prompt hook does with a prompt: screen it, build the map, keep it only when confident. */
export function mapForPrompt(engine: IContextEngine, projectPath: string, prompt: string, budget = PROMPT_BUDGET): PromptMap {
  const screened = screenPrompt(prompt, basename(projectPath));
  if ("reason" in screened) return { map: null, reason: screened.reason };
  const map = engine.pilot({ projectPath, task: screened.task, budget });
  if (map.files.length === 0) return { map: null, reason: "no matching code", confidence: map.confidence, task: screened.task };
  if (map.confidence < PROMPT_MIN_CONFIDENCE) return { map: null, reason: "low confidence", confidence: map.confidence, task: screened.task };
  return { map, confidence: map.confidence, task: screened.task };
}
