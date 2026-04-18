#!/usr/bin/env python3
"""Vendor CodeMirror 6 and @lezer/* as offline-safe ESM modules.

Reads web/advanced/vendor/manifest.json, fetches each pinned package as a
bundled ESM module from esm.sh (shared deps stay external so browser
module identity is preserved across packages), verifies SHA256 against the
manifest, and regenerates import-map.json.

Usage:
    python scripts/vendor-cm6.py            # verify + fetch missing
    python scripts/vendor-cm6.py --update   # refetch all, update SHAs

The import map in web/advanced/vendor/import-map.json is served alongside
the vendored files and referenced by web/advanced/index.html; it resolves
the bare specifiers the external-bundled files still emit.

Control-path alternative (see web/advanced/README.md):
    Build CM6 locally via esbuild against a single entry re-export. Gives
    end-to-end control and a deterministic single-file bundle, at the cost
    of a local toolchain dependency. esm.sh is used here for simplicity.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = ROOT / "web" / "advanced" / "vendor" / "manifest.json"
VENDOR_DIR = ROOT / "web" / "advanced" / "vendor" / "cm6"
IMPORT_MAP_PATH = ROOT / "web" / "advanced" / "vendor" / "import-map.json"


def slug(pkg: str) -> str:
    return pkg.lstrip("@").replace("/", "-")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fetch(url: str) -> bytes:
    req = urllib.request.Request(
        url, headers={"User-Agent": "tree-sitter-fasmg vendor-cm6"}
    )
    with urllib.request.urlopen(req) as resp:
        return resp.read()


def build_stub_url(
    upstream: str, pkg: str, version: str, target: str, external: list[str]
) -> str:
    url = f"{upstream}/{pkg}@{version}?bundle=true&target={target}"
    if external:
        url += f"&external={','.join(external)}"
    return url


def fetch_bundle(upstream: str, stub_url: str) -> bytes:
    """Resolve esm.sh's two-hop response: the first URL returns a small
    `export * from "<real-bundle-url>"` stub; the real bundle is at the
    resolved URL. We follow once and save the real bundle. The real bundle
    still contains bare-specifier imports for externals, which the page's
    import map resolves to sibling vendored files."""
    stub = fetch(stub_url).decode("utf-8")
    match = re.search(r'''from\s+["']([^"']+)["']''', stub)
    if not match:
        raise RuntimeError(f"no bundle URL in stub:\n{stub[:200]}")
    bundle_url = urllib.parse.urljoin(stub_url, match.group(1))
    return fetch(bundle_url)


def write_import_map(manifest: dict) -> None:
    imports = {pkg: f"./cm6/{slug(pkg)}.js" for pkg in manifest["packages"]}
    IMPORT_MAP_PATH.write_text(
        json.dumps({"imports": imports}, indent=2) + "\n", encoding="utf-8"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--update",
        action="store_true",
        help="Refetch all packages and update manifest SHAs",
    )
    args = parser.parse_args()

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    upstream = manifest.get("upstream", "https://esm.sh")
    target = manifest.get("target", "es2022")
    VENDOR_DIR.mkdir(parents=True, exist_ok=True)

    failed = False
    manifest_dirty = False

    for pkg, config in manifest["packages"].items():
        version = config["version"]
        external = config.get("external", [])
        expected = config.get("sha256")
        out = VENDOR_DIR / f"{slug(pkg)}.js"

        if not args.update and out.exists() and expected:
            actual = sha256(out.read_bytes())
            if actual == expected:
                print(f"ok    {pkg}@{version}")
                continue
            print(
                f"stale {pkg}: sha mismatch ({actual[:12]} != {expected[:12]})",
                file=sys.stderr,
            )

        stub_url = build_stub_url(upstream, pkg, version, target, external)
        print(f"fetch {pkg}@{version}")
        print(f"      {stub_url}")
        try:
            data = fetch_bundle(upstream, stub_url)
        except Exception as exc:
            print(f"fail  {pkg}: {exc}", file=sys.stderr)
            failed = True
            continue

        actual = sha256(data)
        print(f"      sha256={actual}")

        if expected and not args.update and actual != expected:
            print(
                f"fail  {pkg} sha256 mismatch (expected {expected})",
                file=sys.stderr,
            )
            failed = True
            continue

        out.write_bytes(data)
        if args.update or not expected:
            config["sha256"] = actual
            manifest_dirty = True

    if manifest_dirty:
        MANIFEST_PATH.write_text(
            json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
        )

    write_import_map(manifest)
    print(f"done  wrote {IMPORT_MAP_PATH.relative_to(ROOT)}")

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
