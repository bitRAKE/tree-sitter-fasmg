// Hand-written Lezer parser for the tree-sitter S-expression dialect.
//
// Covers:
//   (node_type …)            nested nodes
//   field: <value>           field labels preceding a child
//   "quoted string"          string literals
//   @capture.path            query capture names (highlights.scm style)
//   #predicate?              query predicates (#eq?, #match?, etc.)
//   ERROR / MISSING          tree-sitter error markers (styled as invalid)
//   ; line comment           query-file comments (skipped during tokenise)
//
// Why hand-written: keeps the build pipeline free of @lezer/generator.
// The dialect is small enough to parse recursively in ~150 LoC; we
// return a real Lezer `Tree` so @codemirror/language folding / selection
// expansion / syntaxHighlighting all work out of the box. The identity
// shared with @lezer/common via the import map keeps CM6 happy.

import { Parser, NodeSet, NodeType, Tree } from "@lezer/common";
import { styleTags, tags as t } from "@lezer/highlight";
import {
  HighlightStyle,
  Language,
  LanguageSupport,
  defineLanguageFacet,
  syntaxHighlighting,
} from "@codemirror/language";

const TYPES = [
  NodeType.define({ id: 0, name: "Document", top: true }),
  NodeType.define({ id: 1, name: "Node" }),
  NodeType.define({ id: 2, name: "Field" }),
  NodeType.define({ id: 3, name: "FieldName" }),
  NodeType.define({ id: 4, name: "NodeName" }),
  NodeType.define({ id: 5, name: "ErrorMarker" }),
  NodeType.define({ id: 6, name: "MissingMarker" }),
  NodeType.define({ id: 7, name: "String" }),
  NodeType.define({ id: 8, name: "Identifier" }),
  NodeType.define({ id: 9, name: "Capture" }),
  NodeType.define({ id: 10, name: "Predicate" }),
  NodeType.define({ id: 11, name: "OpenParen" }),
  NodeType.define({ id: 12, name: "CloseParen" }),
  NodeType.define({ id: 13, name: "Colon" }),
  NodeType.define({ id: 14, name: "LineComment" }),
];

const TYPE = Object.fromEntries(TYPES.map((nt) => [nt.name, nt]));

const nodeSet = new NodeSet(TYPES).extend(
  styleTags({
    NodeName: t.typeName,
    ErrorMarker: t.invalid,
    MissingMarker: t.invalid,
    FieldName: t.propertyName,
    String: t.string,
    Identifier: t.variableName,
    Capture: t.meta,
    Predicate: t.operator,
    "OpenParen CloseParen": t.paren,
    Colon: t.punctuation,
    LineComment: t.lineComment,
  }),
);

const BREAK = new Set([" ", "\t", "\n", "\r", "(", ")", ":", '"']);

function tokenise(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i += 1;
      continue;
    }
    if (c === ";") {
      const start = i;
      while (i < src.length && src[i] !== "\n") i += 1;
      tokens.push({ kind: "comment", start, end: i });
      continue;
    }
    if (c === "(") {
      tokens.push({ kind: "lparen", start: i, end: i + 1 });
      i += 1;
      continue;
    }
    if (c === ")") {
      tokens.push({ kind: "rparen", start: i, end: i + 1 });
      i += 1;
      continue;
    }
    if (c === ":") {
      tokens.push({ kind: "colon", start: i, end: i + 1 });
      i += 1;
      continue;
    }
    if (c === '"') {
      const start = i;
      i += 1;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === "\\" && i + 1 < src.length) i += 1;
        i += 1;
      }
      if (i < src.length && src[i] === '"') i += 1;
      tokens.push({ kind: "string", start, end: i });
      continue;
    }
    if (c === "@") {
      const start = i;
      i += 1;
      while (i < src.length && !BREAK.has(src[i])) i += 1;
      tokens.push({ kind: "capture", start, end: i });
      continue;
    }
    if (c === "#") {
      const start = i;
      i += 1;
      while (i < src.length && !BREAK.has(src[i])) i += 1;
      tokens.push({ kind: "predicate", start, end: i });
      continue;
    }
    const start = i;
    while (i < src.length && !BREAK.has(src[i])) i += 1;
    if (i === start) {
      i += 1;
      continue;
    }
    tokens.push({ kind: "ident", start, end: i });
  }
  return tokens;
}

function leaf(type, length) {
  return new Tree(type, [], [], length);
}

export function parseSexp(src) {
  const tokens = tokenise(src);
  const state = { src, tokens, pos: 0 };
  const children = [];
  const positions = [];

  while (state.pos < state.tokens.length) {
    const tok = state.tokens[state.pos];
    if (tok.kind === "lparen") {
      const node = parseNode(state);
      children.push(node.tree);
      positions.push(node.start);
    } else if (tok.kind === "comment") {
      children.push(leaf(TYPE.LineComment, tok.end - tok.start));
      positions.push(tok.start);
      state.pos += 1;
    } else if (tok.kind === "capture") {
      children.push(leaf(TYPE.Capture, tok.end - tok.start));
      positions.push(tok.start);
      state.pos += 1;
    } else if (tok.kind === "predicate") {
      children.push(leaf(TYPE.Predicate, tok.end - tok.start));
      positions.push(tok.start);
      state.pos += 1;
    } else {
      state.pos += 1;
    }
  }

  return new Tree(TYPE.Document, children, positions, src.length);
}

function parseNode(state) {
  const openTok = state.tokens[state.pos];
  const nodeStart = openTok.start;
  state.pos += 1;

  const children = [leaf(TYPE.OpenParen, 1)];
  const positions = [0];

  if (
    state.pos < state.tokens.length &&
    state.tokens[state.pos].kind === "ident"
  ) {
    const tok = state.tokens[state.pos];
    const text = state.src.slice(tok.start, tok.end);
    const headType =
      text === "ERROR"
        ? TYPE.ErrorMarker
        : text === "MISSING"
          ? TYPE.MissingMarker
          : TYPE.NodeName;
    children.push(leaf(headType, tok.end - tok.start));
    positions.push(tok.start - nodeStart);
    state.pos += 1;
  }

  while (
    state.pos < state.tokens.length &&
    state.tokens[state.pos].kind !== "rparen"
  ) {
    const tok = state.tokens[state.pos];

    if (
      tok.kind === "ident" &&
      state.tokens[state.pos + 1]?.kind === "colon"
    ) {
      const field = parseField(state);
      children.push(field.tree);
      positions.push(field.start - nodeStart);
      continue;
    }

    if (tok.kind === "lparen") {
      const child = parseNode(state);
      children.push(child.tree);
      positions.push(child.start - nodeStart);
      continue;
    }

    if (tok.kind === "string") {
      children.push(leaf(TYPE.String, tok.end - tok.start));
      positions.push(tok.start - nodeStart);
      state.pos += 1;
      continue;
    }

    if (tok.kind === "ident") {
      children.push(leaf(TYPE.Identifier, tok.end - tok.start));
      positions.push(tok.start - nodeStart);
      state.pos += 1;
      continue;
    }

    if (tok.kind === "capture") {
      children.push(leaf(TYPE.Capture, tok.end - tok.start));
      positions.push(tok.start - nodeStart);
      state.pos += 1;
      continue;
    }

    if (tok.kind === "predicate") {
      children.push(leaf(TYPE.Predicate, tok.end - tok.start));
      positions.push(tok.start - nodeStart);
      state.pos += 1;
      continue;
    }

    if (tok.kind === "comment") {
      children.push(leaf(TYPE.LineComment, tok.end - tok.start));
      positions.push(tok.start - nodeStart);
      state.pos += 1;
      continue;
    }

    state.pos += 1;
  }

  let endPos = nodeStart + 1;
  if (
    state.pos < state.tokens.length &&
    state.tokens[state.pos].kind === "rparen"
  ) {
    const closeTok = state.tokens[state.pos];
    children.push(leaf(TYPE.CloseParen, 1));
    positions.push(closeTok.start - nodeStart);
    endPos = closeTok.end;
    state.pos += 1;
  }

  return {
    tree: new Tree(TYPE.Node, children, positions, endPos - nodeStart),
    start: nodeStart,
  };
}

function parseField(state) {
  const nameTok = state.tokens[state.pos];
  const fieldStart = nameTok.start;
  state.pos += 2; // consume FieldName + Colon

  const children = [
    leaf(TYPE.FieldName, nameTok.end - nameTok.start),
    leaf(TYPE.Colon, 1),
  ];
  const positions = [0, nameTok.end - nameTok.start];

  let endPos = nameTok.end + 1;

  if (state.pos < state.tokens.length) {
    const valTok = state.tokens[state.pos];
    if (valTok.kind === "lparen") {
      const valNode = parseNode(state);
      children.push(valNode.tree);
      positions.push(valNode.start - fieldStart);
      endPos = valNode.start + valNode.tree.length;
    } else if (
      valTok.kind === "ident" ||
      valTok.kind === "string" ||
      valTok.kind === "capture" ||
      valTok.kind === "predicate"
    ) {
      const type =
        valTok.kind === "string"
          ? TYPE.String
          : valTok.kind === "capture"
            ? TYPE.Capture
            : valTok.kind === "predicate"
              ? TYPE.Predicate
              : TYPE.Identifier;
      children.push(leaf(type, valTok.end - valTok.start));
      positions.push(valTok.start - fieldStart);
      endPos = valTok.end;
      state.pos += 1;
    }
  }

  return {
    tree: new Tree(TYPE.Field, children, positions, endPos - fieldStart),
    start: fieldStart,
  };
}

class SexpParser extends Parser {
  createParse(input) {
    return {
      parsedPos: 0,
      stoppedAt: null,
      advance() {
        const src = input.read(0, input.length);
        this.parsedPos = input.length;
        return parseSexp(src);
      },
      stopAt(pos) {
        this.stoppedAt = pos;
      },
    };
  }
}

export const sexpParser = new SexpParser();
export { nodeSet as sexpNodeSet };

const sexpFacet = defineLanguageFacet({
  commentTokens: { line: ";" },
});

export const sexpLanguage = new Language(
  sexpFacet,
  sexpParser,
  [],
  "tree-sitter-query",
);

export function sexpLanguageSupport() {
  return new LanguageSupport(sexpLanguage);
}

// HighlightStyle with explicit class names so styles.css can target
// them directly. @codemirror/language's defaultHighlightStyle emits
// inline CSS instead of stable classes, which defeats theming.
export const sexpHighlightStyle = HighlightStyle.define([
  { tag: t.typeName, class: "tok-typeName" },
  { tag: t.propertyName, class: "tok-propertyName" },
  { tag: t.invalid, class: "tok-invalid" },
  { tag: t.variableName, class: "tok-variableName" },
  { tag: t.meta, class: "tok-meta" },
  { tag: t.operator, class: "tok-operator" },
  { tag: t.paren, class: "tok-paren" },
  { tag: t.punctuation, class: "tok-punctuation" },
  { tag: t.lineComment, class: "tok-lineComment" },
  { tag: t.string, class: "tok-string" },
]);

export function sexpExtensions() {
  return [sexpLanguageSupport(), syntaxHighlighting(sexpHighlightStyle)];
}
