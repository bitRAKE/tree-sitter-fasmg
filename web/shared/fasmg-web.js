import * as TreeSitter from "https://tree-sitter.github.io/web-tree-sitter.js";

const DEFAULT_PATHS = {
  wasm: "../../tree-sitter-fasmg.wasm",
  highlightQuery: "../../queries/highlights.scm",
  localsQuery: "../../queries/locals.scm",
  foldsQuery: "../../queries/folds.scm",
};

let parserRuntimePromise;
const languageCache = new Map();
const queryCache = new Map();

export async function loadFasmgLanguage(options = {}) {
  await loadParserRuntime();

  const wasmUrl = resolveUrl(options.wasmPath || DEFAULT_PATHS.wasm);
  if (!languageCache.has(wasmUrl)) {
    languageCache.set(wasmUrl, TreeSitter.Language.load(wasmUrl));
  }

  return languageCache.get(wasmUrl);
}

export async function loadFasmgQueries(options = {}) {
  const paths = {
    highlightQuery: resolveUrl(options.highlightQueryPath || DEFAULT_PATHS.highlightQuery),
    localsQuery: resolveUrl(options.localsQueryPath || DEFAULT_PATHS.localsQuery),
    foldsQuery: resolveUrl(options.foldsQueryPath || DEFAULT_PATHS.foldsQuery),
  };

  const cacheKey = JSON.stringify(paths);
  if (!queryCache.has(cacheKey)) {
    queryCache.set(
      cacheKey,
      Promise.all([
        fetchText(paths.highlightQuery),
        fetchText(paths.localsQuery),
        fetchText(paths.foldsQuery),
      ]).then(([highlightQuery, localsQuery, foldsQuery]) => ({
        highlightQuery,
        localsQuery,
        foldsQuery,
      })),
    );
  }

  return queryCache.get(cacheKey);
}

export async function highlightFasmgToHtml(source, options = {}) {
  const result = await inspectFasmgSource(source, options);
  return {
    html: result.html,
    diagnostics: result.diagnostics,
    classesUsed: result.classesUsed,
  };
}

export async function inspectFasmgSource(source, options = {}) {
  const language = await loadFasmgLanguage(options);
  const querySources = await loadFasmgQueries(options);
  const parser = new TreeSitter.Parser();
  let tree;
  let query;
  let parseMs = 0;

  try {
    parser.setLanguage(language);

    const startedAt = performance.now();
    tree = parser.parse(source);
    parseMs = performance.now() - startedAt;

    const queryText = options.queryText ?? querySources.highlightQuery;
    let queryDiagnostic = null;
    let captures = [];

    try {
      query = new TreeSitter.Query(language, queryText);
      captures = dedupeCaptures(query.captures(tree.rootNode), source);
    } catch (error) {
      queryDiagnostic = toQueryDiagnostic(error, queryText);
    }

    const diagnostics = collectSyntaxDiagnostics(tree, source);
    if (queryDiagnostic) {
      diagnostics.push(queryDiagnostic);
    }

    return {
      html: renderCapturedHtml(source, captures),
      classesUsed: [...new Set(captures.map((capture) => capture.name))].sort(),
      diagnostics,
      captures: captures.map((capture) => ({
        name: capture.name,
        startIndex: capture.startIndex,
        endIndex: capture.endIndex,
        startPosition: capture.startPosition,
        endPosition: capture.endPosition,
        text: capture.text,
      })),
      treeString: tree.rootNode.toString(),
      parseMs,
    };
  } finally {
    query?.delete?.();
    tree?.delete?.();
    parser.delete?.();
  }
}

function dedupeCaptures(captures, source) {
  const seen = new Set();
  const uniqueCaptures = [];

  for (const capture of captures) {
    const startIndex = capture.node.startIndex;
    const endIndex = capture.node.endIndex;

    if (startIndex === endIndex) {
      continue;
    }

    const key = `${capture.name}:${startIndex}:${endIndex}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniqueCaptures.push({
      name: capture.name,
      startIndex,
      endIndex,
      startPosition: toPosition(capture.node.startPosition),
      endPosition: toPosition(capture.node.endPosition),
      text: source.slice(startIndex, endIndex),
    });
  }

  uniqueCaptures.sort((left, right) => {
    if (left.startIndex !== right.startIndex) {
      return left.startIndex - right.startIndex;
    }
    if (left.endIndex !== right.endIndex) {
      return right.endIndex - left.endIndex;
    }
    return left.name.localeCompare(right.name);
  });

  return uniqueCaptures;
}

function renderCapturedHtml(source, captures) {
  if (captures.length === 0) {
    return escapeHtml(source);
  }

  const boundaries = new Map();
  for (const capture of captures) {
    const startBoundary = boundaries.get(capture.startIndex) || { start: [], end: [] };
    startBoundary.start.push(capture.name);
    boundaries.set(capture.startIndex, startBoundary);

    const endBoundary = boundaries.get(capture.endIndex) || { start: [], end: [] };
    endBoundary.end.push(capture.name);
    boundaries.set(capture.endIndex, endBoundary);
  }

  const points = [...boundaries.keys()].sort((left, right) => left - right);
  const activeClasses = new Map();
  const parts = [];
  let lastIndex = 0;

  for (const point of points) {
    if (point > lastIndex) {
      parts.push(wrapHighlightedSegment(source.slice(lastIndex, point), activeClasses));
      lastIndex = point;
    }

    const boundary = boundaries.get(point);
    for (const name of boundary.end) {
      decrementActiveClass(activeClasses, name);
    }
    for (const name of boundary.start) {
      activeClasses.set(name, (activeClasses.get(name) || 0) + 1);
    }
  }

  if (lastIndex < source.length) {
    parts.push(wrapHighlightedSegment(source.slice(lastIndex), activeClasses));
  }

  return parts.join("");
}

function wrapHighlightedSegment(segment, activeClasses) {
  const escaped = escapeHtml(segment);
  if (!escaped) {
    return "";
  }

  const classNames = [...activeClasses.keys()]
    .sort()
    .flatMap((name) => name.split("."))
    .filter((value, index, array) => array.indexOf(value) === index)
    .join(" ");

  if (!classNames) {
    return escaped;
  }

  return `<span class="${classNames}">${escaped}</span>`;
}

function decrementActiveClass(activeClasses, name) {
  const count = activeClasses.get(name);
  if (!count) {
    return;
  }

  if (count === 1) {
    activeClasses.delete(name);
  } else {
    activeClasses.set(name, count - 1);
  }
}

function collectSyntaxDiagnostics(tree, source) {
  const diagnostics = [];
  const sourceLines = source.split(/\r?\n/);
  const cursor = tree.rootNode.walk();
  let visitedChildren = false;

  while (true) {
    if (!visitedChildren) {
      if (cursor.nodeType === "ERROR" || cursor.nodeIsMissing) {
        const startPosition = toPosition(cursor.startPosition);
        const endPosition = toPosition(cursor.endPosition);

        diagnostics.push({
          kind: cursor.nodeIsMissing ? "missing" : "error",
          nodeType: cursor.nodeType,
          startPosition,
          endPosition,
          message: cursor.nodeIsMissing
            ? `Tree-sitter inserted missing syntax for ${cursor.nodeType}`
            : "Tree-sitter emitted an ERROR node",
          lineText: sourceLines[startPosition.row] || "",
        });
      }

      if (cursor.gotoFirstChild()) {
        visitedChildren = false;
        continue;
      }
    }

    if (cursor.gotoNextSibling()) {
      visitedChildren = false;
      continue;
    }

    if (cursor.gotoParent()) {
      visitedChildren = true;
      continue;
    }

    break;
  }

  cursor.delete?.();
  return diagnostics;
}

function toQueryDiagnostic(error, queryText) {
  const index = Number.isInteger(error?.index) ? error.index : queryText.length;
  const length = Number.isInteger(error?.length) ? error.length : 1;
  const startPosition = positionFromIndex(queryText, index);
  const endPosition = positionFromIndex(queryText, index + length);

  return {
    kind: "query-error",
    nodeType: "query",
    startPosition,
    endPosition,
    message: error?.message || "Tree-sitter could not compile the query",
    lineText: queryText.split(/\r?\n/)[startPosition.row] || "",
  };
}

function positionFromIndex(text, index) {
  const safeIndex = Math.max(0, Math.min(index, text.length));
  let row = 0;
  let column = 0;

  for (let offset = 0; offset < safeIndex; offset += 1) {
    if (text[offset] === "\n") {
      row += 1;
      column = 0;
    } else {
      column += 1;
    }
  }

  return { row, column };
}

function toPosition(position) {
  return {
    row: position.row,
    column: position.column,
  };
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function loadParserRuntime() {
  if (!parserRuntimePromise) {
    parserRuntimePromise = TreeSitter.Parser.init();
  }

  return parserRuntimePromise;
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to load ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

function resolveUrl(path) {
  return new URL(path, import.meta.url).href;
}
