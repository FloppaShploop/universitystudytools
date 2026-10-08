// Shared, browser-safe URL encoding for the proxy.
// Scheme: /api/public/p/<proto>/<host[:port]>/<path>?<query>
// Path-style encoding means relative URLs inside proxied pages resolve naturally.
export const PROXY_PREFIX = "/api/public/p/";

export function toProxyPath(abs: string | URL): string {
  const u = typeof abs === "string" ? new URL(abs) : abs;
  const proto = u.protocol.slice(0, -1).toLowerCase();
  return `${PROXY_PREFIX}${proto}/${u.host}${u.pathname}${u.search}${u.hash}`;
}

export function fromProxyPath(pathAndSearch: string): URL | null {
  if (!pathAndSearch.startsWith(PROXY_PREFIX)) return null;
  const rest = pathAndSearch.slice(PROXY_PREFIX.length);
  const m = rest.match(/^(https?|wss?)\/([^/?#]+)(.*)$/i);
  if (!m) return null;
  try {
    let tail = m[3] || "/";
    if (!tail.startsWith("/")) tail = "/" + tail;
    return new URL(`${(m[1] ?? "").toLowerCase()}://${m[2]}${tail}`);
  } catch {
    return null;
  }
}

/** Turn whatever the user typed into an absolute http(s) URL, or a search. */
export function normalizeUserInput(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) {
    try {
      return new URL(s).href;
    } catch {
      return null;
    }
  }
  if (!/\s/.test(s) && /^[^/]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(s)) {
    try {
      return new URL("https://" + s).href;
    } catch {
      return null;
    }
  }
  return "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(s);
}
