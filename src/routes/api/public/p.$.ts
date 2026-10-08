import { createFileRoute } from "@tanstack/react-router";
import { handleProxy } from "@/lib/proxy/handler";

// Public by design: the handler enforces SSRF checks, rate limits and abuse guards.
const h = ({ request }: { request: Request }) => handleProxy(request);

export const Route = createFileRoute("/api/public/p/$")({
  server: {
    handlers: { GET: h, HEAD: h, POST: h, PUT: h, PATCH: h, DELETE: h, OPTIONS: h },
  },
});
