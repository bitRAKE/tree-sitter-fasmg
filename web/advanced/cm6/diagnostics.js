// Bridge our parse-pipeline diagnostics (from web/shared/fasmg-web.js's
// inspectFasmgSource) to @codemirror/lint. The lint extension already
// owns the decorations + gutter marker pipeline; we just convert our
// row/column positions to byte offsets and map severity, then dispatch
// via `setDiagnostics`.
//
// Doing it this way (direct dispatch) rather than via `linter(source)`
// avoids re-parsing: we already have diagnostics in hand from the
// highlight plugin's single parse. The lint extension doesn't care
// how they arrive.

import { lintGutter, setDiagnostics } from "@codemirror/lint";

export function fasmgLintGutter() {
  return lintGutter();
}

export function applyFasmgDiagnostics(view, diagnostics) {
  if (!view) return;

  const doc = view.state.doc;
  const cmDiagnostics = [];

  for (const diagnostic of diagnostics) {
    const from = positionToOffset(doc, diagnostic.startPosition);
    let to = positionToOffset(doc, diagnostic.endPosition);
    if (to <= from) to = Math.min(from + 1, doc.length);

    cmDiagnostics.push({
      from,
      to,
      severity: severityFor(diagnostic.kind),
      source: diagnostic.kind,
      message: diagnostic.message,
    });
  }

  view.dispatch(setDiagnostics(view.state, cmDiagnostics));
}

function severityFor(kind) {
  if (kind === "error" || kind === "query-error") return "error";
  if (kind === "missing") return "warning";
  return "info";
}

function positionToOffset(doc, pos) {
  if (!pos) return 0;
  const lineNumber = Math.min(Math.max(1, pos.row + 1), doc.lines);
  const line = doc.line(lineNumber);
  return Math.min(line.from + Math.max(0, pos.column), line.to);
}
