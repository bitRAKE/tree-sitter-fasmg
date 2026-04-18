import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
} from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";

import { initFasmgHighlight, fasmgHighlight } from "./cm6/highlight.js";

const DEFAULT_DOC = `; fasmg source — edit freely to watch the tree-sitter grammar light it up.

include 'format/format.inc'

use32

calminstruction label? name*, origin:-1
  check origin = -1
  jyes default
  asm name = origin
  exit
default:
  asm name := $
end calminstruction

macro alignx boundary
  rb (boundary - 1) and -$ + $
end macro

start:
  mov     eax, 1
  xor     ebx, ebx
  int     0x80
  alignx  16
`;

const statusEl = document.getElementById("status");

function setStatus(kind, message) {
  statusEl.dataset.kind = kind;
  statusEl.textContent = message;
}

async function main() {
  setStatus("loading", "Loading grammar runtime…");
  await initFasmgHighlight();
  setStatus("ready", "Runtime ready. Edit to re-parse live.");

  const parent = document.getElementById("editor");
  parent.innerHTML = "";

  new EditorView({
    parent,
    state: EditorState.create({
      doc: DEFAULT_DOC,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        fasmgHighlight(),
        EditorView.theme({
          "&": { height: "100%" },
          ".cm-scroller": { fontFamily: '"IBM Plex Mono", Consolas, monospace' },
        }),
      ],
    }),
  });
}

main().catch((err) => {
  console.error("advanced playground failed:", err);
  setStatus("error", `Runtime error: ${err.message}`);
});
