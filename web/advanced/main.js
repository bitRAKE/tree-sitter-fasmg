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

import {
  fasmgHighlight,
  fasmgQueryField,
  setFasmgQueryEffect,
  loadDefaultFasmgQueries,
} from "./cm6/highlight.js";
import { sexpExtensions } from "./cm6/sexp-language.js";

const STORAGE_KEYS = {
  editorTab: "fasmg-advanced-editor-tab",
  outputTab: "fasmg-advanced-output-tab",
  split: "fasmg-advanced-split-v1",
  source: "fasmg-advanced-source-v1",
  query: "fasmg-advanced-query-v1",
};

const OUTPUT_CAPTIONS = {
  "output-tree-panel": "Concrete syntax tree from the browser-side parser",
  "output-captures-panel": "Query captures and matched source ranges",
  "output-diagnostics-panel": "Syntax recovery nodes and query diagnostics",
  "output-runtime-panel": "Runtime loader and workspace status",
};

const EDITOR_CAPTIONS = {
  "editor-source-panel": "fasmg source — live highlighting",
  "editor-query-panel": "highlight query — edits retarget source decorations",
};

const DEFAULT_SOURCE = `; fasmg source — edit freely to watch the tree-sitter grammar light it up.

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

const elements = {
  appShell: document.querySelector(".app-shell"),
  resetQuery: document.querySelector("#reset-query"),
  parseTime: document.querySelector("#parse-time"),
  captureCount: document.querySelector("#capture-count"),
  syntaxStatus: document.querySelector("#syntax-status"),
  queryStatus: document.querySelector("#query-status"),
  runtimeStatus: document.querySelector("#runtime-status"),
  capturesOutput: document.querySelector("#captures-output"),
  diagnosticsOutput: document.querySelector("#diagnostics-output"),
  classesOutput: document.querySelector("#classes-output"),
  runtimeLog: document.querySelector("#runtime-log"),
  editorCaption: document.querySelector("#editor-caption"),
  outputCaption: document.querySelector("#output-caption"),
  splitter: document.querySelector("#workspace-splitter"),
  sourceHost: document.querySelector("#source-editor"),
  queryHost: document.querySelector("#query-editor"),
  treeHost: document.querySelector("#tree-editor"),
};

let sourceView = null;
let queryView = null;
let treeView = null;
let defaultQueryText = "";
let lastTreeString = "";

bootstrap().catch((error) => {
  console.error("advanced playground bootstrap failed:", error);
  setRuntimeStatus("error", `Runtime error: ${error.message}`);
  elements.runtimeLog.textContent = String(error.stack || error);
});

async function bootstrap() {
  setRuntimeStatus("loading", "Loading grammar + queries…");
  const queries = await loadDefaultFasmgQueries();
  defaultQueryText = queries.highlightQuery;

  restoreTabs();
  restoreSplit();
  bindTabs();
  bindSplitter();
  bindResetQuery();

  const storedSource = readStorage(STORAGE_KEYS.source);
  const storedQuery = readStorage(STORAGE_KEYS.query);
  const initialSource = storedSource ?? DEFAULT_SOURCE;
  const initialQuery = storedQuery ?? defaultQueryText;

  mountSource(initialSource, initialQuery);
  mountQuery(initialQuery);
  mountTree();

  setRuntimeStatus("ready", "Runtime ready");
  elements.runtimeLog.textContent =
    "Grammar WASM and queries loaded. Edit source or query to see live updates.";
}

function mountSource(initialSource, initialQuery) {
  elements.sourceHost.innerHTML = "";
  sourceView = new EditorView({
    parent: elements.sourceHost,
    state: EditorState.create({
      doc: initialSource,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        fasmgQueryField.init(() => initialQuery),
        fasmgHighlight({ onParse: handleParseResult }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            writeStorage(STORAGE_KEYS.source, update.state.doc.toString());
          }
        }),
        EditorView.theme({
          "&": { height: "100%" },
        }),
      ],
    }),
  });
}

function mountQuery(initialQuery) {
  elements.queryHost.innerHTML = "";
  queryView = new EditorView({
    parent: elements.queryHost,
    state: EditorState.create({
      doc: initialQuery,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        ...sexpExtensions(),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          const text = update.state.doc.toString();
          writeStorage(STORAGE_KEYS.query, text);
          sourceView?.dispatch({ effects: setFasmgQueryEffect.of(text) });
        }),
        EditorView.theme({
          "&": { height: "100%" },
        }),
      ],
    }),
  });
}

function mountTree() {
  elements.treeHost.innerHTML = "";
  treeView = new EditorView({
    parent: elements.treeHost,
    state: EditorState.create({
      doc: "",
      extensions: [
        EditorState.readOnly.of(true),
        lineNumbers(),
        drawSelection(),
        ...sexpExtensions(),
        EditorView.theme({
          "&": { height: "100%" },
        }),
      ],
    }),
  });
}

function handleParseResult(result) {
  if (!result.ok) {
    elements.syntaxStatus.textContent = "Unavailable";
    elements.queryStatus.textContent = "Unavailable";
    elements.parseTime.textContent = "n/a";
    elements.captureCount.textContent = "0";
    elements.runtimeLog.textContent = `Runtime error: ${result.error?.message ?? result.error}`;
    setRuntimeStatus("error", "Runtime error");
    return;
  }

  const {
    captures,
    diagnostics,
    classesUsed,
    parseMs,
    treeString,
  } = result;

  const queryErrors = diagnostics.filter((d) => d.kind === "query-error");
  const syntaxIssues = diagnostics.filter((d) => d.kind !== "query-error");

  elements.parseTime.textContent = `${parseMs.toFixed(1)} ms`;
  elements.captureCount.textContent = String(captures.length);
  elements.syntaxStatus.textContent = syntaxIssues.length
    ? `${syntaxIssues.length} issue${syntaxIssues.length === 1 ? "" : "s"}`
    : "Clean";
  elements.queryStatus.textContent = queryErrors.length
    ? `${queryErrors.length} issue${queryErrors.length === 1 ? "" : "s"}`
    : "Ready";

  setRuntimeStatus("ready", "Runtime ready");

  if (treeString !== lastTreeString) {
    lastTreeString = treeString;
    if (treeView) {
      treeView.dispatch({
        changes: {
          from: 0,
          to: treeView.state.doc.length,
          insert: treeString,
        },
      });
    }
  }

  renderClasses(classesUsed);
  renderCaptures(captures);
  renderDiagnostics(diagnostics);
}

function renderClasses(classesUsed) {
  elements.classesOutput.innerHTML = "";
  if (classesUsed.length === 0) {
    const empty = document.createElement("span");
    empty.className = "status-pill";
    empty.textContent = "No active classes";
    elements.classesOutput.append(empty);
    return;
  }
  for (const className of classesUsed) {
    const pill = document.createElement("span");
    pill.className = "class-pill";
    pill.textContent = className;
    elements.classesOutput.append(pill);
  }
}

function renderCaptures(captures) {
  const maxCaptures = 200;
  elements.capturesOutput.innerHTML = "";

  if (captures.length === 0) {
    elements.capturesOutput.innerHTML =
      '<p class="status-pill">No captures for the current query.</p>';
    return;
  }

  const summary = document.createElement("p");
  summary.className = "status-pill";
  summary.textContent =
    captures.length > maxCaptures
      ? `Showing the first ${maxCaptures} captures of ${captures.length}.`
      : `${captures.length} capture${captures.length === 1 ? "" : "s"}.`;
  elements.capturesOutput.append(summary);

  const table = document.createElement("table");
  table.className = "capture-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th scope="col">Capture</th>
        <th scope="col">Range</th>
        <th scope="col">Text</th>
      </tr>
    </thead>
  `;

  const tbody = document.createElement("tbody");
  for (const capture of captures.slice(0, maxCaptures)) {
    const row = document.createElement("tr");

    const name = document.createElement("td");
    name.className = "capture-col-name";
    name.textContent = capture.name;

    const range = document.createElement("td");
    range.className = "capture-col-range";
    range.textContent =
      `${capture.startPosition.row + 1}:${capture.startPosition.column + 1}` +
      ` - ${capture.endPosition.row + 1}:${capture.endPosition.column + 1}`;

    const snippet = document.createElement("td");
    snippet.className = "capture-col-text";
    snippet.textContent = capture.text || "(empty)";

    row.append(name, range, snippet);
    tbody.append(row);
  }
  table.append(tbody);
  elements.capturesOutput.append(table);
}

function renderDiagnostics(diagnostics) {
  elements.diagnosticsOutput.innerHTML = "";
  if (diagnostics.length === 0) {
    elements.diagnosticsOutput.innerHTML =
      '<li class="diagnostic-item ok">No syntax or query diagnostics.</li>';
    return;
  }
  for (const diagnostic of diagnostics) {
    const item = document.createElement("li");
    item.className = `diagnostic-item ${diagnostic.kind}`;

    const title = document.createElement("div");
    title.className = "diagnostic-title";
    title.textContent =
      `${diagnostic.kind.toUpperCase()} ${diagnostic.startPosition.row + 1}:` +
      `${diagnostic.startPosition.column + 1}`;

    const message = document.createElement("div");
    message.className = "diagnostic-message";
    message.textContent = diagnostic.message;

    const context = document.createElement("pre");
    context.className = "diagnostic-context";
    context.textContent = diagnostic.lineText || "";

    item.append(title, message, context);
    elements.diagnosticsOutput.append(item);
  }
}

// --- tabs ------------------------------------------------------------

function bindTabs() {
  for (const button of document.querySelectorAll(
    "[data-tab-group][data-tab-target]",
  )) {
    button.addEventListener("click", () =>
      activateTab(button.dataset.tabGroup, button.dataset.tabTarget),
    );
  }
}

function activateTab(group, targetId) {
  const buttons = document.querySelectorAll(`[data-tab-group="${group}"]`);
  for (const button of buttons) {
    const active = button.dataset.tabTarget === targetId;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));

    const panel = document.getElementById(button.dataset.tabTarget);
    panel.classList.toggle("is-active", active);
    panel.hidden = !active;
  }

  if (group === "editor") {
    elements.editorCaption.textContent = EDITOR_CAPTIONS[targetId];
    writeStorage(STORAGE_KEYS.editorTab, targetId);
    // Refresh CM6 layout after tab flip (editor was in a hidden panel).
    queueMicrotask(() => {
      if (targetId === "editor-source-panel") sourceView?.requestMeasure();
      if (targetId === "editor-query-panel") queryView?.requestMeasure();
    });
  }

  if (group === "output") {
    elements.outputCaption.textContent = OUTPUT_CAPTIONS[targetId];
    writeStorage(STORAGE_KEYS.outputTab, targetId);
    queueMicrotask(() => {
      if (targetId === "output-tree-panel") treeView?.requestMeasure();
    });
  }
}

function restoreTabs() {
  const editorTarget =
    readStorage(STORAGE_KEYS.editorTab) || "editor-source-panel";
  const outputTarget =
    readStorage(STORAGE_KEYS.outputTab) || "output-tree-panel";
  activateTab("editor", editorTarget);
  activateTab("output", outputTarget);
}

// --- splitter --------------------------------------------------------

function bindSplitter() {
  if (!elements.splitter) return;
  let dragging = false;

  const onMove = (event) => {
    if (!dragging || window.innerWidth <= 1100) return;
    const rect = elements.appShell.getBoundingClientRect();
    const relativeX = event.clientX - rect.left;
    const percent = (relativeX / rect.width) * 100;
    const clamped = clamp(percent, 28, 72);
    document.documentElement.style.setProperty("--split", `${clamped}%`);
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    elements.splitter.classList.remove("is-dragging");
    writeStorage(
      STORAGE_KEYS.split,
      getComputedStyle(document.documentElement)
        .getPropertyValue("--split")
        .trim(),
    );
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };

  elements.splitter.addEventListener("pointerdown", (event) => {
    if (window.innerWidth <= 1100) return;
    dragging = true;
    elements.splitter.classList.add("is-dragging");
    elements.splitter.setPointerCapture?.(event.pointerId);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
}

function restoreSplit() {
  const saved = readStorage(STORAGE_KEYS.split);
  if (saved) {
    document.documentElement.style.setProperty("--split", saved);
  }
}

// --- reset query ----------------------------------------------------

function bindResetQuery() {
  elements.resetQuery.addEventListener("click", () => {
    if (!queryView) return;
    queryView.dispatch({
      changes: {
        from: 0,
        to: queryView.state.doc.length,
        insert: defaultQueryText,
      },
    });
  });
}

// --- status + storage helpers --------------------------------------

function setRuntimeStatus(kind, message) {
  elements.runtimeStatus.dataset.kind = kind;
  elements.runtimeStatus.textContent = message;
}

function readStorage(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // best-effort
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
