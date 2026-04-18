# Fixtures

`.l4gs.g` files used to ground the grammar against the **real** fasmg
assembler. Each file isolates one syntactic feature so a rejection by
fasmg or a regression in our parser maps to a single, named cause.

- `pass/` — valid fasmg source. Both fasmg and `tree-sitter-fasmg`
  must accept these.
- `fail/` — invalid fasmg source. Both fasmg and `tree-sitter-fasmg`
  should reject these (the parser may surface an `ERROR` node where
  the failure is syntactic).

For tree-sitter-level corpus tests (parse-tree shape assertions), see
`../corpus/` — those run via `bash scripts/ts.sh test`.

## Naming

`<short_description>.<fasmg-version>.g`

- `<fasmg-version>` tracks the oldest fasmg version the test is known
  to apply to. fasmg does **not** use semver — it prints a freeform
  token after `flat assembler  version g.` (e.g. `l4gs`). Use that
  token verbatim.
- When language behaviour changes in a later release, add a new file
  rather than editing an existing one — the old file documents the
  previous behaviour, and the suffix makes it clear which version it
  targets.

## Verifying against fasmg

The fasmg binary is not bundled. Point your shell at a local build —
the version that produced the current fixtures was `l4gs`:

```bash
fasmg pass/<file>.l4gs.g   # expected: exit 0
fasmg fail/<file>.l4gs.g   # expected: exit ≠ 0
```

A batch runner is intentionally not bundled; downstream tooling that
wants one can iterate `pass/` and `fail/` directly.
