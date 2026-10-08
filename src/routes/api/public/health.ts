import { createFileRoute } from "@tanstack/react-router";
import { stats } from "@/lib/proxy/limits";
import { LIMITS } from "@/lib/proxy/security";

export const Route = createFileRoute("/api/public/health")({
  server: {
    handlers: {
      GET: () =>
        Response.json(
          {
            ok: true,
            time: new Date().toISOString(),
            uptimeSec: Math.round((Date.now() - stats.startedAt) / 1000),
            inflight: stats.inflight,
            total: stats.total,
            blocked: stats.blocked,
            errors: stats.errors,
            cacheHits: stats.cacheHits,
            limits: {
              headerTimeoutMs: LIMITS.headerTimeoutMs,
              maxRequestBody: LIMITS.maxRequestBody,
              maxRewriteBody: LIMITS.maxRewriteBody,
              concurrency: LIMITS.concurrency,
            },
          },
          { headers: { "cache-control": "no-store" } },
        ),
    },
  },
});
