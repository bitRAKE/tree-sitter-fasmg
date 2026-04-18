// Contextual feedback at the caret.
//
// Answers three questions that the curated samples — especially
// quine-calminstruction and irps.inc — surface as unavoidable:
//
//   1. What keyword group does the token under the caret belong to?
//   2. What blocks enclose the caret (macro, if, virtual, …)?
//   3. If the caret is inside a `calminstruction`, what command /
//      parameters are in scope?
//
// Answers are derived entirely from the parsed tree-sitter tree plus
// `spec/keyword-groups.json`. No scope-hierarchy analysis is
// attempted here — that (and CALM parameter-sigil semantics) belong
// in `fasmg_lsp`; this file is a feedback surface, not an analyser.

let keywordGroupIndex = null;

export async function loadKeywordGroupIndex() {
  if (keywordGroupIndex) return keywordGroupIndex;
  const url = new URL("../../../spec/keyword-groups.json", import.meta.url);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to load keyword-groups.json: ${response.status}`);
  }
  const groups = await response.json();
  const map = new Map();
  for (const [groupName, keywords] of Object.entries(groups)) {
    for (const keyword of keywords) {
      const existing = map.get(keyword);
      if (existing) {
        existing.push(groupName);
      } else {
        map.set(keyword, [groupName]);
      }
    }
  }
  keywordGroupIndex = map;
  return keywordGroupIndex;
}

export function analyseContext({ tsTree, source, pos }) {
  if (!tsTree) return null;

  const root = tsTree.rootNode;
  const node = root.descendantForIndex?.(pos) ?? null;
  if (!node) return null;

  const wordAtCursor = wordAt(source, pos);
  const keywordGroups = wordAtCursor
    ? (keywordGroupIndex?.get(wordAtCursor) ?? null)
    : null;

  const enclosingBlocks = [];
  const enclosingCalm = { name: null, parameters: [] };
  let cursor = node;

  while (cursor && cursor !== root) {
    if (BLOCK_TYPES.has(cursor.type)) {
      enclosingBlocks.push({
        type: cursor.type,
        startRow: cursor.startPosition.row,
        endRow: cursor.endPosition.row,
      });
    }

    if (cursor.type === "calminstruction_definition") {
      const nameNode = cursor.childForFieldName?.("name");
      enclosingCalm.name = nameNode
        ? source.slice(nameNode.startIndex, nameNode.endIndex)
        : null;
      enclosingCalm.parameters = collectCalmParameters(cursor, source);
    }

    cursor = cursor.parent;
  }

  return {
    node: {
      type: node.type,
      named: node.isNamed,
      start: { row: node.startPosition.row, column: node.startPosition.column },
      end: { row: node.endPosition.row, column: node.endPosition.column },
      text:
        node.endIndex - node.startIndex <= 120
          ? source.slice(node.startIndex, node.endIndex)
          : null,
    },
    wordAtCursor,
    keywordGroups,
    enclosingBlocks,
    enclosingCalm,
  };
}

const BLOCK_TYPES = new Set([
  "macro_definition",
  "struc_definition",
  "calminstruction_definition",
  "namespace_block",
  "if_block",
  "while_block",
  "iterate_block",
  "repeat_block",
  "match_block",
  "virtual_block",
  "postpone_block",
  "irp_block",
]);

function collectCalmParameters(calmNode, source) {
  const params = [];
  const cursor = calmNode.walk?.();
  if (!cursor) return params;

  const stop = calmNode.endIndex;
  const root = calmNode;
  let visitedChildren = false;

  while (true) {
    if (!visitedChildren) {
      const current = cursor.currentNode?.() ?? cursor.currentNode;
      if (current && current.type === "parameter") {
        const nameNode = current.childForFieldName?.("name");
        const sigilsNode = current.childForFieldName?.("sigils");
        params.push({
          name: nameNode
            ? source.slice(nameNode.startIndex, nameNode.endIndex)
            : null,
          raw: source.slice(current.startIndex, current.endIndex),
          sigils: sigilsNode
            ? source.slice(sigilsNode.startIndex, sigilsNode.endIndex)
            : null,
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
      const current = cursor.currentNode?.() ?? cursor.currentNode;
      if (current === root || current?.id === root.id) break;
      visitedChildren = true;
      continue;
    }
    break;
  }

  cursor.delete?.();
  return params;
}

function wordAt(source, pos) {
  if (pos < 0 || pos > source.length) return null;
  let start = pos;
  let end = pos;
  while (start > 0 && isWord(source.charCodeAt(start - 1))) start -= 1;
  while (end < source.length && isWord(source.charCodeAt(end))) end += 1;
  if (end === start) return null;
  const word = source.slice(start, end);
  return /^[A-Za-z_]/.test(word) ? word : null;
}

function isWord(code) {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    code === 0x5f ||
    code === 0x2e
  );
}
