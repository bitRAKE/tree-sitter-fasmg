import { inspectFasmgSource, loadFasmgQueries } from "./fasmg-web.js";

const FIXTURES = [
  {
    label: "Real Script Forms",
    path: "../../test/fixtures/pass/real_script_forms.l4gs.g",
  },
  {
    label: "CALM Instruction",
    path: "../../test/fixtures/pass/calminstruction.l4gs.g",
  },
  {
    label: "Symbol Stacking",
    path: "../../test/fixtures/pass/symbol_stacking.l4gs.g",
  },
  {
    label: "Unterminated Macro",
    path: "../../test/fixtures/fail/unterminated_macro.l4gs.g",
  },
];

const STORAGE_KEYS = {
  editorTab: "fasmg-playground-editor-tab",
  outputTab: "fasmg-playground-output-tab",
  split: "fasmg-playground-split-v1",
};

const OUTPUT_CAPTIONS = {
  "output-preview-panel": "HTML preview generated from the active query",
  "output-tree-panel": "Concrete syntax tree from the browser-side parser",
  "output-captures-panel": "Query captures and matched source ranges",
  "output-diagnostics-panel": "Syntax recovery nodes and query diagnostics",
  "output-runtime-panel": "Runtime loader and workspace status",
};

const EDITOR_CAPTIONS = {
  "editor-source-panel": "fasmg source editor",
  "editor-query-panel": "highlight query editor",
};

const elements = {
  appShell: document.querySelector(".app-shell"),
  fixtureSelect: document.querySelector("#fixture-select"),
  loadFixture: document.querySelector("#load-fixture"),
  resetQuery: document.querySelector("#reset-query"),
  helpToggle: document.querySelector("#help-toggle"),
  helpClose: document.querySelector("#help-close"),
  helpPanel: document.querySelector("#help-panel"),
  sourceInput: document.querySelector("#source-input"),
  queryInput: document.querySelector("#query-input"),
  previewOutput: document.querySelector("#preview-output"),
  treeOutput: document.querySelector("#tree-output"),
  capturesOutput: document.querySelector("#captures-output"),
  diagnosticsOutput: document.querySelector("#diagnostics-output"),
  parseTime: document.querySelector("#parse-time"),
  captureCount: document.querySelector("#capture-count"),
  syntaxStatus: document.querySelector("#syntax-status"),
  queryStatus: document.querySelector("#query-status"),
  classesOutput: document.querySelector("#classes-output"),
  emptyState: document.querySelector("#empty-state"),
  editorCaption: document.querySelector("#editor-caption"),
  outputCaption: document.querySelector("#output-caption"),
  splitter: document.querySelector("#workspace-splitter"),
};

let defaultQueries;
let renderToken = 0;

bootstrap().catch((error) => {
  setRuntimeMessage(`Runtime error: ${error.message}`, "error");
});

async function bootstrap() {
  populateFixtureSelect();
  restoreTabs();
  restoreSplit();
  bindEvents();

  setRuntimeMessage("Loading highlight queries and browser workspace state.", "info");
  defaultQueries = await loadFasmgQueries();
  elements.queryInput.value = defaultQueries.highlightQuery;

  elements.fixtureSelect.value = FIXTURES[0].path;
  await loadFixture(FIXTURES[0].path);
}

function populateFixtureSelect() {
  for (const fixture of FIXTURES) {
    const option = document.createElement("option");
    option.value = fixture.path;
    option.textContent = fixture.label;
    elements.fixtureSelect.append(option);
  }
}

function bindEvents() {
  elements.loadFixture.addEventListener("click", async () => {
    await loadFixture(elements.fixtureSelect.value);
  });

  elements.resetQuery.addEventListener("click", () => {
    elements.queryInput.value = defaultQueries.highlightQuery;
    void render();
  });

  elements.fixtureSelect.addEventListener("change", async () => {
    await loadFixture(elements.fixtureSelect.value);
  });

  elements.helpToggle.addEventListener("click", toggleHelpPanel);
  elements.helpClose.addEventListener("click", closeHelpPanel);
  document.addEventListener("keydown", handleGlobalKeydown);
  document.addEventListener("click", handleDocumentClick);

  for (const button of document.querySelectorAll("[data-tab-group][data-tab-target]")) {
    button.addEventListener("click", () => activateTab(button.dataset.tabGroup, button.dataset.tabTarget));
  }

  elements.sourceInput.addEventListener("input", debounce(render, 120));
  elements.queryInput.addEventListener("input", debounce(render, 120));

  bindSplitter();
}

async function loadFixture(path) {
  const response = await fetch(new URL(path, import.meta.url));
  if (!response.ok) {
    throw new Error(`failed to load fixture ${path}`);
  }

  elements.sourceInput.value = await response.text();
  await render();
}

async function render() {
  const token = ++renderToken;
  const source = elements.sourceInput.value;
  const queryText = elements.queryInput.value;

  elements.syntaxStatus.textContent = "Parsing";
  elements.queryStatus.textContent = "Compiling";

  try {
    const result = await inspectFasmgSource(source, { queryText });
    if (token !== renderToken) {
      return;
    }

    const queryErrors = result.diagnostics.filter(
      (diagnostic) => diagnostic.kind === "query-error",
    );
    const syntaxIssues = result.diagnostics.filter(
      (diagnostic) => diagnostic.kind !== "query-error",
    );

    elements.previewOutput.innerHTML = result.html || "&nbsp;";
    elements.treeOutput.innerHTML = formatTreeSExpression(result.treeString);
    elements.parseTime.textContent = `${result.parseMs.toFixed(1)} ms`;
    elements.captureCount.textContent = String(result.captures.length);
    elements.syntaxStatus.textContent = syntaxIssues.length
      ? `${syntaxIssues.length} issue${syntaxIssues.length === 1 ? "" : "s"}`
      : "Clean";
    elements.queryStatus.textContent = queryErrors.length
      ? `${queryErrors.length} issue${queryErrors.length === 1 ? "" : "s"}`
      : "Ready";

    renderClasses(result.classesUsed);
    renderCaptures(result.captures);
    renderDiagnostics(result.diagnostics);
    setRuntimeMessage(
      "Runtime healthy. The grammar WASM, query sources, and current browser render all completed successfully.",
      "ok",
    );
  } catch (error) {
    if (token !== renderToken) {
      return;
    }

    elements.previewOutput.textContent = "";
    elements.treeOutput.textContent = "";
    elements.capturesOutput.innerHTML = "";
    elements.diagnosticsOutput.innerHTML = "";
    elements.classesOutput.innerHTML = "";
    elements.parseTime.textContent = "n/a";
    elements.captureCount.textContent = "0";
    elements.syntaxStatus.textContent = "Unavailable";
    elements.queryStatus.textContent = "Unavailable";
    setRuntimeMessage(`Runtime error: ${error.message}`, "error");
  }
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
  const maxCaptures = 80;
  elements.capturesOutput.innerHTML = "";

  if (captures.length === 0) {
    elements.capturesOutput.innerHTML = '<p class="status-pill">No captures for the current query.</p>';
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

  const thead = document.createElement("thead");
  thead.innerHTML = `
    <tr>
      <th scope="col">Capture</th>
      <th scope="col">Range</th>
      <th scope="col">Text</th>
    </tr>
  `;
  table.append(thead);

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
    saveStorageValue(STORAGE_KEYS.editorTab, targetId);
  }

  if (group === "output") {
    elements.outputCaption.textContent = OUTPUT_CAPTIONS[targetId];
    saveStorageValue(STORAGE_KEYS.outputTab, targetId);
  }
}

function restoreTabs() {
  const editorTarget = readStorageValue(STORAGE_KEYS.editorTab) || "editor-source-panel";
  const outputTarget = readStorageValue(STORAGE_KEYS.outputTab) || "output-preview-panel";
  activateTab("editor", editorTarget);
  activateTab("output", outputTarget);
}

function bindSplitter() {
  if (!elements.splitter) {
    return;
  }

  let dragging = false;

  const onPointerMove = (event) => {
    if (!dragging || window.innerWidth <= 1100) {
      return;
    }

    const rect = elements.appShell.getBoundingClientRect();
    const relativeX = event.clientX - rect.left;
    const percent = (relativeX / rect.width) * 100;
    const clamped = clamp(percent, 28, 72);
    document.documentElement.style.setProperty("--split", `${clamped}%`);
  };

  const onPointerUp = () => {
    if (!dragging) {
      return;
    }

    dragging = false;
    elements.splitter.classList.remove("is-dragging");
    saveStorageValue(STORAGE_KEYS.split, getComputedStyle(document.documentElement).getPropertyValue("--split").trim());
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  };

  elements.splitter.addEventListener("pointerdown", (event) => {
    if (window.innerWidth <= 1100) {
      return;
    }

    dragging = true;
    elements.splitter.classList.add("is-dragging");
    elements.splitter.setPointerCapture?.(event.pointerId);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  });
}

function restoreSplit() {
  const savedSplit = readStorageValue(STORAGE_KEYS.split);
  if (savedSplit) {
    document.documentElement.style.setProperty("--split", savedSplit);
  }
}

function toggleHelpPanel() {
  const nextHidden = !elements.helpPanel.hidden;
  elements.helpPanel.hidden = nextHidden;
  elements.helpToggle.setAttribute("aria-expanded", String(!nextHidden));
}

function closeHelpPanel() {
  elements.helpPanel.hidden = true;
  elements.helpToggle.setAttribute("aria-expanded", "false");
}

function handleDocumentClick(event) {
  if (elements.helpPanel.hidden) {
    return;
  }

  if (
    elements.helpPanel.contains(event.target) ||
    elements.helpToggle.contains(event.target)
  ) {
    return;
  }

  closeHelpPanel();
}

function handleGlobalKeydown(event) {
  if (event.key === "Escape") {
    closeHelpPanel();
  }

  if (event.key === "?") {
    event.preventDefault();
    elements.helpPanel.hidden ? toggleHelpPanel() : closeHelpPanel();
  }
}

function setRuntimeMessage(message, kind) {
  elements.emptyState.textContent = message;
  elements.emptyState.style.color = kind === "error" ? "var(--danger)" : "var(--text-soft)";
}

function formatTreeSExpression(treeString) {
  if (!treeString) {
    return "";
  }

  const tokens = tokenizeTreeString(treeString);
  const root = parseSExpression(tokens);
  const lines = renderSExpression(root, 0);
  return lines.join("\n");
}

function tokenizeTreeString(treeString) {
  return treeString.match(/\(|\)|"[^"\\]*(?:\\.[^"\\]*)*"|[^\s()]+/g) || [];
}

function parseSExpression(tokens) {
  let index = 0;

  function parseNode() {
    const token = tokens[index];

    if (token === "(") {
      index += 1;
      const items = [];

      while (index < tokens.length && tokens[index] !== ")") {
        items.push(parseNode());
      }

      index += 1;
      return { type: "list", items };
    }

    index += 1;
    return { type: "atom", value: token };
  }

  return parseNode();
}

function renderSExpression(node, indentLevel) {
  if (node.type === "atom") {
    return [`${indent(indentLevel)}${renderAtom(node.value)}`];
  }

  const items = node.items;
  if (items.length === 0) {
    return [`${indent(indentLevel)}<span class="tree-paren">(</span><span class="tree-paren">)</span>`];
  }

  if (canInlineList(node)) {
    return [`${indent(indentLevel)}${renderInlineList(node)}`];
  }

  const [head, ...rest] = items;
  const lines = [
    `${indent(indentLevel)}<span class="tree-paren">(</span>${renderInlineItem(head, true)}`,
  ];

  for (let i = 0; i < rest.length; i += 1) {
    const item = rest[i];

    if (item.type === "atom" && isFieldAtom(item.value) && rest[i + 1]) {
      const next = rest[i + 1];
      if (canInlineFieldValue(next)) {
        lines.push(
          `${indent(indentLevel + 1)}${renderAtom(item.value)} ${renderInlineItem(next, false)}`,
        );
      } else {
        const rendered = renderSExpression(next, indentLevel + 2);
        rendered[0] = `${indent(indentLevel + 1)}${renderAtom(item.value)} ${rendered[0].trimStart()}`;
        lines.push(...rendered);
      }
      i += 1;
      continue;
    }

    if (item.type === "atom") {
      lines.push(`${indent(indentLevel + 1)}${renderAtom(item.value)}`);
      continue;
    }

    lines.push(...renderSExpression(item, indentLevel + 1));
  }

  lines[lines.length - 1] += `<span class="tree-paren">)</span>`;
  return lines;
}

function canInlineList(node) {
  if (node.type !== "list") {
    return true;
  }

  return node.items.length <= 2 && node.items.every((item) => item.type === "atom");
}

function canInlineFieldValue(node) {
  return node.type === "atom" || canInlineList(node);
}

function renderInlineList(node) {
  return [
    `<span class="tree-paren">(</span>`,
    ...node.items.map((item, index) => {
      const rendered = renderInlineItem(item, index === 0);
      return index === 0 ? rendered : ` ${rendered}`;
    }),
    `<span class="tree-paren">)</span>`,
  ].join("");
}

function renderInlineItem(node, isHead) {
  if (node.type === "atom") {
    return renderAtom(node.value, isHead);
  }

  return renderInlineList(node);
}

function renderAtom(value, isHead = false) {
  const escaped = escapeHtml(value);

  if (isFieldAtom(value)) {
    return `<span class="tree-field">${escaped}</span>`;
  }

  if (value === "ERROR" || value === "MISSING") {
    return `<span class="tree-node tree-node-error">${escaped}</span>`;
  }

  if (value.startsWith('"') && value.endsWith('"')) {
    return `<span class="tree-token">${escaped}</span>`;
  }

  if (isHead) {
    return `<span class="tree-node tree-node-head">${escaped}</span>`;
  }

  return `<span class="tree-node">${escaped}</span>`;
}

function isFieldAtom(value) {
  return value.endsWith(":");
}

function indent(level) {
  return "  ".repeat(level);
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function saveStorageValue(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Best-effort persistence only.
  }
}

function readStorageValue(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function debounce(fn, wait) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => fn(...args), wait);
  };
}
