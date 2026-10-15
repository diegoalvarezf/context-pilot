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

export interface ImportSpec {
  /** Module specifier as written: "./foo.js", ".models", "App\Models\User", "lib/db.php" */
  to: string;
  /** Imported names, for `from . import a, b` style imports that name modules */
  names?: string[];
}

const stripQuotes = (text: string): string => text.replace(/^[`'"]|[`'"]$/g, "");
const stripAlias = (text: string): string => text.replace(/\s+as\s+\S+$/i, "").trim();

/**
 * Extract module specifiers imported by a file. Resolution to project files
 * happens later, in imports.ts.
 */
export function extractImports(source: string, language: string, tree: Parser.Tree): ImportSpec[] {
  const imports: ImportSpec[] = [];
  const isJs = language === "javascript" || language === "typescript" || language === "tsx";

  function visit(node: Parser.SyntaxNode): void {
    if (isJs) {
      if (node.type === "import_statement" || node.type === "import_declaration" || node.type === "export_statement") {
        const sourceNode = node.childForFieldName("source");
        if (sourceNode) imports.push({ to: stripQuotes(sourceNode.text) });
      } else if (node.type === "call_expression") {
        // require("x") and dynamic import("x") with a literal argument
        const fn = node.childForFieldName("function");
        const args = node.childForFieldName("arguments");
        const first = args?.namedChild(0);
        if (fn && first && first.type === "string" && (fn.text === "require" || fn.type === "import")) {
          imports.push({ to: stripQuotes(first.text) });
        }
      }
    }

    if (language === "python") {
      if (node.type === "import_from_statement") {
        const moduleNode = node.childForFieldName("module_name");
        const names = node.childrenForFieldName("name").map((n) => stripAlias(n.text));
        if (moduleNode) imports.push({ to: moduleNode.text, names });
      } else if (node.type === "import_statement") {
        for (const n of node.childrenForFieldName("name")) imports.push({ to: stripAlias(n.text) });
      }
    }

    if (language === "php") {
      if (node.type === "namespace_use_declaration") {
        for (let i = 0; i < node.namedChildCount; i++) {
          const clause = node.namedChild(i);
          if (clause?.type === "namespace_use_clause") imports.push({ to: stripAlias(clause.text).replace(/^\\/, "") });
        }
      } else if (
        node.type === "require_expression" || node.type === "require_once_expression" ||
        node.type === "include_expression" || node.type === "include_once_expression"
      ) {
        const pathNode = node.namedChild(0);
        if (pathNode) imports.push({ to: pathNode.text });
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) visit(child);
    }
  }

  visit(tree.rootNode);
  return imports;
}
