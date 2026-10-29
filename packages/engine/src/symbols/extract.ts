import type Parser from "web-tree-sitter";

// Symbol index: what each file defines (with line ranges and a one-line signature)
// and which names it uses. It answers "where is X" and "what's in this file"
// without the agent grepping or reading whole files.

export type SymbolKind = "function" | "method" | "class" | "interface" | "type" | "enum" | "trait" | "const";

export interface SymbolDef {
  name: string;
  kind: SymbolKind;
  /** Enclosing class, for methods */
  parent: string | null;
  startLine: number;
  endLine: number;
  signature: string;
  exported: boolean;
}

export interface SymbolRef {
  name: string;
  line: number;
}

const JS_DEFS: Record<string, SymbolKind> = {
  function_declaration: "function",
  generator_function_declaration: "function",
  class_declaration: "class",
  abstract_class_declaration: "class",
  method_definition: "method",
  interface_declaration: "interface",
  type_alias_declaration: "type",
  enum_declaration: "enum",
};

const DEFS: Record<string, Record<string, SymbolKind>> = {
  javascript: JS_DEFS,
  typescript: JS_DEFS,
  tsx: JS_DEFS,
  python: { function_definition: "function", class_definition: "class" },
  php: {
    function_definition: "function",
    class_declaration: "class",
    method_declaration: "method",
    interface_declaration: "interface",
    trait_declaration: "trait",
    enum_declaration: "enum",
  },
};

const CLASS_LIKE = new Set(["class", "interface", "trait", "enum"]);
const FUNCTION_VALUES = new Set(["arrow_function", "function_expression", "function", "generator_function"]);
const REF_NODES = new Set([
  "identifier",
  "property_identifier",
  "type_identifier",
  "shorthand_property_identifier",
  "shorthand_property_identifier_pattern",
  "name", // PHP
]);
const MIN_REF_LENGTH = 3;
const MAX_REFS_PER_FILE = 5000;
const MAX_SIGNATURE = 160;

/** First line of a declaration, without its body opener. */
export function signatureOf(text: string): string {
  const first = text.split("\n")[0].replace(/\s+/g, " ").trim();
  const cut = first.replace(/\s*(\{|=>\s*\{?)\s*$/, "").replace(/:\s*$/, "");
  return cut.length > MAX_SIGNATURE ? `${cut.slice(0, MAX_SIGNATURE - 1)}…` : cut;
}

function enclosingClass(node: Parser.SyntaxNode, defs: Record<string, SymbolKind>): string | null {
  for (let p = node.parent; p; p = p.parent) {
    const kind = defs[p.type];
    if (kind && CLASS_LIKE.has(kind)) return p.childForFieldName("name")?.text ?? null;
    if (kind) return null; // nested inside a function: not a method
  }
  return null;
}

function isTopLevel(node: Parser.SyntaxNode): boolean {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === "program" || p.type === "module") return true;
    if (p.type !== "export_statement" && p.type !== "lexical_declaration" && p.type !== "variable_declaration") return false;
  }
  return false;
}

export function extractSymbols(
  language: string,
  tree: Parser.Tree
): { symbols: SymbolDef[]; refs: SymbolRef[] } {
  const defs = DEFS[language];
  if (!defs) return { symbols: [], refs: [] };
  const isJs = language === "javascript" || language === "typescript" || language === "tsx";

  const symbols: SymbolDef[] = [];
  const defNames = new Set<number>(); // startIndex of name nodes that define, not use
  const refs = new Map<string, SymbolRef>();

  function visit(node: Parser.SyntaxNode): void {
    let kind = defs[node.type];
    let nameNode = kind ? node.childForFieldName("name") : null;
    let declNode = node;

    // const foo = () => {} / const foo = function () {}; exported top-level consts too
    if (isJs && node.type === "variable_declarator") {
      const value = node.childForFieldName("value");
      const id = node.childForFieldName("name");
      if (id?.type === "identifier") {
        if (value && FUNCTION_VALUES.has(value.type)) kind = "function";
        else if (isTopLevel(node)) kind = "const";
        if (kind) {
          nameNode = id;
          declNode = node.parent ?? node;
        }
      }
    }

    if (kind && nameNode) {
      const parent = kind === "function" || kind === "method" ? enclosingClass(node, defs) : null;
      if (parent && kind === "function") kind = "method";
      const name = nameNode.text;
      const exported = isJs
        ? declNode.parent?.type === "export_statement" || declNode.type === "export_statement"
        : language === "python"
          ? !name.startsWith("_")
          : !/\bprivate\b/.test(node.text.split("\n")[0]);
      symbols.push({
        name,
        kind,
        parent,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        // Keep "export" in the signature: it tells the agent what's public
        signature: signatureOf(declNode.parent?.type === "export_statement" ? declNode.parent.text : declNode.text),
        exported,
      });
      defNames.add(nameNode.startIndex);
    } else if (REF_NODES.has(node.type) && !defNames.has(node.startIndex)) {
      const name = node.text;
      const line = node.startPosition.row + 1;
      if (name.length >= MIN_REF_LENGTH && refs.size < MAX_REFS_PER_FILE && /^[A-Za-z_$][\w$]*$/.test(name)) {
        refs.set(`${name}:${line}`, { name, line });
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) visit(child);
    }
  }

  visit(tree.rootNode);
  // A name used on the line where it's defined is the definition, not a use
  const defLines = new Set(symbols.map((s) => `${s.name}:${s.startLine}`));
  return { symbols, refs: [...refs.values()].filter((r) => !defLines.has(`${r.name}:${r.line}`)) };
}
