import { PROXY_PREFIX, toProxyPath } from "./url";

const SKIP = /^(data|blob|javascript|about|mailto|tel|sms|#)/i;

function decodeEntities(s: string) {
  return s.replace(/&amp;/g, "&").replace(/&#x2F;/gi, "/").replace(/&#47;/g, "/");
}

/** Resolve a raw URL found in a document and return its proxy path. */
export function proxify(raw: string, base: URL): string {
  const t = raw.trim();
  if (!t || SKIP.test(t) || t.startsWith(PROXY_PREFIX)) return raw;
  try {
    const u = new URL(decodeEntities(t), base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return raw;
    return toProxyPath(u);
  } catch {
    return raw;
  }
}

export function rewriteCss(css: string, base: URL): string {
  return css
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (_m, q, u) => `url(${q}${proxify(u, base)}${q})`)
    .replace(/@import\s+(['"])([^'"]+)\1/gi, (_m, q, u) => `@import ${q}${proxify(u, base)}${q}`);
}

function rewriteSrcset(v: string, base: URL) {
  return v
    .split(",")
    .map((part) => {
      const p = part.trim();
      if (!p) return p;
      const [u, ...rest] = p.split(/\s+/);
      return [proxify(u ?? "", base), ...rest].join(" ");
    })
    .join(", ");
}

const ATTRS = "src|href|action|poster|data|formaction|background|longdesc|manifest|lowsrc|data-src|data-href";

export function rewriteHtml(html: string, target: URL, runtime: string): string {
  let base = target;
  const bm = html.match(/<base\s[^>]*href\s*=\s*(["'])(.*?)\1/i);
  if (bm) {
    try {
      base = new URL(decodeEntities(bm[2] ?? ""), target);
    } catch {
      /* ignore */
    }
  }
  let out = html
    // CSP/meta frame restrictions from upstream would break the proxy
    .replace(/<meta[^>]+http-equiv\s*=\s*["']?(content-security-policy|x-frame-options)[^>]*>/gi, "")
    // Subresource integrity fails once CSS is rewritten
    .replace(/\s(integrity|nonce)\s*=\s*(["'])[^"']*\2/gi, "")
    // keep navigation inside the proxy frame
    .replace(/\starget\s*=\s*(["'])_(top|parent)\1/gi, ' target="_self"')
    .replace(new RegExp(`(\\s(?:${ATTRS})\\s*=\\s*)(["'])(.*?)\\2`, "gi"), (_m, pre, q, u) => `${pre}${q}${proxify(u, base)}${q}`)
    .replace(new RegExp(`(\\s(?:${ATTRS})\\s*=\\s*)([^\\s"'>]+)`, "gi"), (_m, pre, u) => `${pre}"${proxify(u, base)}"`)
    .replace(/(\s(?:srcset|imagesrcset|data-srcset)\s*=\s*)(["'])(.*?)\2/gi, (_m, pre, q, v) => `${pre}${q}${rewriteSrcset(v, base)}${q}`)
    .replace(/(<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["'][^"']*?url\s*=\s*)([^"'>\s]+)/gi, (_m, pre, u) => pre + proxify(u, base));
  // CSS rewriting only inside <style> blocks and style="" attributes (never inline JS).
  out = out
    .replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi, (_m, a, css, b) => a + rewriteCss(css, base) + b)
    .replace(/(\sstyle\s*=\s*)(["'])(.*?)\2/gi, (_m, pre, q, css) => `${pre}${q}${rewriteCss(css, base)}${q}`);
  const tag = `<script data-proxy-runtime>${runtime}</script>`;
  if (/<head[^>]*>/i.test(out)) out = out.replace(/<head[^>]*>/i, (m) => m + tag);
  else if (/<html[^>]*>/i.test(out)) out = out.replace(/<html[^>]*>/i, (m) => m + tag);
  else out = tag + out;
  return out;
}

/** Rewrite absolute URLs in ES module static/dynamic imports. */
export function rewriteJs(js: string, base: URL): string {
  return js
    .replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(https?:\/\/[^"'\s]+)\2/g, (_m, pre, q, u) => `${pre}${q}${proxify(u, base)}${q}`)
    .replace(/(\bimportScripts\s*\(\s*)(["'])(https?:\/\/[^"'\s]+)\2/g, (_m, pre, q, u) => `${pre}${q}${proxify(u, base)}${q}`);
}

/** HLS: rewrite segment/variant lines and URI="..." attributes. */
export function rewriteM3u8(text: string, base: URL): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const l = line.trim();
      if (!l) return line;
      if (l.startsWith("#")) return line.replace(/URI="([^"]+)"/g, (_m, u) => `URI="${proxify(u, base)}"`);
      return proxify(l, base);
    })
    .join("\n");
}

/** MPEG-DASH: rewrite BaseURL and absolute template attributes (never xmlns). */
export function rewriteMpd(xml: string, base: URL): string {
  return xml
    .replace(/(<BaseURL[^>]*>)([^<]+)(<\/BaseURL>)/gi, (_m, a, u, b) => a + proxify(u, base) + b)
    .replace(/(\s(?:media|initialization|sourceURL|href)\s*=\s*)(["'])(https?:\/\/[^"']+)\2/gi, (_m, pre, q, u) => `${pre}${q}${proxify(u, base)}${q}`);
}

/** Scope upstream cookies to the proxy path of their host (cookie isolation). */
export function rewriteSetCookie(cookie: string, target: URL): string {
  const parts = cookie.split(";").map((p) => p.trim()).filter(Boolean);
  const [nv, ...attrs] = parts;
  let path = "/";
  const kept: string[] = [];
  for (const a of attrs) {
    const k = (a.split("=")[0] ?? "").toLowerCase();
    if (k === "domain") continue;
    if (k === "path") {
      path = a.slice(a.indexOf("=") + 1) || "/";
      continue;
    }
    kept.push(a);
  }
  if (!path.startsWith("/")) path = "/";
  const proto = target.protocol.slice(0, -1);
  return [nv, `Path=${PROXY_PREFIX}${proto}/${target.host}${path}`, ...kept].join("; ");
}
