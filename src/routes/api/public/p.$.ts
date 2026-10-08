import { createFileRoute } from "@tanstack/react-router";
import { errorPage, handleProxy } from "@/lib/proxy/handler";
import { fromProxyPath } from "@/lib/proxy/url";
import { hostAllowed } from "@/lib/auth/sites";

// Requires a signed-in account; restricted accounts may only open pages on their allowed sites.
const h = async ({ request }: { request: Request }) => {
  const core = await import("@/lib/auth/core.server");
  const viewer = await core.viewerFromCookie(core.cookieFrom(request.headers.get("cookie")));
  if (!viewer) return errorPage(401, "Sign in required", "Sign in to University Study Tools to browse.");
  if (!viewer.allSites) {
    const u = new URL(request.url);
    const target = fromProxyPath(u.pathname + u.search);
    const dest = request.headers.get("sec-fetch-dest");
    const isPage = !dest || dest === "document" || dest === "iframe" || dest === "frame";
    if (isPage && target && !hostAllowed(target.hostname, viewer.sites)) {
      return errorPage(403, "Site not allowed", "Your account doesn't have access to this site.", target.hostname);
    }
  }
  return handleProxy(request);
};

export const Route = createFileRoute("/api/public/p/$")({
  server: {
    handlers: { GET: h, HEAD: h, POST: h, PUT: h, PATCH: h, DELETE: h, OPTIONS: h },
  },
});
