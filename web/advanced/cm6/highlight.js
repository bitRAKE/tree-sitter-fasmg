// Reactive fasmg highlighting for CodeMirror 6.
//
// The plugin owns the live parse cycle: on every source change, or on
// every query change (propagated via StateEffect into a StateField on
// the source editor's state), it calls `inspectFasmgSource` from
// web/shared/fasmg-web.js, derives CM6 Decorations from the captures,
// and fans out the full parse result (tree string, captures,
// diagnostics, classes used, parse time) via an onParse callback so
// sibling panels — Tree, Captures table, Diagnostics list, Classes
// bar, status pills — can re-render without re-parsing.
//
// The async cycle uses a token so late-arriving parses from
// superseded edits don't clobber the decorations. A trailing
// `view.dispatch({})` triggers CM6 to re-read the decorations getter
// after the async result lands.

import { StateEffect, StateField } from "@codemirror/state";
import { ViewPlugin, Decoration } from "@codemirror/view";

import {
  inspectFasmgSource,
  loadFasmgQueries,
} from "../../shared/fasmg-web.js";

export const setFasmgQueryEffect = StateEffect.define();

export const fasmgQueryField = StateField.define({
  create: () => "",
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setFasmgQueryEffect)) return effect.value;
    }
    return value;
  },
});

let defaultQueriesPromise = null;

export function loadDefaultFasmgQueries() {
  if (!defaultQueriesPromise) {
    defaultQueriesPromise = loadFasmgQueries();
  }
  return defaultQueriesPromise;
}

export function fasmgHighlight({ onParse } = {}) {
  return ViewPlugin.fromClass(
    class {
      decorations = Decoration.none;
      token = 0;

      constructor(view) {
        this.view = view;
        this.reparse();
      }

      update(update) {
        const oldQuery = update.startState.field(fasmgQueryField, false);
        const newQuery = update.state.field(fasmgQueryField, false);
        const queryChanged = oldQuery !== newQuery;
        const docChanged = update.docChanged;

        if (docChanged || queryChanged) {
          this.reparse();
        }
      }

      async reparse() {
        const token = ++this.token;
        const source = this.view.state.doc.toString();
        const queryText = this.view.state.field(fasmgQueryField, false) || "";

        try {
          const options = queryText ? { queryText } : {};
          const result = await inspectFasmgSource(source, options);
          if (token !== this.token) return;

          this.decorations = buildDecorations(result.captures);
          onParse?.({ ok: true, ...result, queryText });
        } catch (error) {
          if (token !== this.token) return;
          this.decorations = Decoration.none;
          onParse?.({ ok: false, error });
        }

        this.view.dispatch({});
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  );
}

function buildDecorations(captures) {
  const ranges = [];
  for (const capture of captures) {
    if (capture.startIndex === capture.endIndex) continue;
    ranges.push(
      Decoration.mark({ class: captureToClass(capture.name) }).range(
        capture.startIndex,
        capture.endIndex,
      ),
    );
  }
  return Decoration.set(ranges, true);
}

function captureToClass(name) {
  const parts = name.split(".");
  const classes = [];
  for (let i = 1; i <= parts.length; i += 1) {
    classes.push(`tok-${parts.slice(0, i).join("-")}`);
  }
  return classes.join(" ");
}
