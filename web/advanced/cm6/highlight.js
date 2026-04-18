// Live fasmg highlighting for CodeMirror 6.
//
// Phase 1 takes the pragmatic route: a ViewPlugin owns a tree-sitter parser
// and the compiled highlights.scm query, re-parses on every document change,
// and emits CM6 Decorations whose classes are derived from the capture names.
// We deliberately do *not* plug into CM6's Language/syntaxTree pipeline here
// — that comes in Phase 3 alongside folds/locals/click-sync, where having a
// real Lezer tree pays off. The double-parse cost (tree-sitter here, Lezer
// nothing in Phase 1) is well under a millisecond for typical fasmg files.
//
// Capture names map to classes by splitting on `.`:
//   @keyword.directive  ->  "tok-keyword tok-keyword-directive"
// The cumulative emission lets CSS target the umbrella (.tok-keyword) or the
// specific variant (.tok-keyword-directive) without duplicating rules.

import { ViewPlugin, Decoration } from "@codemirror/view";

import {
  loadFasmgLanguage,
  loadFasmgQueries,
} from "../../shared/fasmg-web.js";

const TreeSitterPromise = import(
  "https://tree-sitter.github.io/web-tree-sitter.js"
);

let tsParser = null;
let tsQuery = null;
let runtimePromise = null;

export function initFasmgHighlight() {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const TreeSitter = await TreeSitterPromise;
      await TreeSitter.Parser.init();
      const tsLanguage = await loadFasmgLanguage();
      const { highlightQuery } = await loadFasmgQueries();
      tsParser = new TreeSitter.Parser();
      tsParser.setLanguage(tsLanguage);
      tsQuery = new TreeSitter.Query(tsLanguage, highlightQuery);
    })();
  }
  return runtimePromise;
}

export function fasmgHighlight() {
  return ViewPlugin.fromClass(FasmgHighlightPlugin, {
    decorations: (plugin) => plugin.decorations,
  });
}

class FasmgHighlightPlugin {
  constructor(view) {
    this.view = view;
    this.tsTree = null;
    this.decorations = Decoration.none;
    this.reparse();
  }

  update(update) {
    if (update.docChanged) {
      this.reparse();
    }
  }

  destroy() {
    this.tsTree?.delete?.();
    this.tsTree = null;
  }

  reparse() {
    if (!tsParser || !tsQuery) {
      return;
    }
    const source = this.view.state.doc.toString();
    this.tsTree?.delete?.();
    this.tsTree = tsParser.parse(source);
    this.decorations = this.buildDecorations();
  }

  buildDecorations() {
    const captures = tsQuery.captures(this.tsTree.rootNode);
    const ranges = [];
    for (const capture of captures) {
      const start = capture.node.startIndex;
      const end = capture.node.endIndex;
      if (start === end) {
        continue;
      }
      ranges.push(
        Decoration.mark({ class: captureToClass(capture.name) }).range(
          start,
          end,
        ),
      );
    }
    return Decoration.set(ranges, true);
  }
}

function captureToClass(name) {
  const parts = name.split(".");
  const classes = [];
  for (let i = 1; i <= parts.length; i += 1) {
    classes.push(`tok-${parts.slice(0, i).join("-")}`);
  }
  return classes.join(" ");
}
