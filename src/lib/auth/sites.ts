// Browser-safe helpers for site-access rules.

/** Turn "https://www.YouTube.com/watch?v=1" or "youtube.com" into "youtube.com". */
export function normalizeSite(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  if (!/^[a-z]+:\/\//.test(s)) s = "https://" + s;
  try {
    const host = new URL(s).hostname.replace(/^www\./, "");
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return null;
    return host;
  } catch {
    return null;
  }
}

/** A host is allowed when it equals an allowed site or is a subdomain of it. */
export function hostAllowed(host: string, sites: string[]): boolean {
  const h = host.toLowerCase().replace(/:\d+$/, "").replace(/^www\./, "");
  return sites.some((s) => h === s || h.endsWith("." + s));
}
