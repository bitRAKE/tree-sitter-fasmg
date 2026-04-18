# `web/advanced` — CodeMirror 6 playground

A browser playground that exercises the `tree-sitter-fasmg` grammar as
the backing parser for a CodeMirror 6 editor. Live highlighting,
folding, lint markers, bidirectional source↔tree selection sync,
ad-hoc queries, a baseline browser, contextual feedback at the caret,
and shareable URLs.

The older `web/playground/` page stays as the dependency-free repro
surface — useful when you want to rule out CM6 as the cause of
something weird.

## Serving

```bash
python -m http.server 8000 --bind 127.0.0.1 --directory .
# then open http://127.0.0.1:8000/web/advanced/
```

An HTTP origin is required — the page fetches the grammar WASM, the
`.scm` query files, and `spec/keyword-groups.json` over `fetch()`,
which won't work from a `file://` URL.

## Diagnostic workflow

The UI is deliberately busy so it can answer different questions
without mode-switching. Here's which surface answers which question:

| I want to know… | Look at | How |
| --- | --- | --- |
| *does my file parse cleanly?* | Source editor + Diagnostics tab | Red lint markers in the gutter + red underlines in the source mark ERROR/MISSING. Click a row in the Diagnostics tab to jump to the location. |
| *what shape does the grammar give my code?* | Tree tab | Click anywhere in the Source; the Tree scrolls and highlights the innermost enclosing node. Click in the Tree; the Source selection jumps to the corresponding range. |
| *what's this keyword?* | Context pill (topbar) + Context tab | Move the caret over a token. The pill shows a summary (e.g., "mov: otherDirectives"); the Context tab expands to the tree node, enclosing blocks, and any enclosing `calminstruction` parameter list. |
| *why isn't my highlight query colouring X?* | Query tab + Captures tab | Edit `highlights.scm` live on the Query tab. The Captures tab lists every match with range + text; click a row to jump the Source selection to that capture. |
| *does a hypothetical query work?* | Ad-hoc tab + Ad-hoc captures tab | Independent query editor; doesn't touch Source decorations. Compile errors surface as a red pill at the top of the Ad-hoc captures panel. |
| *what does a real-world file look like?* | Samples dropdown (topbar) | Pick a curated sample from `samples.json`. Remote entries fetch from `raw.githubusercontent.com` and cache in localStorage for offline-after-first-load. |
| *which corpus files currently break the grammar?* | Baseline tab | Reads `baseline/failures.tsv`. Click **Load** on any row to fetch the remote equivalent and jump the caret to the recorded error position. |
| *every identifier with this name* | Source editor | Put the caret on an identifier — every other `@local.reference`/`@local.definition` with the same text gets a dashed underline. Scope hierarchy is intentionally not honoured; that's `fasmg_lsp`'s job. |
| *share a repro with someone* | Share button (topbar) | Encodes `{source, query, ad-hoc}` into the URL hash and copies the full URL to clipboard. Opening the URL restores the state. |
| *start over* | Clear button (topbar) | Clears every `fasmg-advanced-*` localStorage key plus the URL hash and reloads with defaults. |

Shortcut heuristic: if you can see the answer in a pill or panel
without running anything, try that first. Then edit the Query or
Ad-hoc to test a hypothesis, then Share if you want someone else to
reproduce.

## Tour of the panels

**Left pane — editors**

- **Source** — fasmg source. Live highlighting via `highlights.scm`.
  Lint markers for ERROR / MISSING / query-error. Fold gutter for
  macro / calm / if / while / iterate / repeat / match / virtual /
  postpone / irp / namespace / struc blocks. Ctrl+Z / Ctrl+Y undo.
- **Query** — `highlights.scm`. Edits retarget the Source decorations
  live. **Reset Query** in the topbar restores the committed version.
- **Ad-hoc** — scratch query editor, independent of Source
  decorations. Useful for experiments without touching the canonical
  query.

**Right pane — outputs**

- **Tree** — pretty-printed S-expression of the current parse.
  Read-only, with its own highlighting via the sexp Lezer grammar.
  Click-sync with Source is bidirectional.
- **Captures** — every match from the current highlight query, with
  range and text. Click to jump the Source selection.
- **Diagnostics** — ERROR / MISSING nodes and query-error rows. Each
  row is clickable and jumps the Source caret to the problem.
- **Ad-hoc** — captures from the Ad-hoc query editor. Query compile
  errors surface here as a red pill.
- **Context** — detailed version of the Context pill: tree node,
  keyword-group membership, enclosing blocks innermost-first, and
  the calminstruction scope when the caret is inside one.
- **Baseline** — table of corpus files that currently fail to parse
  cleanly (from `baseline/failures.tsv`). Each row has a Load button
  that fetches the remote equivalent and jumps to the error.
- **Runtime** — loader status and one-line diagnostic log. Mostly
  useful when something fails during bootstrap.

**Topbar**

- **Load sample** dropdown — populated from `samples.json`.
- **Reset Query** — restore committed `highlights.scm` in the Query
  editor.
- **Share** — encode state in URL hash, copy to clipboard.
- **Clear** — wipe localStorage and reload defaults.
- Status pills: parse time, capture count, syntax status, query
  status, Context summary, runtime state.

## Performance notes

For context: on the largest fasmg file in a typical corpus, the
parse cycle is ~26 ms — well under a frame budget. The playground
currently runs three parses per edit (the highlight pipeline, the
CM6 Language adapter, and the tree-string builder); the cost is
absorbed by the microtask scheduler without perceptible lag.

If you run into a file where that changes, a few knobs exist:

- Consolidate the three parses into one, sharing the tree-sitter
  tree between the Language adapter, highlight pipeline, and
  tree-string builder (a refactor, not a new feature).
- Skip the tree-string rebuild when the source is unchanged (already
  partially done — see `lastTreeString` in `main.js`).
- Skip the Language adapter's parse for unfocused surfaces.

A previously-considered "emit Lezer TreeBuffer directly from a
custom WASM" milestone is **not on the table**; the JS tree walk
isn't the bottleneck. Left as a possible comparison exercise only.

## Vendored CodeMirror

`web/advanced/vendor/cm6/` holds pinned ESM bundles of every
CM6 / @lezer package we import. `manifest.json` is the source of
truth — version and sha256 per package — and `import-map.json` is
regenerated from it by `scripts/vendor-cm6.py`. The inline
`<script type=importmap>` block in `index.html` mirrors that JSON;
slugs are package-name-derived so version bumps alone don't require
touching it.

### The simple route (what this repo uses)

```bash
python scripts/vendor-cm6.py            # verify SHAs, fetch missing
python scripts/vendor-cm6.py --update   # refetch all, refresh SHAs
```

For each package the script hits
`https://esm.sh/{pkg}@{version}?bundle=true&target=es2022&external={shared-deps}`.
esm.sh responds with a one-line stub (`export * from "…/bundle.mjs"`);
the script follows that to the real bundle and writes it to the
vendor directory. Shared deps (`@lezer/common`, `@lezer/highlight`,
`@codemirror/state`, …) stay external so browser module identity is
preserved across packages — the import map routes those bare
specifiers to sibling vendored files.

### The control path (not used here, documented for posterity)

An alternative is to write a single `entry.js` that re-exports the
surface we consume from every CM6 / @lezer package and run

```bash
npx esbuild entry.js --bundle --format=esm --target=es2022 --outfile=web/advanced/vendor/cm6.js
```

to produce one deterministic, locally-built bundle. Why you might
prefer this path: bundle contents are fully determined by your
`entry.js` (no risk of an esm.sh-side change silently altering what
you ship), tree-shaking against the single entry is tighter, offline
bootstrapping works without ever contacting esm.sh, and shared-dep
identity is enforced by the bundler rather than by an `&external=`
query string. Why we don't: adds a local Node/esbuild dependency
that isn't needed for any other script in this repo.

## Non-vendored dependency: `web-tree-sitter`

`web-tree-sitter` is still loaded from
`tree-sitter.github.io/web-tree-sitter.js` by
`web/shared/fasmg-web.js`. The module fetches a sibling `.wasm` at
runtime, so vendoring it properly requires handling both. Revisit if
it becomes annoying.

## Layout

```
web/advanced/
├── index.html              # shell + importmap + topbar + tabbed panes
├── main.js                 # bootstrap + parse orchestration + panel rendering
├── styles.css              # panel chrome + CodeMirror skin + tok- palette
├── samples.js              # sample manifest + local/remote loader
├── samples.json            # catalogue of curated samples
├── baseline.js             # parse failures.tsv + remote URL mapping
├── cm6/
│   ├── language.js         # tree-sitter → Lezer Tree adapter + LanguageSupport
│   ├── sexp-language.js    # hand-written Lezer parser for TS S-expressions
│   ├── highlight.js        # ViewPlugin: captures → Decorations
│   ├── diagnostics.js      # parse diagnostics → @codemirror/lint
│   ├── locals.js           # locals.scm → name->ranges highlight
│   ├── context.js          # cursor → {keyword group, blocks, CALM scope}
│   └── tree-string.js      # pretty-print tree + span map for click-sync
├── samples/                # curated fasmg samples (user-editable)
└── vendor/
    ├── manifest.json       # pinned versions + sha256 per package
    ├── import-map.json     # generated; mirrored inline in index.html
    └── cm6/
        ├── codemirror-commands.js
        ├── codemirror-language.js
        ├── codemirror-lint.js
        ├── codemirror-state.js
        ├── codemirror-view.js
        ├── lezer-common.js
        └── lezer-highlight.js
```

## `web/playground` vs `web/advanced` — which to open?

| If you want… | Use |
| --- | --- |
| A minimal reproducer of a grammar / query issue | `/playground` |
| To look at the syntax tree, run ad-hoc queries, load corpus files, navigate via click-sync, or share a repro URL | `/advanced` |

`/playground` intentionally has **no** npm / CM6 / bundler surface,
so a bug reproduced there is unambiguously a grammar or
`highlights.scm` issue. `/advanced` adds convenience at the cost of
more moving parts.
