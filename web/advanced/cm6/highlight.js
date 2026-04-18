// Passive decoration renderer for fasmg source.
//
// Phase 3 pulls the parse orchestration up into main.js, which drives a
// single parse cycle per edit and fans results out to every surface.
// This module is now just the CM6 plumbing: a StateField holds the
// current captures array, a ViewPlugin reads it and emits
// Decoration.mark ranges. main.js dispatches `setFasmgCapturesEffect`
// after each parse to refresh the field.
//
// Capture names map to classes by cumulative dotted split:
//   @keyword.directive -> "tok-keyword tok-keyword-directive"
// so CSS can target the umbrella or the variant without duplication.

import { StateEffect, StateField } from "@codemirror/state";
import { ViewPlugin, Decoration } from "@codemirror/view";

export const setFasmgCapturesEffect = StateEffect.define();

export const fasmgCapturesField = StateField.define({
  create: () => [],
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setFasmgCapturesEffect)) return effect.value;
    }
    return value;
  },
});

export function fasmgHighlight() {
  return ViewPlugin.fromClass(
    class {
      decorations = Decoration.none;

      constructor(view) {
        this.decorations = buildDecorations(
          view.state.field(fasmgCapturesField, false) ?? [],
        );
      }

      update(update) {
        const oldCaptures =
          update.startState.field(fasmgCapturesField, false) ?? [];
        const newCaptures =
          update.state.field(fasmgCapturesField, false) ?? [];
        if (oldCaptures !== newCaptures) {
          this.decorations = buildDecorations(newCaptures);
        }
      }
    },
    { decorations: (v) => v.decorations },
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
