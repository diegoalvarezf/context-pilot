import { describe, expect, it } from "vitest";
import { alternatives, fold, translateTerm } from "../src/pilot/lang.js";
import { searchFiles } from "../src/pilot/search.js";

describe("Spanish task terms", () => {
  it("folds accents", () => {
    expect(fold("petición")).toBe("peticion");
    expect(fold("tamaño")).toBe("tamano");
  });

  it("translates through plurals and verb forms", () => {
    expect(translateTerm("reintento")).toContain("retry");
    expect(translateTerm("reintentos")).toContain("retry");
    expect(translateTerm("reintentar")).toContain("retry");
    expect(translateTerm("cabeceras")).toContain("header");
    expect(translateTerm("peticiones")).toContain("request");
    expect(translateTerm("validación")).toContain("validate");
    expect(translateTerm("arreglando")).toContain("fix");
    expect(translateTerm("guardado")).toContain("save");
  });

  it("leaves English and unknown words alone", () => {
    expect(translateTerm("retry")).toEqual([]);
    expect(translateTerm("fetch")).toEqual([]);
    expect(translateTerm("zxqw")).toEqual([]);
  });

  it("is safe with Object.prototype names", () => {
    expect(translateTerm("constructor")).toEqual([]);
    expect(translateTerm("tostring")).toEqual([]);
    expect(alternatives("hasownproperty")).toEqual(["hasownproperty"]);
  });

  it("keeps the term itself, for code written in Spanish", () => {
    expect(alternatives("petición")).toEqual(["peticion", "request", "req"]);
  });
});

describe("search with a Spanish task", () => {
  const symbols = [
    { path: "src/retry.ts", name: "retryDelay", kind: "function", startLine: 1 },
    { path: "src/retry.ts", name: "shouldRetry", kind: "function", startLine: 10 },
    { path: "src/headers.ts", name: "mergeHeaders", kind: "function", startLine: 1 },
    { path: "src/body.ts", name: "readBody", kind: "function", startLine: 1 },
  ];
  const paths = ["src/retry.ts", "src/headers.ts", "src/body.ts", "README.md"];

  it("finds the code an English-named codebase uses for it", () => {
    const hits = searchFiles("arreglar el retraso de los reintentos", symbols, paths);
    expect(hits[0].path).toBe("src/retry.ts");
    expect(hits[0].coverage).toBeGreaterThan(0.5);
  });

  it("matches a term once even when several translations hit", () => {
    const hits = searchFiles("fusionar las cabeceras", symbols, paths);
    expect(hits[0].path).toBe("src/headers.ts");
    expect(hits[0].coverage).toBeCloseTo(1, 5);
  });

  it("finds nothing for words the code doesn't have", () => {
    expect(searchFiles("pintar el gato", symbols, paths)).toEqual([]);
  });

  it("gives the same result for an English task as before", () => {
    const hits = searchFiles("fix the retry delay", symbols, paths);
    expect(hits[0].path).toBe("src/retry.ts");
    expect(hits[0].terms).toEqual(expect.arrayContaining(["retry", "delay"]));
  });
});
