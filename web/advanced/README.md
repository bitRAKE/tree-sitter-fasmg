# `web/advanced` — CodeMirror 6 playground

A second playground that exercises the `tree-sitter-fasmg` grammar as
the backing parser for a CodeMirror 6 editor. The older
`web/playground/` page stays as the dependency-free repro surface; this
one adds a real editor, a vendored CM6 stack, and (in later phases) the
diagnostics / click-sync / folds / locals features that benefit from
sitting in CM6's extension pipeline.

Serve it the same way as `/playground`:

```bash
python -m http.server 8000 --bind 127.0.0.1 --directory .
# then open http://127.0.0.1:8000/web/advanced/
```

## Phase state

- **Phase 1** (landed): vendored CM6 stack, shared `fasmg-web.js`, live
  syntax highlighting via a ViewPlugin that runs `highlights.scm`
  captures against a tree-sitter tree on every edit. No CM6 `Language`
  yet — a bare ViewPlugin + `Decoration.mark` is enough to prove the
  pipeline. Later phases (3+) add the Language adapter when folds,
  locals, and bidirectional click-sync need a real Lezer tree.

Planned phases live in `memory/web_advanced_plan.md` (agent memory) and
get pruned as they land. Short version:

2. CM6 read-only views in all output panels (tree, captures snippets,
   diagnostics snippets, query editable).
3. Diagnostics lint (`ERROR`/`MISSING`) + bidirectional source↔tree
   click-sync. Requires the CM6 Language adapter.
4. Fold gutter driven by `folds.scm`; locals highlight-refs from
   `locals.scm`.
5. Query playground tab.
6. Baseline browser (`baseline/failures.tsv`) + curated samples under
   `web/advanced/samples/`.
7. Spec overlay (cursor → owning group in `spec/keyword-groups.json`).
8. URL hash state, copy buttons, keyboard shortcuts, localStorage.
9. Gated on profiling: `tree-sitter-fasmg-cm6.wasm` emitting Lezer
   TreeBuffers directly.

## Vendored CodeMirror

`web/advanced/vendor/cm6/` holds pinned ESM bundles of every
CM6 / @lezer package we import. `manifest.json` is the source of truth
— version and sha256 per package — and `import-map.json` is regenerated
from it by `scripts/vendor-cm6.py`. The inline `<script type=importmap>`
block in `index.html` mirrors that JSON; slugs are package-name-derived
so version bumps alone don't require touching it.

### The simple route (what this repo uses)

```bash
python scripts/vendor-cm6.py            # verify SHAs, fetch missing
python scripts/vendor-cm6.py --update   # refetch all, refresh SHAs
```

For each package the script hits
`https://esm.sh/{pkg}@{version}?bundle=true&target=es2022&external={shared-deps}`.
esm.sh responds with a one-line stub (`export * from "…/bundle.mjs"`);
the script follows that to the real bundle and writes it to the vendor
directory. Shared deps (`@lezer/common`, `@lezer/highlight`,
`@codemirror/state`, …) stay external so browser module identity is
preserved across packages — the import map routes those bare specifiers
to sibling vendored files. Total download is ~330 KB across six files.

**Why this route**: no local toolchain (just `python3` + stdlib
`urllib`), one command refreshes everything, manifest + SHAs give a
clean provenance trail.

### The control path (not used here, documented for posterity)

An alternative is to write a single `entry.js` that re-exports the
surface we consume from every CM6 / @lezer package, and run

```bash
npx esbuild entry.js --bundle --format=esm --target=es2022 --outfile=web/advanced/vendor/cm6.js
```

to produce one deterministic, locally-built bundle. The import map
collapses to one entry.

**Why you might prefer this path**:

- Bundle contents are fully determined by your `entry.js`, not by
  esm.sh's URL parser — zero risk of an upstream CDN-side change
  silently altering what you ship.
- Tree-shaking against the single entry means you only pay for what
  you re-export, regardless of what the upstream packages happen to
  include.
- Offline bootstrapping works without ever contacting esm.sh — useful
  on air-gapped machines or in CI environments with restricted
  egress.
- Identity and sharing of shared deps like `@lezer/common` is
  enforced by the bundler, not by a `&external=` query-string
  contract.

**Why we don't use it here**: adds a local Node/esbuild dependency
that isn't needed for any other script in this repo, and the current
simple route has been adequate in practice. If we ever hit a case
where esm.sh's output drifts or we want stricter control over what
ships in the bundle, the switchover is mechanical — replace six files
with one, collapse the import map.

## Non-vendored dependency: `web-tree-sitter`

`web-tree-sitter` is still loaded from `tree-sitter.github.io/web-tree-sitter.js`
by `web/shared/fasmg-web.js`. That's a regression from the
"offline-safe" goal and is deliberately out of scope for Phase 1 — the
module also needs a sibling `.wasm` file fetched at runtime, so
vendoring it properly requires handling both. Revisit if it becomes
annoying.

## Layout

```
web/advanced/
├── index.html              # shell + importmap + status pill
├── main.js                 # bootstrap: init runtime, mount EditorView
├── styles.css              # panel chrome + CodeMirror skin + tok- palette
├── cm6/
│   └── highlight.js        # ViewPlugin: tree-sitter captures -> Decorations
├── samples/                # curated fasmg samples (added in Phase 6)
└── vendor/
    ├── manifest.json       # pinned versions + sha256 per package
    ├── import-map.json     # generated; mirrored inline in index.html
    └── cm6/
        ├── codemirror-commands.js
        ├── codemirror-language.js
        ├── codemirror-state.js
        ├── codemirror-view.js
        ├── lezer-common.js
        └── lezer-highlight.js
```
