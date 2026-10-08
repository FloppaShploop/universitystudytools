// SSRF / abuse protection. Pure helpers + DNS-over-HTTPS resolution check.

export const LIMITS = {
  allowedPorts: new Set(["", "80", "443", "8080", "8443"]),
  maxRequestBody: 10 * 1024 * 1024, // 10 MB uploads
  maxRewriteBody: 12 * 1024 * 1024, // HTML/CSS/JS/playlists buffered for rewriting
  headerTimeoutMs: 20_000, // time to first byte from upstream
  maxRedirectsHint: 10,
  rate: { capacity: 4000, refillPerSec: 80 }, // per client IP
  concurrency: { perClient: 96, global: 768 },
  cacheMaxBytes: 5 * 1024 * 1024,
};

const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".lan",
  ".home",
  ".corp",
  ".private",
  ".localdomain",
  ".arpa",
];
const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "instance-data",
  "kubernetes.default",
]);

function v4ToInt(ip: string): number | null {
  const p = ip.split(".");
  if (p.length !== 4) return null;
  let n = 0;
  for (const s of p) {
    if (!/^\d{1,3}$/.test(s)) return null;
    const v = Number(s);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

const V4_BLOCKS: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

export function isPrivateIPv4(ip: string): boolean {
  const n = v4ToInt(ip);
  if (n === null) return false;
  return V4_BLOCKS.some(([base, bits]) => {
    const b = v4ToInt(base)!;
    const size = 2 ** (32 - bits);
    return n >= b && n < b + size;
  });
}

export function isIPv4(s: string) {
  return v4ToInt(s) !== null;
}

function expandV6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  if (!s.includes(":")) return null;
  // embedded v4 tail
  const v4m = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4m) {
    const v4s = v4m[1] ?? "";
    const n = v4ToInt(v4s);
    if (n === null) return null;
    s = s.replace(v4s, ((n >>> 16) & 0xffff).toString(16) + ":" + (n & 0xffff).toString(16));
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const parts = [...head, ...Array(fill).fill("0"), ...tail];
  if (parts.length !== 8) return null;
  const out = parts.map((h) => parseInt(h || "0", 16));
  if (out.some((x) => Number.isNaN(x) || x < 0 || x > 0xffff)) return null;
  return out;
}

export function isIPv6(s: string) {
  return expandV6(s) !== null;
}

export function isPrivateIPv6(ip: string): boolean {
  const w0 = expandV6(ip);
  if (!w0) return false;
  const w = w0 as [number, number, number, number, number, number, number, number];
  const allZeroUntil = (i: number) => w.slice(0, i).every((x) => x === 0);
  if (allZeroUntil(8)) return true; // ::
  if (allZeroUntil(7) && w[7] === 1) return true; // ::1
  // IPv4-mapped / compatible
  if (allZeroUntil(5) && (w[5] === 0xffff || w[5] === 0)) {
    const v4 = `${w[6] >> 8}.${w[6] & 255}.${w[7] >> 8}.${w[7] & 255}`;
    return isPrivateIPv4(v4) || w[5] === 0;
  }
  if (w[0] === 0x64 && w[1] === 0xff9b) return true; // NAT64
  if ((w[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((w[0] & 0xffc0) === 0xfe80) return true; // link-local
  if ((w[0] & 0xffc0) === 0xfec0) return true; // site-local (deprecated)
  if ((w[0] & 0xff00) === 0xff00) return true; // multicast
  if (w[0] === 0x2001 && w[1] === 0x0db8) return true; // documentation
  if (w[0] === 0x0100 && w[1] === 0 && w[2] === 0 && w[3] === 0) return true; // discard
  if (w[0] === 0x2002) return true; // 6to4 can embed private v4
  return false;
}

export function isPrivateIP(ip: string) {
  return isIPv4(ip) ? isPrivateIPv4(ip) : isIPv6(ip) ? isPrivateIPv6(ip) : false;
}

export type Verdict = { ok: true } | { ok: false; reason: string };

/** Synchronous checks on the parsed target URL. */
export function validateTarget(u: URL): Verdict {
  if (u.protocol !== "http:" && u.protocol !== "https:")
    return { ok: false, reason: `Protocol ${u.protocol} is not allowed` };
  if (u.username || u.password) return { ok: false, reason: "Credentials in URLs are not allowed" };
  if (!LIMITS.allowedPorts.has(u.port)) return { ok: false, reason: `Port ${u.port} is not allowed` };
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return { ok: false, reason: "Missing host" };
  if (BLOCKED_HOSTS.has(host)) return { ok: false, reason: "Local hostnames are blocked" };
  if (BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s)))
    return { ok: false, reason: "Internal hostnames are blocked" };
  if (isIPv4(host) || isIPv6(host)) {
    if (isPrivateIP(host)) return { ok: false, reason: "Private, loopback or reserved IP addresses are blocked" };
    return { ok: true };
  }
  if (!host.includes(".")) return { ok: false, reason: "Single-label hostnames are blocked" };
  if (!/^[a-z0-9.-]+$/.test(host)) return { ok: false, reason: "Invalid hostname" };
  return { ok: true };
}

// ---- DNS rebinding protection (resolve via DoH, reject private answers) ----
const dnsCache = new Map<string, { ok: boolean; reason?: string | undefined; exp: number }>();

async function doh(name: string, type: "A" | "AAAA"): Promise<string[]> {
  const r = await fetch(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
    { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(4000) },
  );
  if (!r.ok) throw new Error("DNS resolver error");
  const j = (await r.json()) as { Status: number; Answer?: Array<{ type: number; data: string }> };
  if (j.Status !== 0 && j.Status !== 3) throw new Error("DNS resolution failed");
  return (j.Answer ?? []).filter((a) => a.type === 1 || a.type === 28).map((a) => a.data);
}

export async function assertPublicDns(hostname: string): Promise<Verdict> {
  const host = hostname.toLowerCase();
  if (isIPv4(host) || isIPv6(host)) return { ok: true };
  const hit = dnsCache.get(host);
  if (hit && hit.exp > Date.now()) return hit.ok ? { ok: true } : { ok: false, reason: hit.reason! };
  let verdict: Verdict;
  try {
    const [a, aaaa] = await Promise.all([doh(host, "A"), doh(host, "AAAA").catch(() => [])]);
    const ips = [...a, ...aaaa];
    if (ips.length === 0) verdict = { ok: false, reason: "Host could not be resolved" };
    else if (ips.some(isPrivateIP))
      verdict = { ok: false, reason: "Host resolves to a private or internal address" };
    else verdict = { ok: true };
  } catch {
    // Previously-verified host: keep serving instead of cutting off playback mid-stream.
    if (hit?.ok) return { ok: true };
    return { ok: false, reason: "DNS lookup failed" }; // fail closed, don't cache
  }
  if (dnsCache.size > 5000) dnsCache.clear();
  dnsCache.set(host, {
    ok: verdict.ok,
    reason: verdict.ok ? undefined : verdict.reason,
    exp: Date.now() + 15 * 60_000,
  });
  return verdict;
}
