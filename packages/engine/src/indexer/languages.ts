import Parser from "web-tree-sitter";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);

let initialized = false;
const languageCache = new Map<string, Parser.Language>();

export async function initTreeSitter(): Promise<void> {
  if (initialized) return;
  await Parser.init();
  initialized = true;
}

export type Lang = "python" | "javascript" | "typescript" | "tsx" | "php" | "html" | "css" | "swift" | "csharp";

// Grammars without a usable .wasm on npm ship with the engine (see grammars/README.md)
const grammarsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "grammars");

export async function loadLanguage(lang: Lang): Promise<Parser.Language> {
  if (languageCache.has(lang)) return languageCache.get(lang)!;

  await initTreeSitter();

  const wasmMap: Record<string, string> = {
    python:     require.resolve("tree-sitter-python/tree-sitter-python.wasm"),
    javascript: require.resolve("tree-sitter-javascript/tree-sitter-javascript.wasm"),
    typescript: require.resolve("tree-sitter-typescript/tree-sitter-typescript.wasm"),
    tsx:        require.resolve("tree-sitter-typescript/tree-sitter-tsx.wasm"),
    php:        require.resolve("tree-sitter-php/tree-sitter-php.wasm"),
    html:       require.resolve("tree-sitter-html/tree-sitter-html.wasm"),
    css:        require.resolve("tree-sitter-css/tree-sitter-css.wasm"),
    swift:      join(grammarsDir, "tree-sitter-swift.wasm"),
    csharp:     join(grammarsDir, "tree-sitter-c_sharp.wasm"),
  };

  const wasmPath = wasmMap[lang];
  if (!wasmPath) throw new Error(`Unsupported language: ${lang}`);

  const language = await Parser.Language.load(wasmPath);
  languageCache.set(lang, language);
  return language;
}

export function getLanguageForFile(filePath: string): Lang | null {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  switch (ext) {
    case ".py":   return "python";
    case ".js":
    case ".jsx":  return "javascript";
    case ".ts":   return "typescript";
    case ".tsx":  return "tsx";
    case ".php":  return "php";
    case ".html":
    case ".htm":  return "html";
    case ".css":  return "css";
    case ".swift": return "swift";
    case ".cs":   return "csharp";
    default:      return null;
  }
}

// Node types to extract per language
export const CHUNK_NODE_TYPES: Record<string, string[]> = {
  python:     ["function_definition", "class_definition"],
  javascript: ["function_declaration", "function_expression", "arrow_function", "class_declaration", "method_definition"],
  typescript: ["function_declaration", "function_expression", "arrow_function", "class_declaration", "method_definition"],
  tsx:        ["function_declaration", "function_expression", "arrow_function", "class_declaration", "method_definition"],
  php:        ["function_definition", "class_declaration", "method_declaration"],
  html:       [], // falls back to module-level chunk
  css:        ["rule_set"],
  swift:      ["class_declaration", "protocol_declaration", "function_declaration"],
  csharp:     ["class_declaration", "struct_declaration", "interface_declaration", "record_declaration", "enum_declaration", "method_declaration", "constructor_declaration"],
};
