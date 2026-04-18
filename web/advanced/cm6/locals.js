// Locals highlight-refs: when the caret is on an identifier captured
// by locals.scm (as @local.definition, @local.reference, or a name
// node inside @local.scope), highlight every other occurrence of the
// same textual name across the document.
//
// This is the pragmatic compromise called out in the Phase 4 plan:
// locals.scm's scope hierarchy (nested @local.scope anchors) is
// *not* honoured — we intentionally text-match across the whole
// document. Real shadowing semantics demand the symbol-class stack
// that tree-sitter's locals grammar can't express (noted in
// locals.scm's header comment); that layer belongs in fasmg_lsp,
// not here.
//
// The map of name -> ranges is computed once per parse in main.js
// and pushed in via setLocalsMapEffect. The ViewPlugin watches both
// the map field and the selection, so moving the caret within the
// same document re-decorates without re-parsing.

import { StateEffect, StateField } from "@codemirror/state";
import { ViewPlugin, Decoration } from "@codemirror/view";

export const setLocalsMapEffect = StateEffect.define();

// Value shape: Map<string, Array<{ from: number, to: number }>>.
export const localsMapField = StateField.define({
  create: () => new Map(),
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setLocalsMapEffect)) return effect.value;
    }
    return value;
  },
});

export function localsHighlight() {
  return ViewPlugin.fromClass(
    class {
      decorations = Decoration.none;

      constructor(view) {
        this.decorations = this.compute(view.state);
      }

      update(update) {
        const mapChanged =
          update.startState.field(localsMapField, false) !==
          update.state.field(localsMapField, false);
        if (update.selectionSet || mapChanged || update.docChanged) {
          this.decorations = this.compute(update.state);
        }
      }

      compute(state) {
        const map = state.field(localsMapField, false);
        if (!map || map.size === 0) return Decoration.none;

        const pos = state.selection.main.head;
        const activeName = findNameAtPos(map, pos);
        if (!activeName) return Decoration.none;

        const ranges = map.get(activeName) ?? [];
        if (ranges.length <= 1) return Decoration.none;

        const decorations = [];
        for (const range of ranges) {
          if (range.to <= range.from) continue;
          decorations.push(
            Decoration.mark({ class: "tok-local-ref" }).range(
              range.from,
              range.to,
            ),
          );
        }
        return Decoration.set(decorations, true);
      }
    },
    { decorations: (v) => v.decorations },
  );
}

function findNameAtPos(map, pos) {
  for (const [name, ranges] of map) {
    for (const range of ranges) {
      if (range.from <= pos && pos <= range.to) return name;
    }
  }
  return null;
}

// Build the name -> ranges map from a tree-sitter tree by running the
// `locals.scm` query. Collapses @local.definition and @local.reference
// captures into a single index keyed on source text. Any identifiers
// nested inside @local.scope that are also captured as definition /
// reference get indexed naturally.
export function buildLocalsMap({ TreeSitter, tsLanguage, tsTree, queryText, source }) {
  const map = new Map();
  if (!TreeSitter || !tsLanguage || !tsTree || !queryText) return map;

  let query;
  try {
    query = new TreeSitter.Query(tsLanguage, queryText);
  } catch {
    return map;
  }

  try {
    const captures = query.captures(tsTree.rootNode);
    for (const capture of captures) {
      if (
        capture.name !== "local.definition" &&
        capture.name !== "local.reference"
      ) {
        continue;
      }
      const node = capture.node;
      if (node.startIndex === node.endIndex) continue;
      const text = source.slice(node.startIndex, node.endIndex);
      if (!text) continue;
      let list = map.get(text);
      if (!list) {
        list = [];
        map.set(text, list);
      }
      list.push({ from: node.startIndex, to: node.endIndex });
    }
  } finally {
    query.delete?.();
  }

  return map;
}
