// Sample catalogue loader.
//
// Reads `web/advanced/samples.json`, which is the source of truth for
// the set of fasmg samples the playground exposes. Each entry is one
// of:
//
//   { label, source: "local",  path, note }
//   { label, source: "remote", url, note, sha? }
//
// `path` is fetched relative to this module. `url` is fetched
// verbatim (raw.githubusercontent.com serves with
// Access-Control-Allow-Origin: *, so browser fetches from localhost
// work). Remote entries cache the last successful fetch in
// localStorage so offline-after-first-load still hydrates — if the
// network refresh fails we fall back to the cached copy and surface
// "(cached, failed to refresh)" via the status callback.

const CACHE_PREFIX = "fasmg-advanced-sample-cache-v1:";

export async function loadSampleManifest() {
  const url = new URL("./samples.json", import.meta.url);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to load samples.json: ${response.status}`);
  }
  return response.json();
}

export async function loadSample(entry) {
  if (entry.source === "local") {
    const url = new URL(entry.path, import.meta.url);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`failed to load ${entry.path}: ${response.status}`);
    }
    return { text: await response.text(), from: "local" };
  }

  if (entry.source === "remote") {
    const cacheKey = CACHE_PREFIX + entry.url;
    try {
      const response = await fetch(entry.url, { cache: "no-cache" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const text = await response.text();
      try {
        localStorage.setItem(cacheKey, text);
      } catch {
        // best-effort cache
      }
      return { text, from: "remote" };
    } catch (error) {
      let cached = null;
      try {
        cached = localStorage.getItem(cacheKey);
      } catch {
        // ignore
      }
      if (cached != null) {
        return {
          text: cached,
          from: "cache",
          warning: `fetch failed (${error.message}); loaded cached copy`,
        };
      }
      throw error;
    }
  }

  throw new Error(`unknown sample source: ${entry.source}`);
}
