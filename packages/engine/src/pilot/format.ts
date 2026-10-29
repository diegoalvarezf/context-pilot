import type { FindSymbolResponse, OutlineResponse } from "../types.js";

// Compact text answers: the point is to cost fewer tokens than grep + read.

export function formatOutline(r: OutlineResponse): string {
  if (!r.indexed) return `${r.path}: not indexed (unsupported language, ignored, or new since the last index).`;
  if (r.symbols.length === 0) return `${r.path}: no functions or classes (~${r.fileTokens} tokens to read in full).`;
  const lines = r.symbols.map((s) => {
    const range = s.startLine === s.endLine ? `L${s.startLine}` : `L${s.startLine}-${s.endLine}`;
    return `${s.parent ? "    " : "  "}${range}  ${s.signature}`;
  });
  return `${r.path} (~${r.fileTokens} tokens in full; read only the ranges you need)\n${lines.join("\n")}`;
}

export function formatFindSymbol(r: FindSymbolResponse): string {
  const out: string[] = [];
  if (r.definitions.length === 0) out.push(`${r.name}: no definition in the index.`);
  for (const d of r.definitions) {
    out.push(`defined: ${d.path}:${d.startLine}-${d.endLine}  ${d.signature}${d.parent ? `  (in ${d.parent})` : ""}`);
  }
  if (r.totalUses === 0) out.push("no uses found.");
  else {
    out.push(`used ${r.totalUses} times in ${r.uses.length} file(s):`);
    for (const u of r.uses) {
      const shown = u.lines.slice(0, 8).join(", ");
      out.push(`  ${u.path}: ${shown}${u.lines.length > 8 ? `, … (+${u.lines.length - 8})` : ""}`);
    }
  }
  return out.join("\n");
}
