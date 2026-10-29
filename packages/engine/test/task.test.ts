import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { screenPrompt } from "../src/pilot/task.js";

const negatives = (JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "bench", "tasks", "negatives.json"), "utf8")) as { prompts: string[] }).prompts;
const reason = (prompt: string, repo = "portfolio") => {
  const r = screenPrompt(prompt, repo);
  return "reason" in r ? r.reason : null;
};

describe("screenPrompt: not code tasks (real prompts)", () => {
  it("stays silent on pasted reports, even full of code names", () => {
    expect(reason(negatives[0])).toBe("pasted text");
    expect(reason(negatives[1])).toBe("pasted text");
    expect(reason("[Pasted text #1 +40 lines] what do you think")).toBe("pasted text");
  });

  it("stays silent when a prompt asks for text instead of code", () => {
    expect(reason("pásame el prompt para el chat de context-pilot")).toBe("asks for text, not code");
    expect(reason("dame un prompt con lo hecho")).toBe("asks for text, not code");
    expect(reason("write me a prompt for another chat about context-pilot")).toBe("asks for text, not code");
  });

  it("stays silent on questions and chat without a change request", () => {
    expect(reason("esta subido?")).toBe("question without a change request");
    expect(reason("Por otro lado, ¿cómo va el SEO de la página? ¿Ya salimos en los buscadores?")).toBe("question without a change request");
    expect(reason("is it deployed yet?")).toBe("question without a change request");
    expect(reason("how does context-pilot work?")).toBe("question without a change request");
  });

  it("stays silent on logs and diffs", () => {
    expect(reason(negatives.find((p) => p.startsWith("Error:"))!)).toBe("too long for a task");
    expect(reason(negatives.find((p) => p.startsWith("diff --git"))!)).toBe("too long for a task");
  });

  it("stays silent when the only words are the repo's or the tool's names", () => {
    expect(reason("context-pilot", "portfolio")).toBe("only the repo or tool name");
    expect(reason("lo de context-pilot del portfolio", "portfolio")).toBe("only the repo or tool name");
  });

  it("screens out the bench's negatives; the rest are left to the map's confidence", () => {
    // `bench --negatives` checks the whole decision (screening + confidence) on real repos
    const passed = negatives.filter((p) => reason(p) === null);
    expect(passed).toEqual(["no me verbosees", "thanks, that looks good", "what did you change in the last commit?"]);
  });
});

describe("screenPrompt: code tasks still get a map", () => {
  it.each([
    "fix the retry delay when the server sends Retry-After",
    "Arreglar que `response.clone().json()` ignore `parseJson`",
    "añade un botón para darle de comer a Dibo en el panel del chat",
    "¿por qué falla el login cuando la cookie caduca?",
    "why does fetchWithRetry throw on a 429?",
    "where is `calculateRetryDelay` defined?",
    "actualiza la página de context-pilot con la versión 0.7",
    "Harden retry",
  ])("%s", (prompt) => {
    const r = screenPrompt(prompt, "portfolio");
    expect(r).toEqual({ task: prompt.trim() });
  });

  it("keeps the tool's name in its own repo, where it is code", () => {
    expect(screenPrompt("make the pilot map shorter", "context-pilot")).toEqual({ task: "make the pilot map shorter" });
  });
});
