import Parser from "web-tree-sitter";
import { randomUUID } from "crypto";
import type { Chunk } from "../types.js";
import { CHUNK_NODE_TYPES } from "./languages.js";

const MAX_CHUNK_LINES = 100;
const MIN_CHUNK_LINES = 3;

function extractName(node: Parser.SyntaxNode): string | null {
  const nameNode = node.childForFieldName("name");
  return nameNode?.text ?? null;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function visitNode(
  node: Parser.SyntaxNode,
  source: string,
  fileId: string,
  chunkTypes: string[],
  results: Chunk[]
): void {
  if (chunkTypes.includes(node.type)) {
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    const lineCount = endLine - startLine + 1;

    if (lineCount >= MIN_CHUNK_LINES) {
      const content = source.slice(node.startIndex, node.endIndex);
      const chunkType =
        node.type.includes("class") ? "class"
        : node.type === "arrow_function" || node.type === "function_expression" ? "function"
        : "function";

      results.push({
        id: randomUUID(),
        fileId,
        chunkType,
        name: extractName(node),
        content: content.slice(0, MAX_CHUNK_LINES * 120), // cap at ~12KB
        startLine,
        endLine,
        tokenCount: estimateTokens(content),
      });
    }
  }

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) visitNode(child, source, fileId, chunkTypes, results);
  }
}

export function extractChunks(
  source: string,
  fileId: string,
  language: string,
  tree: Parser.Tree
): Chunk[] {
  const chunkTypes = CHUNK_NODE_TYPES[language] ?? [];
  const results: Chunk[] = [];
  visitNode(tree.rootNode, source, fileId, chunkTypes, results);

  // If no chunks found (e.g. a config file), create a module-level chunk
  if (results.length === 0) {
    const lines = source.split("\n").length;
    if (lines >= MIN_CHUNK_LINES) {
      results.push({
        id: randomUUID(),
        fileId,
        chunkType: "module",
        name: null,
        content: source.slice(0, MAX_CHUNK_LINES * 120),
        startLine: 1,
        endLine: lines,
        tokenCount: estimateTokens(source),
      });
    }
  }

  return results;
}

/**
 * Extract import/dependency edges from source for graph building.
 * Returns pairs of [importerChunkName, importedModulePath].
 */
export function extractImports(
  source: string,
  language: string,
  tree: Parser.Tree
): Array<{ from: string; to: string }> {
  const imports: Array<{ from: string; to: string }> = [];

  function visit(node: Parser.SyntaxNode): void {
    if (language === "python" && node.type === "import_from_statement") {
      const moduleNode = node.childForFieldName("module_name");
      if (moduleNode) imports.push({ from: "module", to: moduleNode.text });
    }
    if ((language === "javascript" || language === "typescript" || language === "tsx") &&
        node.type === "import_declaration") {
      const sourceNode = node.childForFieldName("source");
      if (sourceNode) imports.push({ from: "module", to: sourceNode.text.replace(/['"]/g, "") });
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) visit(child);
    }
  }

  visit(tree.rootNode);
  return imports;
}
