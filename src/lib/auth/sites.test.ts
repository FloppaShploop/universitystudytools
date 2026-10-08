import { describe, expect, it } from "vitest";
import { hostAllowed, normalizeSite } from "./sites";

describe("site access", () => {
  it("normalizes typed sites", () => {
    expect(normalizeSite("https://www.YouTube.com/watch?v=1")).toBe("youtube.com");
  });
  it("allows the site and its subdomains", () => {
    expect(hostAllowed("m.youtube.com", ["youtube.com"])).toBe(true);
    expect(hostAllowed("www.youtube.com", ["youtube.com"])).toBe(true);
  });
  it("blocks other sites", () => {
    expect(hostAllowed("evilyoutube.com", ["youtube.com"])).toBe(false);
    expect(hostAllowed("wikipedia.org", [])).toBe(false);
  });
});
