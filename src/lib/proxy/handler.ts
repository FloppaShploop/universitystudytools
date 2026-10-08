import { acquire, stats, takeToken } from "./limits";
import { rewriteCss, rewriteHtml, rewriteJs, rewriteM3u8, rewriteMpd, rewriteSetCookie } from "./rewrite";
import { buildRuntime } from "./runtime";
import { LIMITS, assertPublicDns, validateTarget } from "./security";
import { fromProxyPath, toProxyPath } from "./url";

class ProxyError extends Error {
  constructor(public status: number, public title: string, public detail: string) {
    super(title);
  }
}

const FORWARD_REQ = [
  "accept", "accept-language", "range", "if-none-match", "if-modified-since", "if-range",
  "if-match", "content-type", "cache-control", "pragma", "user-agent", "x-requested-with",
  "authorization", "cookie", "dnt", "content-encoding", "sec-websocket-key", "sec-websocket-version",
  "sec-websocket-protocol", "sec-websocket-extensions",
];
const FORWARD_RES = [
  "content-type", "content-length", "content-range", "accept-ranges", "cache-control", "etag",
  "last-modified", "expires", "vary", "content-disposition", "content-language", "age", "date",
  "timing-allow-origin",
];

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "x-proxy": "lovable-gateway",
  // Everything a proxied page loads must come back through the proxy (no leaks).
  "content-security-policy":
    "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: mediastream:; frame-ancestors 'self'; form-action 'self'; base-uri 'self'",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), usb=(), payment=()",
};

export function errorPage(status: number, title: string, detail: string, target?: string) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }) as Record<string,string>)[c] ?? c);
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.6 ui-sans-serif,system-ui,sans-serif;background:Canvas;color:CanvasText}
main{max-width:520px;padding:32px}code{font:13px ui-monospace,monospace;opacity:.7;word-break:break-all}.s{font:700 64px ui-monospace,monospace;opacity:.25;margin:0}h1{margin:.2em 0;font-size:22px}p{opacity:.8}</style></head>
<body><main><p class="s">${status}</p><h1>${esc(title)}</h1><p>${esc(detail)}</p>${target ? `<code>${esc(target)}</code>` : ""}</main>
<script>try{parent.postMessage({__proxy:1,type:'error',status:${status},title:${JSON.stringify(title)}},location.origin)}catch(e){}</script></body></html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...SECURITY_HEADERS },
  });
}

function clientId(req: Request) {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "anon"
  );
}

function log(entry: Record<string, unknown>) {
  console.log(JSON.stringify({ t: "proxy", at: new Date().toISOString(), ...entry }));
}

async function readCapped(body: ReadableStream<Uint8Array>, cap: number): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > cap) {
      await reader.cancel();
      throw new ProxyError(502, "Response too large", "The page exceeded the proxy's size limit for rewritable documents.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

function decode(bytes: Uint8Array, contentType: string) {
  const cs = /charset=([^;]+)/i.exec(contentType)?.[1]?.trim().replace(/"/g, "") || "utf-8";
  try {
    return new TextDecoder(cs).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

type Kind = "html" | "css" | "js" | "m3u8" | "mpd" | "raw";
function classify(ct: string, path: string): Kind {
  const c = ct.toLowerCase();
  if (c.includes("text/html") || c.includes("application/xhtml")) return "html";
  if (c.includes("text/css")) return "css";
  if (c.includes("mpegurl") || /\.m3u8$/i.test(path)) return "m3u8";
  if (c.includes("dash+xml") || /\.mpd$/i.test(path)) return "mpd";
  if (c.includes("javascript") || c.includes("ecmascript")) return "js";
  return "raw";
}

function isCacheable(res: Response) {
  const cc = (res.headers.get("cache-control") || "").toLowerCase();
  if (res.status !== 200 || res.headers.has("set-cookie")) return false;
  if (/no-store|private|no-cache/.test(cc)) return false;
  if (!/max-age=\d*[1-9]|s-maxage=\d*[1-9]|public/.test(cc)) return false;
  const len = Number(res.headers.get("content-length") || "-1");
  return len > 0 && len <= LIMITS.cacheMaxBytes;
}

function edgeCache(): Cache | null {
  try {
    const c = (globalThis as unknown as { caches?: { default?: Cache } }).caches;
    return c?.default ?? null;
  } catch {
    return null;
  }
}

export async function handleProxy(request: Request): Promise<Response> {
  const started = Date.now();
  const reqUrl = new URL(request.url);
  const client = clientId(request);
  const method = request.method.toUpperCase();
  stats.total++;
  let release: (() => void) | null = null;
  let target: URL | null = null;

  try {
    if (method === "TRACE" || method === "CONNECT" || method === "TRACK")
      throw new ProxyError(405, "Method not allowed", `${method} requests are not proxied.`);

    // Open-proxy / hotlink abuse: only our own app (or direct navigation) may use the gateway.
    if (request.headers.get("sec-fetch-site") === "cross-site")
      throw new ProxyError(403, "Cross-site use blocked", "This gateway can only be used from its own interface.");

    const rl = takeToken(client);
    if (!rl.ok) {
      stats.blocked++;
      const r = errorPage(429, "Slow down", "Too many requests from your connection. Try again in a moment.");
      r.headers.set("retry-after", String(rl.retryAfter));
      return r;
    }

    target = fromProxyPath(reqUrl.pathname + reqUrl.search);
    if (!target) throw new ProxyError(400, "Invalid address", "That proxy URL couldn't be understood.");

    const isWs =
      target.protocol === "ws:" || target.protocol === "wss:" ||
      (request.headers.get("upgrade") || "").toLowerCase() === "websocket";
    if (target.protocol === "ws:") target.protocol = "http:";
    if (target.protocol === "wss:") target.protocol = "https:";

    const v = validateTarget(target);
    if (!v.ok) {
      stats.blocked++;
      throw new ProxyError(403, "Destination blocked", v.reason);
    }
    const dns = await assertPublicDns(target.hostname);
    if (!dns.ok) {
      stats.blocked++;
      throw new ProxyError(403, "Destination blocked", dns.reason);
    }

    const len = Number(request.headers.get("content-length") || "0");
    if (len > LIMITS.maxRequestBody)
      throw new ProxyError(413, "Upload too large", "Request bodies are limited to 10 MB.");

    release = acquire(client);
    if (!release) {
      stats.blocked++;
      throw new ProxyError(503, "Gateway busy", "Too many simultaneous requests. Please retry shortly.");
    }

    // ---- build upstream request ----
    const headers = new Headers();
    for (const h of FORWARD_REQ) {
      const val = request.headers.get(h);
      if (val) headers.set(h, val);
    }
    // Site-specific API headers (e.g. x-goog-api-key, x-youtube-client-version) are required by many apps.
    request.headers.forEach((val, k) => {
      if (/^x-/i.test(k) && !/^x-(forwarded|real-ip|proxy|lovable)/i.test(k)) headers.set(k, val);
    });
    headers.set("accept-encoding", "gzip, deflate, br");
    const ref = request.headers.get("referer");
    let refTarget: URL | null = null;
    if (ref) {
      try {
        const r = new URL(ref);
        if (r.origin === reqUrl.origin) refTarget = fromProxyPath(r.pathname + r.search);
      } catch {
        /* ignore */
      }
    }
    if (refTarget) headers.set("referer", refTarget.href);
    if (request.headers.has("origin")) headers.set("origin", (refTarget ?? target).origin);
    if (isWs) {
      headers.set("upgrade", "websocket");
      headers.set("connection", "Upgrade");
    }

    const isGet = method === "GET" || method === "HEAD";
    const cache = edgeCache();
    const cacheKey = new Request(target.href, { method: "GET" });
    const canUseCache = !!cache && method === "GET" && !headers.has("range") && !headers.has("cookie") && !headers.has("authorization") && !isWs;
    if (canUseCache) {
      const hit = await cache!.match(cacheKey).catch(() => undefined);
      if (hit) {
        stats.cacheHits++;
        const r = new Response(hit.body, hit);
        r.headers.set("x-proxy-cache", "HIT");
        log({ m: method, host: target.host, path: target.pathname, s: hit.status, ms: Date.now() - started, cache: "hit" });
        return r;
      }
    }

    // Timeout covers time-to-headers; client disconnect cancels upstream.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error("timeout")), LIMITS.headerTimeoutMs);
    request.signal?.addEventListener?.("abort", () => ctrl.abort(), { once: true });

    // Buffer (capped) request bodies: streamed uploads are unreliable across runtimes.
    let reqBody: ArrayBuffer | undefined;
    if (!isGet && request.body) {
      const buf = await readCapped(request.body, LIMITS.maxRequestBody).catch(() => {
        throw new ProxyError(413, "Upload too large", "Request bodies are limited to 10 MB.");
      });
      reqBody = buf.byteLength ? buf.slice().buffer : undefined;
    }

    let upstream: Response;
    try {
      upstream = await fetch(target.href, {
        method,
        headers,
        ...(reqBody ? { body: reqBody } : {}),
        redirect: "manual",
        signal: ctrl.signal,
      });
    } catch (e) {
      if (isWs) throw new ProxyError(502, "WebSocket unavailable", "The WebSocket connection couldn't be established through the gateway.");
      const msg = (e as Error)?.message || "";
      if (ctrl.signal.aborted && /timeout/i.test(String(ctrl.signal.reason)))
        throw new ProxyError(504, "Website took too long", `No response within ${LIMITS.headerTimeoutMs / 1000} seconds.`);
      throw new ProxyError(502, "Couldn't reach website", msg || "The upstream server didn't respond.");
    } finally {
      clearTimeout(timer);
    }

    if (isWs && upstream.status === 101) return upstream;

    // ---- response headers ----
    const out = new Headers(SECURITY_HEADERS);
    for (const h of FORWARD_RES) {
      const val = upstream.headers.get(h);
      if (val) out.set(h, val);
    }
    const setCookies =
      (upstream.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ??
      (upstream.headers.get("set-cookie") ? [upstream.headers.get("set-cookie")!] : []);
    for (const c of setCookies) out.append("set-cookie", rewriteSetCookie(c, target));
    out.set("x-proxy-cache", "MISS");

    // Redirects go back to the browser so every hop is re-validated.
    const loc = upstream.headers.get("location");
    if (upstream.status >= 300 && upstream.status < 400 && loc) {
      let next: URL;
      try {
        next = new URL(loc, target);
      } catch {
        throw new ProxyError(502, "Bad redirect", "The website sent an invalid redirect.");
      }
      if (next.protocol !== "http:" && next.protocol !== "https:")
        throw new ProxyError(403, "Redirect blocked", `Redirects to ${next.protocol} are not allowed.`);
      out.set("location", toProxyPath(next));
      out.delete("content-length");
      upstream.body?.cancel().catch(() => {});
      log({ m: method, host: target.host, path: target.pathname, s: upstream.status, ms: Date.now() - started, redirect: next.host });
      return new Response(null, { status: upstream.status, headers: out });
    }

    const ct = upstream.headers.get("content-type") || "";
    const kind = upstream.status === 206 || method === "HEAD" || !upstream.body ? "raw" : classify(ct, target.pathname);

    // fetch() transparently decompresses; drop stale encoding/length headers.
    const encoded = !!upstream.headers.get("content-encoding");
    if (encoded) out.delete("content-length");

    if (kind === "raw") {
      // Stream straight through: video, images, fonts, ranges. Never buffered.
      if (kind === "raw" && !out.has("accept-ranges") && /^(video|audio)\//i.test(ct)) out.set("accept-ranges", "bytes");
      const res = new Response(method === "HEAD" ? null : upstream.body, { status: upstream.status, headers: out });
      if (canUseCache && !encoded && isCacheable(upstream)) {
        const clone = res.clone();
        clone.headers.delete("set-cookie");
        cache!.put(cacheKey, clone).catch(() => {});
      }
      log({ m: method, host: target.host, path: target.pathname, s: upstream.status, ms: Date.now() - started, kind, ct });
      return res;
    }

    const bytes = await readCapped(upstream.body!, LIMITS.maxRewriteBody);
    const text = decode(bytes, ct);
    let body: string;
    let outCt = ct;
    switch (kind) {
      case "html":
        body = rewriteHtml(text, target, buildRuntime(target.href));
        outCt = "text/html; charset=utf-8";
        out.set("cache-control", "no-store");
        break;
      case "css":
        body = rewriteCss(text, target);
        outCt = "text/css; charset=utf-8";
        break;
      case "js":
        body = rewriteJs(text, target);
        outCt = "text/javascript; charset=utf-8";
        break;
      case "m3u8":
        body = rewriteM3u8(text, target);
        outCt = "application/vnd.apple.mpegurl";
        break;
      case "mpd":
        body = rewriteMpd(text, target);
        outCt = "application/dash+xml";
        break;
    }
    const encodedBody = new TextEncoder().encode(body);
    out.set("content-type", outCt);
    out.set("content-length", String(encodedBody.byteLength));
    out.delete("etag");
    log({ m: method, host: target.host, path: target.pathname, s: upstream.status, ms: Date.now() - started, kind });
    return new Response(encodedBody, { status: upstream.status, headers: out });
  } catch (e) {
    stats.errors++;
    const pe = e instanceof ProxyError ? e : new ProxyError(500, "Proxy error", "Something went wrong while loading this page.");
    if (!(e instanceof ProxyError)) console.error("proxy_unhandled", e);
    log({ m: method, host: target?.host, s: pe.status, ms: Date.now() - started, err: pe.title });
    return errorPage(pe.status, pe.title, pe.detail, target?.href);
  } finally {
    release?.();
  }
}

/** Root-relative URLs (e.g. location.href = "/watch") escape the proxy path;
 *  recover the intended host from the Referer and redirect back inside. */
export function handleEscaped(request: Request): Response {
  const reqUrl = new URL(request.url);
  const ref = request.headers.get("referer");
  if (ref) {
    try {
      const r = new URL(ref);
      if (r.origin === reqUrl.origin) {
        const t = fromProxyPath(r.pathname + r.search);
        if (t) {
          const dest = new URL(reqUrl.pathname + reqUrl.search, t);
          return new Response(null, { status: 307, headers: { location: toProxyPath(dest), "cache-control": "no-store" } });
        }
      }
    } catch {
      /* fall through */
    }
  }
  return errorPage(404, "Page not found", "This address doesn't exist on the gateway.");
}
