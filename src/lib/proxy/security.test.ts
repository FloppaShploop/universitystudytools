import { describe, expect, it } from "vitest";
import { validateTarget, isPrivateIP } from "./security";
import { fromProxyPath, toProxyPath } from "./url";
import { rewriteM3u8, rewriteSetCookie } from "./rewrite";

const ok = (u: string) => validateTarget(new URL(u)).ok;

describe("SSRF protection", () => {
  it("blocks localhost", () => expect(ok("http://localhost/")).toBe(false));
  it("blocks loopback IPs", () => expect(ok("http://127.0.0.1/")).toBe(false));
  it("blocks decimal-encoded loopback", () => expect(ok("http://2130706433/")).toBe(false));
  it("blocks cloud metadata", () => expect(ok("http://169.254.169.254/latest")).toBe(false));
  it("blocks private ranges", () => {
    expect(ok("http://10.1.2.3/")).toBe(false);
    expect(ok("http://192.168.0.1/")).toBe(false);
    expect(ok("http://172.20.0.1/")).toBe(false);
  });
  it("blocks IPv6 loopback and mapped", () => {
    expect(ok("http://[::1]/")).toBe(false);
    expect(ok("http://[::ffff:127.0.0.1]/")).toBe(false);
    expect(ok("http://[fd00::1]/")).toBe(false);
  });
  it("blocks non-http protocols", () => expect(ok("ftp://example.com/")).toBe(false));
  it("blocks unusual ports", () => expect(ok("https://example.com:22/")).toBe(false));
  it("blocks internal suffixes", () => expect(ok("https://db.internal/")).toBe(false));
  it("allows public sites", () => expect(ok("https://example.com/a?b=1")).toBe(true));
  it("treats public IPs as public", () => expect(isPrivateIP("8.8.8.8")).toBe(false));
});

describe("proxy url encoding", () => {
  it("round-trips", () => {
    const p = toProxyPath("https://www.youtube.com/watch?v=abc");
    expect(p).toBe("/api/public/p/https/www.youtube.com/watch?v=abc");
    expect(fromProxyPath(p)?.href).toBe("https://www.youtube.com/watch?v=abc");
  });
});

describe("rewriting", () => {
  it("rewrites HLS segments", () => {
    const out = rewriteM3u8("#EXTM3U\nseg1.ts\n#EXT-X-KEY:URI=\"k.key\"", new URL("https://cdn.test/v/a.m3u8"));
    expect(out).toContain("/api/public/p/https/cdn.test/v/seg1.ts");
    expect(out).toContain('URI="/api/public/p/https/cdn.test/v/k.key"');
  });
  it("isolates cookies per host", () => {
    const c = rewriteSetCookie("sid=1; Domain=.ex.com; Path=/; Secure", new URL("https://www.ex.com/"));
    expect(c).toBe("sid=1; Path=/api/public/p/https/www.ex.com/; Secure");
  });
});
