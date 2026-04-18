#!/usr/bin/env bash
# Corpus baseline harness for tree-sitter-fasmg.
#
# Runs the in-repo tree-sitter shim over every .inc/.asm/.alm file
# under the configured corpus roots and emits:
#
#   <out>/results.csv      — path, bytes, status, err_row, err_col,
#                            err_kind, inner_row, inner_col, snippet,
#                            inner_snippet
#   <out>/failures.tsv     — raw CLI failure lines (tab-separated)
#   <out>/raw-summary.json — CLI's --json-summary aggregate block
#   <out>/summary.md       — human-readable rollup (totals, throughput,
#                            failures by dir, failing files)
#
# Paths are reported as forward-slash MSYS paths, prefixed with the
# basename of the corpus root's parent directory (e.g. a file under
# `/c/git/~tgrysztar/fasmg/packages` reports as `fasmg/...`).
#
# Usage:
#   scripts/corpus-baseline.sh [output-dir]
#
# Default output dir: ./baseline (the committed reference). Pass an
# alternate dir to compare without overwriting; the script then prints
# a per-file delta vs ./baseline/results.csv.
#
# Configuration:
#   FASMG_CORPORA — colon-separated MSYS paths to corpus roots
#                   (e.g. "/c/foo/x:/c/bar/y"). Default: Grysztar's
#                   fasmg/packages and fasm2/include on this dev box.
#
# Dependencies: bash, awk, sed, cygpath, python (for the deepest-ERROR
# walk and CSV-aware summary table).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_DIR="${1:-$REPO_ROOT/baseline}"

# Corpora roots — colon-separated MSYS paths via FASMG_CORPORA, or the
# default Grysztar pair on this dev box.
if [[ -n "${FASMG_CORPORA:-}" ]]; then
    IFS=':' read -ra CORPORA <<< "$FASMG_CORPORA"
else
    CORPORA=(
        "/c/git/~tgrysztar/fasmg/packages"
        "/c/git/~tgrysztar/fasm2/include"
    )
fi

for root in "${CORPORA[@]}"; do
    [[ -d "$root" ]] || {
        echo "error: corpus root not found: $root" >&2
        echo "       set FASMG_CORPORA or fix the default in this script" >&2
        exit 2
    }
done

FILE_EXTS=('*.inc' '*.asm' '*.alm')

mkdir -p "$OUT_DIR"

tmp_nix="$(mktemp)"
tmp_win="$(mktemp)"
tmp_out="$(mktemp)"
trap 'rm -f "$tmp_nix" "$tmp_win" "$tmp_out"' EXIT

# --- 1. Gather files ----------------------------------------------------
find_args=()
for ext in "${FILE_EXTS[@]}"; do
    find_args+=(-name "$ext" -o)
done
unset 'find_args[${#find_args[@]}-1]'

find "${CORPORA[@]}" -type f \( "${find_args[@]}" \) 2>/dev/null \
    | sort > "$tmp_nix"
total=$(wc -l < "$tmp_nix")
echo "corpus: $total files" >&2

# --- 2. Convert to Windows paths for the CLI ----------------------------
while IFS= read -r p; do
    cygpath -w "$p"
done < "$tmp_nix" > "$tmp_win"

# --- 3. Invoke tree-sitter ---------------------------------------------
# `--json-summary` is what makes failure lines reliable: plain `--quiet`
# in CLI 0.26.8 silently swallows per-file failure reports when combined
# with `--paths`. `--json-summary` emits tab-separated failure summaries
# plus a trailing JSON block with aggregate stats. The JSON is kept in
# raw output for traceability.
cd "$REPO_ROOT"
paths_arg="$(cygpath -w "$tmp_win")"
parse_start_ns="$(date +%s%N)"
"$REPO_ROOT/scripts/ts.sh" parse --paths "$paths_arg" --json-summary \
    > "$tmp_out" 2>/dev/null || true
parse_end_ns="$(date +%s%N)"
parse_ms=$(( (parse_end_ns - parse_start_ns) / 1000000 ))

# Split CLI output: failure tab lines + trailing JSON block.
json_start=$(awk '/^\{/ { print NR; exit }' "$tmp_out")
if [[ -n "$json_start" ]]; then
    head -n "$((json_start - 1))" "$tmp_out" > "$OUT_DIR/failures.tsv"
    tail -n "+$json_start" "$tmp_out" > "$OUT_DIR/raw-summary.json"
else
    cp "$tmp_out" "$OUT_DIR/failures.tsv"
    : > "$OUT_DIR/raw-summary.json"
fi

# --- 3b. Extract innermost ERROR per failing file ----------------------
# `--json-summary` gives the *outermost* ERROR row:col, often many lines
# before the token that broke the parse. For diagnosis we also want the
# *innermost* ERROR: deepest `(ERROR [r, c] - ...)` node in the S-exp.
# One re-parse per failing file (no --quiet so the S-exp reaches stdout),
# then a short Python walks the lines and keeps the deepest-indented
# match.
inner_idx="$OUT_DIR/.inner.idx"
: > "$inner_idx"
awk -F'\t' '{
    path = $1
    sub(/[ ]+$/, "", path)
    if (path != "") print path
}' "$OUT_DIR/failures.tsv" | while IFS= read -r winpath; do
    [[ -z "$winpath" ]] && continue
    sexp="$("$REPO_ROOT/scripts/ts.sh" parse "$winpath" 2>/dev/null || true)"
    inner="$(printf '%s\n' "$sexp" | python -c '
import sys, re
pat = re.compile(r"^( *)\(ERROR \[(\d+), (\d+)\]")
best = (-1, None, None)
for line in sys.stdin:
    m = pat.match(line)
    if m:
        depth = len(m.group(1))
        if depth > best[0]:
            best = (depth, m.group(2), m.group(3))
if best[1] is not None:
    print(f"{best[1]}\t{best[2]}")
' || true)"
    if [[ -n "$inner" ]]; then
        # Literal-backslash safety: printf, not awk -v (which escape-
        # expands the path).
        printf '%s\t%s\n' "$winpath" "$inner" >> "$inner_idx"
    fi
done

# --- 4. Build results.csv ----------------------------------------------
# Tag-prefix the report path with the basename of the corpus root's
# parent directory.
results_csv="$OUT_DIR/results.csv"
{
    echo "path,bytes,status,err_row,err_col,err_kind,inner_row,inner_col,snippet,inner_snippet"

    # Build an awk index: windows_path -> "kind\trow\tcol".
    # CLI line shape (one per failing file):
    #   <winpath>[padding]\tParse: <ms> ms\t<speed>\t(ERROR [r, c] - [r2, c2])
    #   <winpath>[padding]\tParse: <ms> ms\t<speed>\t(MISSING <kind> [r, c] - [r2, c2])
    awk -F'\t' '
        {
            path = $1
            sub(/[ ]+$/, "", path)
            tail = $NF
            if (match(tail, /\(ERROR \[([0-9]+), ([0-9]+)\]/, m)) {
                print path "\tERROR\t" m[1] "\t" m[2]
            } else if (match(tail, /\(MISSING [^ ]+ \[([0-9]+), ([0-9]+)\]/, m)) {
                print path "\tMISSING\t" m[1] "\t" m[2]
            } else if (match(tail, /\(MISSING \[([0-9]+), ([0-9]+)\]/, m)) {
                print path "\tMISSING\t" m[1] "\t" m[2]
            }
        }
    ' "$OUT_DIR/failures.tsv" > "$OUT_DIR/.fail.idx"

    while IFS= read -r nixpath; do
        winpath="$(cygpath -w "$nixpath")"
        bytes="$(wc -c < "$nixpath" 2>/dev/null || echo 0)"
        report_path="$nixpath"
        for root in "${CORPORA[@]}"; do
            case "$nixpath" in
                "$root"/*)
                    rel="${nixpath#"$root"/}"
                    tag="$(basename "$(dirname "$root")")"
                    report_path="$tag/$rel"
                    break
                    ;;
            esac
        done

        # `grep -F` treats the pattern literally so backslashes in the
        # path are not interpreted (unlike awk's `-v`, which silently
        # escape-expands them and corrupts the key).
        fail_line="$(grep -F -m 1 -- "${winpath}"$'\t' "$OUT_DIR/.fail.idx" || true)"
        if [[ -n "$fail_line" ]]; then
            IFS=$'\t' read -r _ kind row col <<<"$fail_line"
            inner_line="$(grep -F -m 1 -- "${winpath}"$'\t' "$inner_idx" || true)"
            if [[ -n "$inner_line" ]]; then
                IFS=$'\t' read -r _ inner_row inner_col <<<"$inner_line"
            else
                inner_row="$row"; inner_col="$col"
            fi
            snippet="$(sed -n "$((row + 1))p" "$nixpath" 2>/dev/null \
                | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//' \
                | cut -c1-80)"
            inner_snippet="$(sed -n "$((inner_row + 1))p" "$nixpath" 2>/dev/null \
                | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//' \
                | cut -c1-80)"
            csv_escape() {
                local s="$1"
                if [[ "$s" == *,* || "$s" == *'"'* ]]; then
                    printf '"%s"' "${s//\"/\"\"}"
                else
                    printf '%s' "$s"
                fi
            }
            snippet_csv="$(csv_escape "$snippet")"
            inner_snippet_csv="$(csv_escape "$inner_snippet")"
            echo "$report_path,$bytes,fail,$row,$col,$kind,$inner_row,$inner_col,$snippet_csv,$inner_snippet_csv"
        else
            echo "$report_path,$bytes,ok,,,,,,,"
        fi
    done < "$tmp_nix"
} > "$results_csv"
rm -f "$OUT_DIR/.fail.idx" "$inner_idx"

# --- 5. Summary ---------------------------------------------------------
pass_count=$(awk -F, 'NR>1 && $3=="ok"  { c++ } END { print c+0 }' "$results_csv")
fail_count=$(awk -F, 'NR>1 && $3!="ok" { c++ } END { print c+0 }' "$results_csv")
total_count=$((pass_count + fail_count))
total_bytes=$(awk -F, 'NR>1 { b += $2 } END { print b+0 }' "$results_csv")

if (( parse_ms > 0 )); then
    bytes_per_ms=$(awk -v b="$total_bytes" -v m="$parse_ms" 'BEGIN { printf "%.0f", b/m }')
else
    bytes_per_ms="n/a"
fi

{
    echo "# tree-sitter-fasmg corpus baseline"
    echo
    echo "_Generated by \`scripts/corpus-baseline.sh\` on $(date -Iseconds)._"
    echo "_tree-sitter CLI: $("$REPO_ROOT/scripts/ts.sh" --version)_"
    echo
    echo "## Totals"
    echo
    printf "| metric | value |\n| --- | ---: |\n"
    printf "| total files | %d |\n" "$total_count"
    printf "| pass | %d |\n" "$pass_count"
    printf "| fail | %d |\n" "$fail_count"
    if (( total_count > 0 )); then
        pct=$(awk -v p="$pass_count" -v t="$total_count" 'BEGIN { printf "%.2f", (p*100)/t }')
        printf "| pass %% | %s |\n" "$pct"
    fi
    printf "| total bytes | %d |\n" "$total_bytes"
    printf "| parse time (ms) | %d |\n" "$parse_ms"
    printf "| throughput (bytes/ms) | %s |\n" "$bytes_per_ms"
    echo

    echo "## Corpora"
    echo
    for root in "${CORPORA[@]}"; do
        echo "- \`$root\`"
    done
    echo

    echo "## Failures by top-level corpus directory"
    echo
    printf "| dir | fail | total | pass %% |\n| --- | ---: | ---: | ---: |\n"
    awk -F, 'NR>1 {
        n = split($1, parts, "/")
        if (n >= 2) dir = parts[1] "/" parts[2]; else dir = parts[1]
        tot[dir]++
        if ($3!="ok") fail[dir]++
    }
    END {
        for (d in tot) {
            f = (d in fail ? fail[d] : 0)
            pct = (tot[d] > 0 ? (tot[d]-f)*100/tot[d] : 0)
            printf "%s\t%d\t%d\t%.1f\n", d, f, tot[d], pct
        }
    }' "$results_csv" \
        | sort -t$'\t' -k2,2nr -k3,3nr \
        | awk -F'\t' '{ printf "| %s | %s | %s | %s |\n", $1, $2, $3, $4 }'
    echo

    echo "## Failing files (all, sorted by path)"
    echo
    echo "\`outer\` = outermost ERROR span start (often an enclosing block's first line); \`inner\` = deepest nested ERROR (usually where the parse actually broke)."
    echo
    printf "| path | outer | inner | kind | snippet at inner row |\n| --- | ---: | ---: | :--- | :--- |\n"
    python -c '
import csv, sys
with open(sys.argv[1], newline="") as f:
    rows = [r for r in csv.DictReader(f) if r["status"] == "fail"]
rows.sort(key=lambda r: r["path"])
for r in rows:
    snip = (r.get("inner_snippet") or r.get("snippet") or "").replace("|", "\\|")
    path = r["path"]
    kind = r["err_kind"]
    er = r["err_row"]
    ec = r["err_col"]
    ir = r.get("inner_row") or er
    ic = r.get("inner_col") or ec
    print("| " + path + " | " + er + ":" + ec + " | " + ir + ":" + ic + " | " + kind + " | `" + snip + "` |")
' "$results_csv"
    echo
} > "$OUT_DIR/summary.md"

echo "wrote:"
echo "  $OUT_DIR/results.csv"
echo "  $OUT_DIR/failures.tsv"
echo "  $OUT_DIR/summary.md"
echo "pass=$pass_count fail=$fail_count total=$total_count parse_ms=$parse_ms"

# --- 6. Delta vs committed baseline -------------------------------------
# Per-file delta vs ./baseline/results.csv — totals can hide identity
# swaps (one file flips to passing, another to failing, net zero).
REF_CSV="$REPO_ROOT/baseline/results.csv"
if [[ -f "$REF_CSV" && "$OUT_DIR" != "$REPO_ROOT/baseline" ]]; then
    fixed=$(diff \
        <(awk -F, 'NR>1 {print $1","$3}' "$REF_CSV" | sort) \
        <(awk -F, 'NR>1 {print $1","$3}' "$results_csv" | sort) \
        | awk '/^> / && /,ok$/ { sub(/^> /, ""); sub(/,ok$/, ""); print }' || true)
    broken=$(diff \
        <(awk -F, 'NR>1 {print $1","$3}' "$REF_CSV" | sort) \
        <(awk -F, 'NR>1 {print $1","$3}' "$results_csv" | sort) \
        | awk '/^> / && /,fail$/ { sub(/^> /, ""); sub(/,fail$/, ""); print }' || true)
    fixed_n=$(printf '%s' "$fixed"  | awk 'NF' | wc -l)
    broken_n=$(printf '%s' "$broken" | awk 'NF' | wc -l)
    echo "delta vs baseline/: fixed=$fixed_n regressed=$broken_n"
    if [[ -n "$fixed" ]]; then
        echo "  fixed:"
        printf '%s\n' "$fixed" | awk 'NF { print "    + " $0 }'
    fi
    if [[ -n "$broken" ]]; then
        echo "  regressed:"
        printf '%s\n' "$broken" | awk 'NF { print "    - " $0 }'
    fi
fi
