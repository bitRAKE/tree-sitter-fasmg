// Build a pretty-printed S-expression for a tree-sitter tree while
// tracking the byte span each node occupies in the resulting string
// AND in the original source. Powers bidirectional click-sync between
// the Source editor and the Tree panel: source cursor -> innermost
// source span -> tree-string span to select; tree cursor -> innermost
// tree-string span -> source span to select.
//
// Format mirrors the tree-sitter CLI `parse` output semantics:
//   (parent_type
//     field_name: (child_type)
//     (child_type
//       "anonymous literal"))
//
// Anonymous nodes are emitted as quoted strings with `\` and `"`
// escaped. ERROR nodes are treated as named (so they appear in spans)
// but kept in the conventional tree-sitter paren form. Every node
// (named or not) gets a span, so clicking on "mov" in the tree selects
// the mov text in the source.

export function buildTreeString(rootNode) {
  const parts = [];
  const spans = [];
  let offset = 0;

  function emit(text) {
    parts.push(text);
    offset += text.length;
  }

  function visit(node, indent) {
    const strStart = offset;
    const treatAsNamed = node.isNamed || node.type === "ERROR";

    if (!treatAsNamed) {
      const text = node.text ?? "";
      const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      emit('"' + escaped + '"');
    } else {
      emit("(");
      emit(node.type);

      const childCount = node.childCount;
      for (let i = 0; i < childCount; i += 1) {
        const child = node.child(i);
        const fieldName = node.fieldNameForChild(i);
        emit("\n");
        emit(indent + "  ");
        if (fieldName) {
          emit(fieldName);
          emit(": ");
        }
        visit(child, indent + "  ");
      }

      emit(")");
    }

    spans.push({
      strStart,
      strEnd: offset,
      sourceStart: node.startIndex,
      sourceEnd: node.endIndex,
      type: node.type,
      named: node.isNamed,
    });
  }

  visit(rootNode, "");

  spans.sort((a, b) => a.strStart - b.strStart);
  return { text: parts.join(""), spans };
}

// Innermost span whose source range contains `pos`. Ties broken by
// smallest span, so we always pick the tightest enclosing node.
export function findSpanBySource(spans, pos) {
  let best = null;
  for (const span of spans) {
    if (span.sourceStart <= pos && pos <= span.sourceEnd) {
      if (
        !best ||
        span.sourceEnd - span.sourceStart < best.sourceEnd - best.sourceStart
      ) {
        best = span;
      }
    }
  }
  return best;
}

export function findSpanByTree(spans, pos) {
  let best = null;
  for (const span of spans) {
    if (span.strStart <= pos && pos <= span.strEnd) {
      if (!best || span.strEnd - span.strStart < best.strEnd - best.strStart) {
        best = span;
      }
    }
  }
  return best;
}
