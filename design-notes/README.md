# design-notes/

Historical planning docs from the grammar's pre-migration phase. They
describe how the current `grammar.js` was designed and validated, but
they are **not** active roadmaps — the work in them has shipped.

Kept for context: when an unusual node shape, field name, or precedence
rule looks arbitrary, these docs explain why.

- `refactor-plan.md` — staged refactor that produced the current
  statement / expression split and the fasmg-aware scanner contract
- `edge-cases-plan.md` — pathological inputs the grammar was hardened
  against (line continuations, decorator stacking, cross-macro block
  pairing, line-modifier prefixes) and the resolution chosen for each

For the current node catalog, field contract, and invariants, see
[`../GRAMMAR_SURFACE.md`](../GRAMMAR_SURFACE.md).
