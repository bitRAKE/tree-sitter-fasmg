// CodeMirror 6 Language adapter for fasmg.
//
// Wraps web-tree-sitter as a Lezer-shaped Parser so @codemirror/language
// can treat the fasmg source as a first-class CM6 language: syntaxTree()
// returns a real Lezer Tree, selection-expansion / indent / fold services
// work, and our styleTag assignments feed the CM6 HighlightStyle pipeline
// alongside the decoration-based highlighting in cm6/highlight.js.
//
// The Lezer NodeType set mirrors the grammar's node-types.json (66 named
// types today), plus one synthetic "ERROR" NodeType flagged error:true so
// @codemirror/lint can pick it out structurally. Anonymous nodes are
// skipped in the conversion — they bloat the tree without carrying
// information users care about.
//
// Note: this is a *second* parse pass per edit on top of the one in
// cm6/highlight.js. That's wasteful; collapsing them into a single parse
// shared across both surfaces is a Phase 9 concern (along with the
// WASM-baked Lezer TreeBuffer emission gate).

import {
  NodeProp,
  NodeSet,
  NodeType,
  Parser as LezerParser,
  Tree,
} from "@lezer/common";
import { styleTags, tags as t } from "@lezer/highlight";
import {
  HighlightStyle,
  Language,
  LanguageSupport,
  defineLanguageFacet,
  syntaxHighlighting,
} from "@codemirror/language";

import { loadFasmgLanguage } from "../../shared/fasmg-web.js";

const TreeSitterPromise = import(
  "https://tree-sitter.github.io/web-tree-sitter.js"
);

let tsLanguage = null;
let tsParser = null;
let nodeSet = null;
let topType = null;
let errorType = null;
let nodeIndex = null;

export function initFasmgLanguage() {
  if (runtimePromise) return runtimePromise;
  runtimePromise = load();
  return runtimePromise;
}

let runtimePromise = null;

async function load() {
  const TreeSitter = await TreeSitterPromise;
  await TreeSitter.Parser.init();
  tsLanguage = await loadFasmgLanguage();

  const nodeTypesUrl = new URL("../../../src/node-types.json", import.meta.url);
  const response = await fetch(nodeTypesUrl);
  if (!response.ok) {
    throw new Error(`failed to load node-types.json: ${response.status}`);
  }
  const nodeTypes = await response.json();

  const types = [];
  nodeIndex = new Map();

  topType = NodeType.define({
    id: 0,
    name: "source_file",
    top: true,
  });
  types.push(topType);
  nodeIndex.set("source_file", topType);

  let id = 1;
  for (const entry of nodeTypes) {
    if (!entry.named) continue;
    if (entry.type === "source_file") continue;
    const nt = NodeType.define({ id: id++, name: entry.type });
    types.push(nt);
    nodeIndex.set(entry.type, nt);
  }

  errorType = NodeType.define({
    id: id++,
    name: "ERROR",
    error: true,
  });
  types.push(errorType);
  nodeIndex.set("ERROR", errorType);

  nodeSet = new NodeSet(types).extend(
    styleTags({
      comment: t.lineComment,
      string_literal: t.string,
      number_literal: t.number,
      directive_keyword: t.keyword,
      "symbol_name/...": t.variableName,
      identifier: t.variableName,
      ERROR: t.invalid,
    }),
  );

  tsParser = new TreeSitter.Parser();
  tsParser.setLanguage(tsLanguage);
}

class FasmgLezerParser extends LezerParser {
  createParse(input) {
    return new FasmgPartialParse(input);
  }
}

class FasmgPartialParse {
  constructor(input) {
    this.input = input;
    this.parsedPos = 0;
    this.stoppedAt = null;
  }

  advance() {
    if (!tsParser || !nodeSet) {
      this.parsedPos = this.input.length;
      const type = topType ?? NodeType.none;
      return new Tree(type, [], [], this.input.length);
    }

    const source = this.input.read(0, this.input.length);
    const tsTree = tsParser.parse(source);
    try {
      return convertNode(tsTree.rootNode);
    } finally {
      tsTree.delete?.();
      this.parsedPos = this.input.length;
    }
  }

  stopAt(pos) {
    this.stoppedAt = pos;
  }
}

function convertNode(tsNode) {
  const children = [];
  const positions = [];
  const baseStart = tsNode.startIndex;

  const childCount = tsNode.childCount;
  for (let i = 0; i < childCount; i += 1) {
    const child = tsNode.child(i);
    if (!child.isNamed && child.type !== "ERROR") continue;
    children.push(convertNode(child));
    positions.push(child.startIndex - baseStart);
  }

  let nodeType;
  if (tsNode.type === "ERROR") {
    nodeType = errorType;
  } else {
    nodeType = nodeIndex.get(tsNode.type) ?? topType;
  }

  return new Tree(
    nodeType,
    children,
    positions,
    tsNode.endIndex - tsNode.startIndex,
  );
}

const fasmgFacet = defineLanguageFacet({
  commentTokens: { line: ";" },
});

export const fasmgLanguage = new Language(
  fasmgFacet,
  new FasmgLezerParser(),
  [],
  "fasmg",
);

// A bare, class-based HighlightStyle so CSS owns the palette. Paired
// with cm6/highlight.js's decoration layer it gives us two routes to
// the same colours — useful if we ever want to switch off the
// decoration path (e.g., static HTML export via @lezer/highlight).
export const fasmgHighlightStyle = HighlightStyle.define([
  { tag: t.lineComment, class: "tok-comment" },
  { tag: t.string, class: "tok-string" },
  { tag: t.number, class: "tok-number" },
  { tag: t.keyword, class: "tok-keyword" },
  { tag: t.variableName, class: "tok-variable" },
  { tag: t.invalid, class: "tok-invalid" },
]);

export function fasmgLanguageSupport() {
  return new LanguageSupport(fasmgLanguage, [
    syntaxHighlighting(fasmgHighlightStyle),
  ]);
}

export { nodeSet as fasmgNodeSet, errorType as fasmgErrorType };

// Expose the shared tree-sitter parser so main.js can drive its own
// parse for tree-string construction without spinning up a fresh
// instance. Caller owns the returned tree and must call tree.delete().
export function parseFasmgSource(source) {
  if (!tsParser) {
    throw new Error("fasmg Language runtime not initialised");
  }
  return tsParser.parse(source);
}
