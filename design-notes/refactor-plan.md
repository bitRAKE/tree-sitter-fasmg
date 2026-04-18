# tree-sitter-fasmg refactor plan

Status: baseline 281/321 (87.5%). Remaining 40 failures cluster around
five root causes, all of which stem from the same architectural choice:
the current grammar uses *lexer-level* keyword precedence
(`keywordToken(w) = token(prec(1, ciWord(w)))`) to classify every
occurrence of an instruction-keyword text as a keyword token. fasmg's
own model contradicts this at three levels — position, shadowing, and
name decorators.

## Goal

Rebuild the grammar around the two-form line shape fasmg actually uses:

```
line = {instruction} {parameter}*
     | {identifier}  {labeled_instruction} {parameter}*
```

Which alternative applies is decided at lookup time: if the first token
resolves to an instruction-class symbol, form 1; otherwise (or if a
leading `?` forces identifier interpretation, e.g. `?0 POINT`), form 2
— the first token becomes the label for the second, and the second is
the labeled-instruction head.

Syntactically the two forms are identical — `name args...` — so the
grammar does not need to distinguish them. The grammar only needs to
stop *forcing* keyword-role on identifier tokens at the lexer level.

"Instruction-keyword" is a role played by an identifier token at the
**statement head**, not a property of the token itself. In every other
position — arguments, name lists, parameter defaults, labeled-
instruction targets — the same identifier is plain text, free to be
user-defined.

## Non-goals

- Simulating CALM line preprocessors (`calminstruction ?? &line&`).
  Captured as a `line_modifier` prefix already; no change.
- Modeling shadow/restore/purge semantics in the parse tree. That's an
  LSP-layer concern — the grammar only recognises *syntax*, not the
  lookup stack.
- Perfect nested-end resolution. Without semantic info a parser cannot
  always decide which outer block an `end X` closes; we'll document the
  limit and pick a predictable policy.

## Failure taxonomy (40 files)

| Root cause | Count | Representative |
|---|---:|---|
| A. Keyword shadowed in argument position | 3 | `cominvk DDSPrimary,Restore` |
| B. Name decorator `:` / `!` / `?.`-chains on definer | 6 | `macro aarch64.parse_bimm32 x, ec:` ; `calminstruction times?: statement&` |
| C. Catch-all definer head (`?`, `!`, `?!` as name or modifier) | 12 | `calminstruction ? n&` ; whole-file 0:1 errors |
| D. `end X` as a "floating" statement inside a body | 7 | `end namespace` at 3:3 in elf32.inc |
| E. `match` pattern containing special chars | 3 | `match dtail]=,stail, src` ; `match ;comment, line` |
| F. Misc — `iterate <a,b>, …`, `define … ?`, `include file,` | 9 | `define fastcall? fastcall` ; `iterate <fword,dword>, …` |

Phases below target these buckets in priority order (smallest risk × largest recovery first).

---

## Phase 0 — Pre-flight: test scaffolding

Before any grammar edit, add in-tree corpus tests (`test/corpus/*.txt`)
for each phase's target pattern. Tests come first, so every phase's
grammar change has a green/red gate that isn't the 321-file corpus.

New corpus tests:
- `decorators.txt` — `macro F: n`, `struc P?: a,b`, `calminstruction K?!`, `macro end?.struct?!`
- `catchall.txt` — `calminstruction ? n&`, `calminstruction !n&`, `macro ?`
- `esc-and-floating-end.txt` — `esc end struc`, `end namespace` inside a body
- `shadowed-keyword-arg.txt` — `foo bar, Restore, baz` ; `foo Restore,\`
- `match-rough-patterns.txt` — `match dtail]=, src`

Each test expected to FAIL before its phase and PASS after.

Commit: "tree-sitter-fasmg: pre-phase corpus tests (all expected-fail)".

---

## Phase 1 — De-lexicalise instruction keywords

**Target bucket:** A (3 files) — the `Restore,\` / `Restore` in arg
position failures.

**Why first:** smallest mechanical change, biggest conceptual shift,
validates the approach before touching decorators or catch-alls.

**Grammar changes:**
1. Remove `prec(1, …)` wrapper from `keywordToken`. Keep CI matching.
   Each occurrence becomes a plain named token.
2. Promote each instruction keyword to a named rule:
   ```js
   _kw_restore: $ => ciWord("restore"),
   _kw_purge:   $ => ciWord("purge"),
   _kw_macro:   $ => ciWord("macro"),
   // … one per instruction-class keyword
   ```
3. Add `reserved:` global set listing every `_kw_*` rule, plus an
   `unreserved` empty set. Wrap all argument/name_list identifier
   slots in `reserved('unreserved', $.identifier)`:
   - `argument_atom` — the main parameter position
   - `instruction_argument_head` — first-arg
   - `name_list` entries — `restore a,b,c`
   - `parameter.name` — formal parameter names
   - `assignment_statement.name` — LHS of `=` / `equ` / `define`

**Validation:**
- In-tree tests: 5/5 stay green; `shadowed-keyword-arg.txt` flips to green.
- Corpus baseline: 281 → 284 expected (3 ddraw files).

**Risk:** `reserved` + `unreserved` override was brittle in the prior
attempt — ran into "the token must be a rule" errors. Two de-risks:
(i) define tokens as *named rules* (not `token(regex)` returned from a
helper) so `reserved` can reference them by `$._kw_X`, and (ii) build a
minimal proof before applying to every call site — just wrap one rule
first, regenerate, test, then expand.

**Rollback:** single-commit phase; `git revert`.

---

## Phase 2 — Name decorators on definer heads

**Target bucket:** B (6 files).

**Why here:** independent of Phase 1's reserved mechanism; unlocks a
family of failures where the recursive `:` suffix blocks parsing of
otherwise trivial definer lines.

**Grammar changes:**
1. Introduce a `definer_head` helper:
   ```js
   _definer_name: $ => seq(
     field("name", $.symbol_name),
     repeat(field("decorator", choice("?", ":", "!"))),
   ),
   ```
   Note: `?` inside `symbol_name` is already absorbed by the identifier
   regex; the trailing `:` / `!` need to be decorators *outside* the
   name.
2. Rewrite `macro_definition`, `struc_definition`,
   `calminstruction_definition` to use `_definer_name` instead of
   ad-hoc `optional(choice("?", "!"))` tails. This makes the decorator
   alphabet uniform across the family (see
   `fasmg.syntax_notes.md` "Reading the manual").
3. Handle dotted decorator chains like `end?.struct?!`. The dot inside
   the name is already fine; trailing `!` on the final segment falls
   under the decorator rule.

**Validation:**
- `decorators.txt` corpus test flips green.
- Corpus baseline: 284 → 290 expected.

**Risk:** the trailing `:` on a macro name can collide with the
parameter-default `:` syntax (`macro f x:default`). Guard: the
decorator `:` is only recognised when *immediately* followed by
whitespace or newline, i.e. no identifier/value follows. Use
`token.immediate` on the colon-decorator to disambiguate from the
default-value colon.

---

## Phase 3 — Catch-all definer head

**Target bucket:** C (~12 files — many of the 0:1 full-file failures).

**Grammar changes:**
1. Generalise the definer head to allow `?` or `!` *as name* (literal
   catch-all), or as a naked modifier with no name:
   ```js
   _definer_head: $ => choice(
     seq(optional(field("modifier", /[!?]+/)), /* no name */),
     _definer_name_with_decorators,
     seq("?", /* literal name '?' */, optional_params),
   ),
   ```
2. Whitespace sensitivity: `?n&` is invalid but `?!n&` is valid
   (per `fasmg.syntax_notes.md` "Catch-all forms"). Encode this via
   `token.immediate` on the modifier/name boundary.

**Validation:**
- `catchall.txt` and `test_suit/pass/catchall_and_quine.l4gs.g` parse clean.
- Corpus baseline: 290 → ~300 expected.

**Risk:** `?` and `!` are already character operators. The grammar's
existing handling in macro head (`optional("!")` prefix,
`optional(choice("?", "!"))` suffix) is ad-hoc and contradicts this
refactor — remove the ad-hoc fragments at the same time.

---

## Phase 4 — `esc` prefix + floating `end X` in bodies

**Target bucket:** D (7 files).

**Grammar changes:**
1. Add an optional `esc` prefix to `_statement`:
   ```js
   _statement: $ => seq(
     optional(field("line_modifier", $.line_modifier)),
     optional(field("esc", $._kw_esc)),
     choice(/* … existing statement kinds … */),
   ),
   ```
2. Allow `end X` (for any X) to appear as a plain statement inside a
   `block_body`. The greedy innermost `end <kw>` still closes the
   enclosing block (per tree-sitter's longest-match preference). An
   `end X` whose `X` does not match the enclosing block type parses as
   a `free_end_clause` statement — no error.

**Validation:**
- `esc-and-floating-end.txt` passes.
- In-tree tests all green.
- Corpus baseline: 300 → ~307 expected.

**Risk (high):** this is where GLR conflicts explode. We'll likely
need a `conflicts:` entry on `block_body` vs the outer definition's
terminator. If conflict counts balloon, narrow the change — allow
floating `end X` *only* inside macro/struc/calminstruction bodies,
not inside control-flow blocks.

---

## Phase 5 — `match` pattern robustness

**Target bucket:** E (3 files).

**Correct model:** any symbol can appear inside a `match` pattern.
Inside the pattern, `=X` means "literal text `X`" and `=?X` (or
equivalent) makes that literal case-insensitive. The semicolon is
special only because of the global `retaincomments` / `removecomments`
mode — when `retaincomments` is active, `;` inside a pattern is a
regular token, not a comment. The parser has to accept `;` as a
pattern token; whether it should later be re-tokenised is a downstream
mode question.

**Grammar changes:**
1. Widen `match_pattern` to accept an arbitrary sequence of
   `argument`-like atoms plus `=`-prefixed literals (and `=?` for CI
   literals). `]`, `;`, and other characters that aren't otherwise
   special in argument position stay as atoms.
2. Distinguish `match` *statement* (pattern must be structured for a
   top-level `match`) from `match` *block-opener* (pattern is textual
   until the first comma-comma or newline).

**Validation:**
- `match-rough-patterns.txt` passes.
- Corpus baseline: 307 → ~310 expected.

---

## Phase 6 — Miscellanea

**Target bucket:** F (9 files).

Case-by-case — each failure is a distinct small pattern.

Examples:
- `define fastcall? fastcall` at 0:0 — likely the `?` in LHS is
  disallowed. Parameter/name rule needs to accept trailing `?` in the
  assignment LHS.
- `iterate <fword,dword>, …` — paired-variable syntax; the grammar's
  `iterate_block` takes `argument_list` but chokes on the `<>` group.
  Needs explicit `paired_variables` rule.
- `include file, fix.enable head` — the `file,` form is a fasmg
  include directive with flags. Parser currently reads `file` as a
  plain keyword. Add a `file`-flag form.

Each bullet → its own micro-phase with a single-file repro and commit.

---

## Test strategy per phase

1. **Before:** add corpus test(s) under `test/corpus/` that encode the
   phase's new pattern; they must fail against current grammar
   (confirming they reproduce).
2. **Edit:** change `grammar.js`. Keep diffs minimal per phase.
3. **Regenerate:** `scripts/ts.sh generate --js-runtime native`.
4. **In-tree tests:** `scripts/ts.sh test` — must stay green.
5. **Corpus baseline:** `scripts/corpus-baseline.sh` — pass count must
   not regress from the phase's starting point; should meet or beat
   the expected delta.
6. **Commit:** grammar.js + src/grammar.json + src/parser.c +
   baseline/ together, matching the `7f3decf` pattern.

If a phase regresses the baseline, revert and split into smaller
pieces. Every commit is a known-good state.

## Sequencing summary

| Phase | Target | Expected pass count | Risk |
|---|---|---:|---|
| 0 | pre-flight tests | 281 (no change) | low |
| 1 | reserved / unreserved | 284 | medium |
| 2 | definer decorators | 290 | low-medium |
| 3 | catch-all heads | ~300 | medium |
| 4 | esc + floating end | ~307 | **high** |
| 5 | match pattern | ~310 | medium |
| 6 | misc | ~315 | low each |

Headroom: the last ~6 failures are likely genuinely unparseable
without semantic info (e.g. macros that redefine block enders). Document
and move on.

## Memory tie-ins

- `feedback_fasmg_symbol_classes.md` — position-based recognition;
  Phase 1 directly addresses this.
- `feedback_fasmg_nested_keyword_scopes.md` — `esc` and `!`; Phase 3
  and Phase 4.
- `feedback_fasmg_name_decorators_and_stacks.md` — `? : !` alphabet;
  Phase 2 + Phase 3.
- `feedback_fasmg_line_modifier_prefixes.md` — already applied; keep.
