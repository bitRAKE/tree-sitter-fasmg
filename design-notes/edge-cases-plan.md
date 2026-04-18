# Syntactical Edge Cases — Plan

Status after Phase 4: **291/321 (90.65 %)**. The remaining 30 failures
cluster around a small set of fasmg patterns that the current grammar
doesn't model. Each pattern is legitimate fasmg syntax, exercised by
the real `fasm2/include` and `fasmg/packages` corpora.

This plan addresses them in priority order: highest-leverage-first,
smallest-risk-first. `x86-2.inc` at 75:2 (builder-builder pattern) is
**deliberately out of scope** — accepted as unparsable.

## A note on error reporting

The `row:col` in `baseline/*/summary.md` is the **start of the
outermost ERROR node's span**, not where the failing token sits. If a
40-line `iterate` block fails because of a `match` on line 24 inside
a nested macro, the summary reports the iterate's line 16. Add
innermost-error reporting to `corpus-baseline.sh` before starting
Phase 7 so regressions are legible.

**Action P0 (pre-flight):** extend `corpus-baseline.sh` to walk each
failing file's S-expression and report the **innermost** `(ERROR ...)`
row:col alongside the outermost. Same summary table, new column.
Cost: ~30 lines of shell + jq. Gain: every remaining phase gets a
legible failure row.

---

## Failure taxonomy (30 files)

| Bucket | Count | Representative snippet | Root cause |
|---|---:|---|---|
| G. Free block opener inside macro body | ~15 | `namespace .` in `macro struct? name` | Opener is paired by `end namespace` emitted from the peer `macro end?.struct?!`; the closer is in a **different** macro body. Same class of problem as `free_end_clause` but for openers. |
| H. `match` in non-CALM macro body (CALM override) | 1 | `match seg:off, var` in `macro calminstruction?.fword?` | `match_statement` only in `calm_block_body`; `match_block` needs `end match` |
| I. Stray syntactical characters in instruction args | 2 | `AMX.parse_sib_operand@dest dest,dtail]` | `argument_atom` doesn't accept bare `]`/`)`/`}` |
| J. User-defined `end?` block pairs | ~10 | `macro end?.struct?!` + `esc struc name` | Combination of G (opener in one body) + already-working `free_end_clause` (closer in the paired body) |
| K. Misc (`frame`/`endf` custom blocks, `.` operator forms) | ~2 | `define fastcall? fastcall` in proc64.inc | Deeper; investigate per-file |
| L. Accepted unparsable | 1 | `end calminstruction` in x86-2.inc builder-builder | No action |

Bucket counts overlap — one file may hit G and J. The recovery target
is not a precise sum but the file's outermost ERROR going green.

### The pairing-across-macros principle

`namespace X` always requires `end namespace` — that is not optional.
What *is* routine in fasmg is for the opener and closer to sit in
**different macro bodies** that pair at expansion time. The canonical
example is the `struct?`/`end?.struct?!` macro pair: the opener macro
body contains an unpaired `namespace .`, and the peer ender macro
body contains the unpaired `end namespace`. Each body is
syntactically incomplete on its own; fasmg only ever sees the paired
stream after expansion.

Tree-sitter cannot run macro expansion, so the grammar must accept
both halves as-is inside `permissive_block_body`. The current
scanner already emits `free_end_clause` for the closer half; the
missing piece is a `free_begin_clause` (or a choice of bare-opener
rules) for the opener half.

---

## Phase 7 — Free opener clauses (bucket G)

Highest-leverage change. Add a `free_begin_clause` rule (the dual of
the existing `free_end_clause` scanner token) to
`permissive_block_body`. When a macro/struc body contains a block
opener whose closer is emitted by a *different* macro expansion, the
opener line parses as a `free_begin_clause` and the body continues
on the next line rather than descending into a block that can never
close.

Block keywords we care about (paired openers where the grammar
currently requires a full block):

- `namespace` / `end namespace`
- `if` / `end if`
- `while` / `end while`
- `iterate` / `end iterate`
- `repeat` / `end repeat`
- `match` / `end match`
- `virtual` / `end virtual`
- `postpone` / `end postpone`
- `irp` / `end irp`, `irpv` / `end irpv`
- `data` / `end data`

**Grammar change:**

```js
// Dual of free_end_clause. Matches any block opener as a bare line,
// letting the body continue without its closer (which is emitted
// elsewhere via a peer macro).
free_begin_clause: ($) =>
  prec(-1, choice(
    seq(keywordToken("namespace"), optional($.argument_list)),
    seq(keywordToken("if"),        $.argument_list),
    seq(keywordToken("while"),     $.argument_list),
    seq(keywordToken("iterate"),   $.argument_list),
    seq(keywordToken("repeat"),    optional($.argument_list)),
    seq(keywordToken("match"),     $.match_pattern),
    seq(keywordToken("virtual"),   optional(seq(keywordToken("at"), $.argument_list))),
    seq(keywordToken("postpone"),  optional($.argument_list)),
    seq(keywordToken("irp"),       $.argument_list),
    seq(keywordToken("irpv"),      $.argument_list),
    seq(keywordToken("data"),      $.argument_list),
  )),

permissive_block_body: ($) =>
  prec.right(repeat1(choice(
    $._statement,
    $.free_end_clause,
    $.free_begin_clause,   // new
    $._blank_line,
  ))),
```

The `prec(-1)` biases GLR to prefer the full block form when the
closer is present. Only when the block can't complete does
`free_begin_clause` win.

**Test coverage (new corpus `test/corpus/free-opener.txt`):**
- Normal: `namespace X / ... / end namespace` still parses as
  `namespace_block` (no regression).
- Peer-paired: `macro struct? name` body with `namespace .` and no
  `end namespace` → `namespace .` parses as `free_begin_clause`; the
  enclosing `end macro` closes the macro.
- Both halves: `macro end?.struct?!` body with `end namespace` +
  `esc end struc` → `end namespace` as `free_end_clause`
  (already works), plus whatever follows.
- Nested: `namespace A` followed by `namespace B` then `end
  namespace` inside macro body → outer `A` is free, inner `B` is a
  full block.

**Risk:** GLR conflict proliferation. Tree-sitter will need a
`conflicts:` entry for each `(block_rule, free_begin_clause)` pair
that shares a prefix. If the generator rejects, bias via
`prec.dynamic()` instead of static prec.

**Expected recovery:** ~15 files (all format/*, macro/*.inc,
utility/struct.inc, utility/inline.inc, wasm.inc).

---

## Phase 8 — CALM-override macros (bucket H)

Per the fasmg manual:

> Defining macroinstructions in the namespace of case-insensitive
> "calminstruction" allows to add customized commands to the language
> of CALM instructions. However, they must be defined as
> case-insensitive to be recognized as such.

So `macro calminstruction?.NAME?` (and the `calminstruction
calminstruction?.NAME?` form) defines a body that runs under CALM
semantics. Inside, `match` is single-line (`match_statement`), not a
block.

Two design options:

### Option A — structural: detect name prefix, switch body type

Introduce `calm_override_macro_definition`:

```js
calm_override_macro_definition: ($) =>
  seq(
    keywordToken("macro"),
    optional("!"),
    field("name", $.calm_override_name),
    optional(field("parameters", $.parameter_list)),
    /\n/,
    optional(field("body", $.calm_block_body)),
    field("end", ciPhrase("end macro")),
  ),

calm_override_name: ($) =>
  token(prec(3, /[cC][aA][lL][mM][iI][nN][sS][tT][rR][uU][cC][tT][iI][oO][nN]\??\.[^\s+\-\/*=<>()\[\]{}:!,|&~`;\\#]+/)),
```

Same for struc and calminstruction forms. Dispatch: choice in the
top-level `_statement` between the normal and override forms.

**Pro:** clean parse tree — `calm_block_body` tells the LSP exactly
what semantics apply. **Con:** Three new rules + token-level
prefix-matching; the identifier side of symbol_name now has a special
case.

### Option B — permissive: allow `match_statement` in `block_body`

Add `$.match_statement` as a fallback choice in `_statement`, behind
`$.match_block`. GLR tries match_block first; when no `end match` is
found, falls back to the single-line form.

**Pro:** 4-line change. Covers dd.inc and any other file where `match`
appears at the CALM level inside a non-CALM body. **Con:** permissive
— loses the "this is a CALM context" signal; the parse tree no longer
distinguishes CALM-override macros from regular macros.

**Recommendation:** Start with Option B (low cost, unblocks dd.inc).
If downstream tooling (LSP, highlights) needs the distinction, layer
Option A on top later.

**Expected recovery:** 1 file (dd.inc) directly; possibly 1-2 more in
the `x86-2/*` tree that we haven't probed yet.

---

## Phase 9 — Stray syntactical characters in arguments (bucket I)

fasmg's `syntactical_characters` — `+-/*=<>()[]{}:?!,.|&~#\`;` — act
as **token terminators**, not bracket pairs. A bare `]` or `)` at the
end of an argument word (`dtail]`) is legitimate; the `]` terminates
the `dtail` token and stands as its own one-char token.

Current `argument_atom` models `[`/`]`/`(`/`)`/`{`/`}` only as paired
`bracketed_argument` / `parenthesized_argument` / `braced_argument`.
A stray closer bombs the parse.

**Grammar change:**

```js
// Add to the argument_atom choice list, at lower precedence than
// the paired forms so balanced cases still win.
stray_punctuation: () =>
  token(prec(-2, /[\]\)\}]/)),

argument_atom: ($) => choice(
  $.number_literal,
  ...
  $.parenthesized_argument,
  $.bracketed_argument,
  $.braced_argument,
  $.stray_punctuation,   // new
),
```

Consider the same addition to `instruction_argument_head` — the amx.inc
case has `dtail]` as the argument HEAD (first atom after the
instruction keyword).

**Test coverage:**
- `foo dtail]` — one instruction, arg is `dtail` + `stray_punctuation` ✓
- `foo [x]` — bracketed_argument wins (higher prec) ✓
- `foo (x)(y)` — two parenthesized_arguments, no stray ✓
- `match a]=, b, c` — scanner already handles via match_pattern_text; no interaction ✓

**Risk:** GLR may still explore stray_punctuation inside a
well-balanced expression; the `prec(-2)` discourages but doesn't
forbid. Monitor tree size in worst-case files (x86.inc is large).

**Expected recovery:** 2 files (iset/amx.inc twice — fasm2 and fasmg
copies).

---

## Phase 10 — User-defined `end?` block pairs (bucket J)

Per the manual (and the user's note): all built-in `end X` clauses
live in the case-insensitive `end?` namespace. Defining a macro as
`macro end?.NAME?!` creates a custom `end NAME` that participates in
block pairing.

Typical pattern (`macro/struct.inc`):

```fasmg
macro struct? definition&
    esc struc definition    ; opens a struc in parent scope
    label . : .%top - .
    namespace .             ; (G) flex-close
end macro

macro end?.struct?!         ; custom `end struct`
    %top:
    end namespace           ; free_end_clause
    esc end struc           ; esc + free_end_clause
end macro
```

This pattern is mostly unblocked by Phase 7 (flex-close namespace)
and the existing Phase 4 `free_end_clause` scanner. The remaining
issue is **isolated pair validation**: when the grammar encounters
only the opener macro (without the paired ender) in the same file,
everything should still parse because the body is self-contained.

**Verification-only work:** write corpus tests for the canonical
`struct`/`ends` pair (from the manual §5), the `end?.struct?!` form
from coff.inc, and from inline.inc. No grammar change expected —
Phase 7 should resolve these as a side effect.

**Action:** create corpus test `test/corpus/user-defined-end-pairs.txt`
with 3 sub-tests. Run after Phase 7 lands; any still-failing sub-test
gets its own follow-up phase.

**Expected recovery:** ~10 files once Phase 7 lands (covered by the
Phase 7 estimate — not additive).

---

## Phase 11 — proc64.inc custom blocks (bucket K)

`proc64.inc` defines many fasmg-like blocking constructs using the
`end?.NAME?!` pattern: `frame`/`endf`, `proc`/`endp`, etc. The real
failure row for `define fastcall? fastcall` at 0:0 is almost certainly
deeper in the file — Phase 7 + Phase 10 should unblock most of it.

**Action:** After Phases 7–10, re-run the baseline. If proc64.inc
still fails, use the new innermost-error reporting (P0) to find the
real row, then decide whether it's a new pattern or a variant of
G/J.

**Expected recovery:** 2 files (proc64.inc fasm2 + fasmg copies),
contingent on above.

---

## Deliberately out of scope

- **x86-2.inc 75:2** — a builder-builder pattern where a
  `calminstruction` emits another `calminstruction` with matched
  `end calminstruction` tokens. The inner emitter's body contains
  floating `end calminstruction` that closes the outer definition
  in the expanded scope. GLR cannot pair these without running
  fasmg's macro expander. **Document and skip.**
- **`retaincomments` / `isolatelines` runtime mode changes** —
  already documented in syntax notes.

---

## Execution order

| Phase | Target | Expected +/Δ | Cost |
|---:|---|---:|---|
| P0 | innermost-error reporting in baseline | 0 | S |
| 7 | flex-close `namespace` + regional directives | +15 | M |
| 8 | match_statement in block_body (Opt B) | +1 | XS |
| 9 | stray syntactical chars | +2 | S |
| 10 | `end?` pair verification tests | +0 (covered by 7) | S |
| 11 | proc64.inc investigation | +2 | M–L |

Running total: 291 → ~311/321 (**96.9 %**). Remaining ~10 are
genuinely deeper and should be catalogued file-by-file before
deciding whether to chase further.

Each phase lands as an independent commit with a baseline snapshot.
Any phase that regresses a previously-passing file gets reverted
before merging — per-file delta visibility is non-negotiable.

---

## Post-implementation status (2026-04-17)

**Actual outcome: 291 → 316/321 (98.44 %), +25 files.**

### What shipped

- **P0** — innermost-error reporting added to `scripts/corpus-baseline.sh`.
- **Phase 7** — `free_begin_clause` rule with `prec.dynamic(-1)` inside
  `permissive_block_body`. Static `prec(-1)` was tried first but didn't
  trigger GLR fallback — tree-sitter's LR table resolved statically in
  favour of the full block form. Switched to `prec.dynamic(-1)` with
  explicit conflicts declarations per block_rule; dynamic precedence is
  applied at GLR runtime and unblocks the opener-only path when the
  block can't complete.
- **Phase 8** — struc gained `calm_target` target form (`struc (&NAME) ...`),
  mirroring calminstruction. `match_statement` already available in
  `calm_block_body`; no `block_body` change needed because the
  affected file (dd.inc) was unblocked by Phase 7's `free_begin_clause`
  covering `match` as opener.
- **Phase 9** — `stray_bracket` rule for `]`/`)`/`}` as low-prec
  `argument_atom`. Stray *openers* (`[`/`(`/`{`) are **not** covered —
  an attempt to include them caused a 41-file regression due to
  grammar-literal conflicts. The scanner's `match_pattern_text` was
  extended to detect unclosed openers at end-of-line and emit text.

### Remaining failures (5 files)

| path | snippet | bucket | status |
| --- | --- | --- | --- |
| `fasm2/macro/if.inc` 110:17 | `current equ (` | I-variant | stray open paren at EOL — outside argument position (equ RHS); scanner can't fallback-text |
| `fasmg/x86/include/macro/if.inc` 110:17 | `current equ (` | I-variant | same as above (fasmg copy) |
| `fasmg/utility/inline.inc` 31:1 | `end struc` | J-variant | free `end struc` inside peer macro body — closer lives in a different macro, but `end struc` is also the terminator of the enclosing `macro_definition`; repeat1 greediness defeats prec.dynamic |
| `fasm2/x86-2.inc` 75:2 | `end calminstruction` | L | accepted unparsable builder-builder |
| `fasmg/x86-2/x86-2.inc` 75:2 | `end calminstruction` | L | same as above (fasmg copy) |

### Why the last three are hard

**`current equ (` — stray open paren in equ RHS.** The RHS of `equ` is
an `argument_list`; a bare unmatched `(` needs either (a) a
scanner-level pattern that detects unclosed openers at EOL in equ
position, or (b) including `(`/`[`/`{` in `stray_bracket`. Path (b)
regressed by 41 files because bare openers conflict with the literal
`(` used elsewhere in the grammar.

**`end struc` in peer macro body.** Three of the `end X` words — `macro`,
`struc`, `calminstruction` — are reserved by the external scanner as
definition closers. Making them free-end-able inside a peer body means
the grammar has to distinguish "this `end struc` closes the
surrounding `struc_definition`" from "this `end struc` is a free-end
clause emitted for a peer's scope." Neither tree-sitter nor our scanner
has the context to tell the two apart; a grammar-level
`free_end_closer_clause` rule with `prec.dynamic(-100)` was tried and
the repeat1 greediness consumed the definition's own closer. Not
solvable without either a contextual scanner (expansion-aware) or
unreachable precedence gymnastics.

### Out-of-scope files documented

All three accepted failures are called out in the failure table above.
The plan's execution order (Phases 7–11) is superseded by this status
section — Phase 11 (proc64.inc) was unblocked by Phase 7 and no longer
appears as a failure.

### Consumer-facing surface

Every rule named in this plan — `free_begin_clause`, `free_end_clause`,
`stray_bracket`, `calm_target`, `match_pattern_text` — is part of the
grammar's public surface for downstream consumers. The node catalog,
field contract, and invariants that consumers should rely on live in
[GRAMMAR_SURFACE.md](GRAMMAR_SURFACE.md). If you change one of these
rules' shape (fields, children, precedence), update that doc in the
same commit.
