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
import { codeFolding, foldGutter, foldKeymap } from "@codemirror/language";

import { inspectFasmgSource, loadFasmgQueries } from "./../shared/fasmg-web.js";

import {
  fasmgCapturesField,
  fasmgHighlight,
  setFasmgCapturesEffect,
} from "./cm6/highlight.js";
import {
  fasmgLanguageSupport,
  fasmgTsRuntime,
  initFasmgLanguage,
  parseFasmgSource,
} from "./cm6/language.js";
import { applyFasmgDiagnostics, fasmgLintGutter } from "./cm6/diagnostics.js";
import {
  buildLocalsMap,
  localsHighlight,
  localsMapField,
  setLocalsMapEffect,
} from "./cm6/locals.js";
import { sexpExtensions } from "./cm6/sexp-language.js";
import {
  buildTreeString,
  findSpanBySource,
  findSpanByTree,
} from "./cm6/tree-string.js";
import { loadSample, loadSampleManifest } from "./samples.js";
import { loadFailuresTsv, parseFailuresTsv } from "./baseline.js";

const STORAGE_KEYS = {
  editorTab: "fasmg-advanced-editor-tab",
  outputTab: "fasmg-advanced-output-tab",
  split: "fasmg-advanced-split-v1",
  source: "fasmg-advanced-source-v1",
  query: "fasmg-advanced-query-v1",
  adhoc: "fasmg-advanced-adhoc-v1",
};

const OUTPUT_CAPTIONS = {
  "output-tree-panel": "Tree — click to select source; source cursor selects here",
  "output-captures-panel": "Highlight-query captures and matched source ranges",
  "output-diagnostics-panel": "Syntax recovery nodes and query diagnostics",
  "output-adhoc-panel": "Ad-hoc query captures — independent of source decorations",
  "output-baseline-panel": "Corpus baseline failures from baseline/failures.tsv",
  "output-runtime-panel": "Runtime loader and workspace status",
};

const EDITOR_CAPTIONS = {
  "editor-source-panel": "fasmg source — live highlighting + lint + click-sync",
  "editor-query-panel": "highlight query — edits retarget source decorations",
  "editor-adhoc-panel":
    "ad-hoc tree-sitter query — live captures, no source decoration",
};

const DEFAULT_ADHOC = `; Ad-hoc tree-sitter query — runs against the current source tree.
; Edits here do NOT affect source highlighting; see the Ad-hoc captures
; panel on the right for live matches.

[
  (macro_definition)
  (calminstruction_definition)
  (label_definition)
] @definition

(parameter
  name: (symbol_name) @param)
`;

const DEFAULT_SOURCE = `; fasmg source — edit freely to watch the tree-sitter grammar light it up.
; Move the caret through this buffer to see the Tree panel track along.

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
  adhocHost: document.querySelector("#adhoc-editor"),
  adhocStatus: document.querySelector("#adhoc-status"),
  adhocCaptures: document.querySelector("#adhoc-captures-output"),
  treeHost: document.querySelector("#tree-editor"),
  samplesSelect: document.querySelector("#samples-select"),
  baselineOutput: document.querySelector("#baseline-output"),
};

let sourceView = null;
let queryView = null;
let adhocView = null;
let treeView = null;
let defaultQueryText = "";
let localsQueryText = "";
let lastTreeString = "";
let treeSpans = [];
let sampleEntries = [];
let baselineLoaded = false;

// Re-entrance guards for cross-editor selection sync.
let syncing = false;

// Parse pipeline: token-discards stale results, scheduler coalesces
// back-to-back doc/query updates into a single pass.
let parseToken = 0;
let parseScheduled = false;

bootstrap().catch((error) => {
  console.error("advanced playground bootstrap failed:", error);
  setRuntimeStatus("error", `Runtime error: ${error.message}`);
  elements.runtimeLog.textContent = String(error.stack || error);
});

async function bootstrap() {
  setRuntimeStatus("loading", "Loading grammar + queries…");
  const [queries] = await Promise.all([loadFasmgQueries(), initFasmgLanguage()]);
  defaultQueryText = queries.highlightQuery;
  localsQueryText = queries.localsQuery;

  restoreTabs();
  restoreSplit();
  bindTabs();
  bindSplitter();
  bindResetQuery();
  bindSamplesSelect();
  void populateSamples();

  const storedSource = readStorage(STORAGE_KEYS.source);
  const storedQuery = readStorage(STORAGE_KEYS.query);
  const storedAdhoc = readStorage(STORAGE_KEYS.adhoc);
  const initialSource = storedSource ?? DEFAULT_SOURCE;
  const initialQuery = storedQuery ?? defaultQueryText;
  const initialAdhoc = storedAdhoc ?? DEFAULT_ADHOC;

  mountSource(initialSource);
  mountQuery(initialQuery);
  mountAdhoc(initialAdhoc);
  mountTree();

  setRuntimeStatus("ready", "Runtime ready");
  elements.runtimeLog.textContent =
    "Grammar WASM, queries, and Lezer NodeSet loaded. Edits drive a single " +
    "parse pass that feeds decorations, lint markers, Tree panel, captures, " +
    "and click-sync.";

  scheduleParse();
}

function mountSource(initialSource) {
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
        fasmgLanguageSupport(),
        codeFolding(),
        foldGutter(),
        keymap.of(foldKeymap),
        fasmgCapturesField,
        fasmgHighlight(),
        localsMapField,
        localsHighlight(),
        fasmgLintGutter(),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            writeStorage(STORAGE_KEYS.source, update.state.doc.toString());
            scheduleParse();
          }
          if (!syncing && update.selectionSet) {
            syncFromSourceSelection(update.state.selection.main.head);
          }
        }),
        EditorView.theme({ "&": { height: "100%" } }),
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
          writeStorage(STORAGE_KEYS.query, update.state.doc.toString());
          scheduleParse();
        }),
        EditorView.theme({ "&": { height: "100%" } }),
      ],
    }),
  });
}

function mountAdhoc(initialAdhoc) {
  elements.adhocHost.innerHTML = "";
  adhocView = new EditorView({
    parent: elements.adhocHost,
    state: EditorState.create({
      doc: initialAdhoc,
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
          writeStorage(STORAGE_KEYS.adhoc, update.state.doc.toString());
          scheduleParse();
        }),
        EditorView.theme({ "&": { height: "100%" } }),
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
        EditorView.updateListener.of((update) => {
          if (!syncing && update.selectionSet) {
            syncFromTreeSelection(update.state.selection.main.head);
          }
        }),
        EditorView.theme({ "&": { height: "100%" } }),
      ],
    }),
  });
}

function scheduleParse() {
  if (parseScheduled) return;
  parseScheduled = true;
  queueMicrotask(() => {
    parseScheduled = false;
    runParse();
  });
}

async function runParse() {
  if (!sourceView) return;
  const token = ++parseToken;
  const source = sourceView.state.doc.toString();
  const queryText =
    queryView && queryView.state.doc.length > 0
      ? queryView.state.doc.toString()
      : defaultQueryText;

  try {
    const result = await inspectFasmgSource(source, { queryText });
    if (token !== parseToken) return;

    const { treeBuild, localsMap } = computeFromTree(source);

    sourceView.dispatch({
      effects: [
        setFasmgCapturesEffect.of(result.captures),
        setLocalsMapEffect.of(localsMap),
      ],
    });

    if (treeView && treeBuild.text !== lastTreeString) {
      lastTreeString = treeBuild.text;
      treeView.dispatch({
        changes: {
          from: 0,
          to: treeView.state.doc.length,
          insert: treeBuild.text,
        },
      });
    }
    treeSpans = treeBuild.spans;

    applyFasmgDiagnostics(sourceView, result.diagnostics);
    updateStatus(result);
    renderClasses(result.classesUsed);
    renderCaptures(result.captures);
    renderDiagnostics(result.diagnostics);
    runAdhocQuery(source);
  } catch (error) {
    if (token !== parseToken) return;
    console.error("parse pipeline error:", error);
    setRuntimeStatus("error", `Runtime error: ${error.message}`);
    elements.runtimeLog.textContent = String(error.stack || error);
  }
}

function runAdhocQuery(source) {
  if (!adhocView) return;
  const queryText = adhocView.state.doc.toString().trim();
  if (!queryText) {
    renderAdhocStatus("idle", "Ad-hoc query empty — type one on the left.");
    renderAdhocCaptures([]);
    return;
  }

  let runtime;
  try {
    runtime = fasmgTsRuntime();
  } catch {
    return;
  }

  let tsTree = null;
  let query = null;
  try {
    tsTree = parseFasmgSource(source);
    query = new runtime.TreeSitter.Query(runtime.language, queryText);
  } catch (error) {
    renderAdhocStatus(
      "error",
      `Query error: ${error?.message ?? String(error)}`,
    );
    renderAdhocCaptures([]);
    query?.delete?.();
    tsTree?.delete?.();
    return;
  }

  try {
    const raw = query.captures(tsTree.rootNode);
    const captures = raw.map((capture) => ({
      name: capture.name,
      startIndex: capture.node.startIndex,
      endIndex: capture.node.endIndex,
      startPosition: {
        row: capture.node.startPosition.row,
        column: capture.node.startPosition.column,
      },
      endPosition: {
        row: capture.node.endPosition.row,
        column: capture.node.endPosition.column,
      },
      text: source.slice(capture.node.startIndex, capture.node.endIndex),
    }));

    renderAdhocStatus(
      "ok",
      `${captures.length} capture${captures.length === 1 ? "" : "s"}`,
    );
    renderAdhocCaptures(captures);
  } finally {
    query.delete?.();
    tsTree.delete?.();
  }
}

function renderAdhocStatus(kind, message) {
  if (!elements.adhocStatus) return;
  elements.adhocStatus.innerHTML = "";
  const pill = document.createElement("span");
  pill.className = "status-pill";
  pill.dataset.kind = kind;
  pill.textContent = message;
  elements.adhocStatus.append(pill);
}

function renderAdhocCaptures(captures) {
  if (!elements.adhocCaptures) return;
  renderCaptureTable(elements.adhocCaptures, captures, 200);
}

function computeFromTree(source) {
  const empty = {
    treeBuild: { text: "", spans: [] },
    localsMap: new Map(),
  };
  try {
    const runtime = fasmgTsRuntime();
    const tsTree = parseFasmgSource(source);
    try {
      const treeBuild = buildTreeString(tsTree.rootNode);
      const localsMap = buildLocalsMap({
        TreeSitter: runtime.TreeSitter,
        tsLanguage: runtime.language,
        tsTree,
        queryText: localsQueryText,
        source,
      });
      return { treeBuild, localsMap };
    } finally {
      tsTree.delete?.();
    }
  } catch (error) {
    console.warn("computeFromTree failed:", error);
    return empty;
  }
}

// --- click-sync -----------------------------------------------------

function syncFromSourceSelection(pos) {
  if (!treeView || treeSpans.length === 0) return;
  const span = findSpanBySource(treeSpans, pos);
  if (!span) return;
  const { strStart, strEnd } = span;
  if (strEnd > treeView.state.doc.length) return;
  syncing = true;
  try {
    treeView.dispatch({
      selection: { anchor: strStart, head: strEnd },
      scrollIntoView: true,
    });
  } finally {
    syncing = false;
  }
}

function syncFromTreeSelection(pos) {
  if (!sourceView || treeSpans.length === 0) return;
  const span = findSpanByTree(treeSpans, pos);
  if (!span) return;
  const { sourceStart, sourceEnd } = span;
  if (sourceEnd > sourceView.state.doc.length) return;
  syncing = true;
  try {
    sourceView.dispatch({
      selection: { anchor: sourceStart, head: sourceEnd },
      scrollIntoView: true,
    });
  } finally {
    syncing = false;
  }
}

// --- panel rendering ------------------------------------------------

function updateStatus(result) {
  const queryErrors = result.diagnostics.filter((d) => d.kind === "query-error");
  const syntaxIssues = result.diagnostics.filter(
    (d) => d.kind !== "query-error",
  );

  elements.parseTime.textContent = `${result.parseMs.toFixed(1)} ms`;
  elements.captureCount.textContent = String(result.captures.length);
  elements.syntaxStatus.textContent = syntaxIssues.length
    ? `${syntaxIssues.length} issue${syntaxIssues.length === 1 ? "" : "s"}`
    : "Clean";
  elements.queryStatus.textContent = queryErrors.length
    ? `${queryErrors.length} issue${queryErrors.length === 1 ? "" : "s"}`
    : "Ready";

  setRuntimeStatus("ready", "Runtime ready");
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
  renderCaptureTable(elements.capturesOutput, captures, 200);
}

function renderCaptureTable(host, captures, maxCaptures) {
  host.innerHTML = "";

  if (captures.length === 0) {
    host.innerHTML =
      '<p class="status-pill">No captures for the current query.</p>';
    return;
  }

  const summary = document.createElement("p");
  summary.className = "status-pill";
  summary.textContent =
    captures.length > maxCaptures
      ? `Showing the first ${maxCaptures} captures of ${captures.length}.`
      : `${captures.length} capture${captures.length === 1 ? "" : "s"}.`;
  host.append(summary);

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
    row.addEventListener("click", () => {
      if (!sourceView) return;
      sourceView.focus();
      sourceView.dispatch({
        selection: {
          anchor: capture.startIndex,
          head: capture.endIndex,
        },
        scrollIntoView: true,
      });
    });

    tbody.append(row);
  }
  table.append(tbody);
  host.append(table);
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

    item.addEventListener("click", () => {
      if (!sourceView) return;
      const doc = sourceView.state.doc;
      const from = doc.line(
        Math.min(Math.max(1, diagnostic.startPosition.row + 1), doc.lines),
      ).from + diagnostic.startPosition.column;
      sourceView.focus();
      sourceView.dispatch({
        selection: { anchor: from, head: from },
        scrollIntoView: true,
      });
    });

    elements.diagnosticsOutput.append(item);
  }
}

// --- tabs -----------------------------------------------------------

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
    queueMicrotask(() => {
      if (targetId === "editor-source-panel") sourceView?.requestMeasure();
      if (targetId === "editor-query-panel") queryView?.requestMeasure();
      if (targetId === "editor-adhoc-panel") adhocView?.requestMeasure();
    });
  }

  if (group === "output") {
    elements.outputCaption.textContent = OUTPUT_CAPTIONS[targetId];
    writeStorage(STORAGE_KEYS.outputTab, targetId);
    queueMicrotask(() => {
      if (targetId === "output-tree-panel") treeView?.requestMeasure();
      if (targetId === "output-baseline-panel") void ensureBaselineLoaded();
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

// --- splitter -------------------------------------------------------

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

// --- samples dropdown -----------------------------------------------

async function populateSamples() {
  if (!elements.samplesSelect) return;
  try {
    sampleEntries = await loadSampleManifest();
  } catch (error) {
    console.warn("samples manifest failed:", error);
    elements.samplesSelect.disabled = true;
    return;
  }
  for (const [index, entry] of sampleEntries.entries()) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `${entry.source === "remote" ? "⇣ " : ""}${entry.label}`;
    elements.samplesSelect.append(option);
  }
}

function bindSamplesSelect() {
  if (!elements.samplesSelect) return;
  elements.samplesSelect.addEventListener("change", async () => {
    const index = Number(elements.samplesSelect.value);
    const entry = sampleEntries[index];
    if (!entry || !sourceView) return;

    setRuntimeStatus("loading", `Loading ${entry.label}…`);
    try {
      const { text, from, warning } = await loadSample(entry);
      sourceView.dispatch({
        changes: {
          from: 0,
          to: sourceView.state.doc.length,
          insert: text,
        },
      });
      writeStorage(STORAGE_KEYS.source, text);
      const provenance = from === "cache" ? " (cached)" : "";
      setRuntimeStatus("ready", `Loaded ${entry.label}${provenance}`);
      if (warning) {
        elements.runtimeLog.textContent = warning;
      } else {
        elements.runtimeLog.textContent = `Loaded sample from ${from}.`;
      }
    } catch (error) {
      setRuntimeStatus("error", `Sample load failed: ${error.message}`);
      elements.runtimeLog.textContent = String(error.stack || error);
    }
    // reset to placeholder so re-selecting the same entry fires again
    elements.samplesSelect.value = "";
  });
}

// --- baseline browser -----------------------------------------------

async function ensureBaselineLoaded() {
  if (baselineLoaded) return;
  baselineLoaded = true;
  elements.baselineOutput.innerHTML =
    '<p class="status-pill">Loading baseline/failures.tsv…</p>';
  try {
    const text = await loadFailuresTsv();
    const entries = parseFailuresTsv(text);
    renderBaseline(entries);
  } catch (error) {
    elements.baselineOutput.innerHTML = "";
    const warn = document.createElement("p");
    warn.className = "status-pill";
    warn.dataset.kind = "error";
    warn.textContent = `Could not load baseline/failures.tsv: ${error.message}`;
    elements.baselineOutput.append(warn);
  }
}

function renderBaseline(entries) {
  const host = elements.baselineOutput;
  host.innerHTML = "";

  if (entries.length === 0) {
    host.innerHTML =
      '<p class="status-pill">No failures in baseline. Regenerate with scripts/corpus-baseline.sh.</p>';
    return;
  }

  const summary = document.createElement("p");
  summary.className = "status-pill";
  summary.textContent = `${entries.length} corpus file${entries.length === 1 ? "" : "s"} currently fail to parse cleanly.`;
  host.append(summary);

  const table = document.createElement("table");
  table.className = "capture-table baseline-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th scope="col">Path</th>
        <th scope="col">Error</th>
        <th scope="col">Remote</th>
      </tr>
    </thead>
  `;

  const tbody = document.createElement("tbody");
  for (const entry of entries) {
    const row = document.createElement("tr");

    const pathCell = document.createElement("td");
    pathCell.className = "capture-col-text";
    pathCell.textContent = entry.path;
    row.append(pathCell);

    const errorCell = document.createElement("td");
    errorCell.className = "capture-col-range";
    errorCell.textContent = entry.errorStart
      ? `${entry.errorKind} ${entry.errorStart.row + 1}:${entry.errorStart.column + 1} - ${entry.errorEnd.row + 1}:${entry.errorEnd.column + 1}`
      : "—";
    row.append(errorCell);

    const remoteCell = document.createElement("td");
    remoteCell.className = "capture-col-name";
    if (entry.remoteUrl) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "toolbar-button toolbar-button-subtle";
      button.textContent = "Load";
      button.title = entry.remoteUrl;
      button.addEventListener("click", () => loadBaselineRemote(entry));
      remoteCell.append(button);
    } else {
      remoteCell.textContent = "—";
    }
    row.append(remoteCell);

    tbody.append(row);
  }
  table.append(tbody);
  host.append(table);
}

async function loadBaselineRemote(entry) {
  if (!sourceView || !entry.remoteUrl) return;
  setRuntimeStatus("loading", `Fetching ${entry.path}…`);
  try {
    const { text, from, warning } = await loadSample({
      label: entry.path,
      source: "remote",
      url: entry.remoteUrl,
    });
    sourceView.dispatch({
      changes: {
        from: 0,
        to: sourceView.state.doc.length,
        insert: text,
      },
    });
    writeStorage(STORAGE_KEYS.source, text);
    const provenance = from === "cache" ? " (cached)" : "";
    setRuntimeStatus("ready", `Loaded baseline file${provenance}`);
    elements.runtimeLog.textContent = warning
      ? warning
      : `Loaded ${entry.remoteUrl}`;

    if (entry.errorStart) {
      queueMicrotask(() => {
        const doc = sourceView.state.doc;
        const line = doc.line(
          Math.min(Math.max(1, entry.errorStart.row + 1), doc.lines),
        );
        const from = Math.min(line.from + entry.errorStart.column, line.to);
        sourceView.focus();
        sourceView.dispatch({
          selection: { anchor: from, head: from },
          scrollIntoView: true,
        });
      });
    }
  } catch (error) {
    setRuntimeStatus("error", `Remote fetch failed: ${error.message}`);
    elements.runtimeLog.textContent = String(error.stack || error);
  }
}

// --- helpers --------------------------------------------------------

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
