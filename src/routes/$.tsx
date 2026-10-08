import { createFileRoute, Link } from "@tanstack/react-router";
import { handleEscaped } from "@/lib/proxy/handler";

const h = ({ request }: { request: Request }) => handleEscaped(request);

export const Route = createFileRoute("/$")({
  server: { handlers: { GET: h, POST: h, HEAD: h } },
  head: () => ({ meta: [{ title: "Not found — Conduit" }, { name: "robots", content: "noindex" }] }),
  component: Missing,
});

function Missing() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6 text-center">
      <div>
        <p className="font-mono text-6xl text-muted-foreground">404</p>
        <Link to="/" className="mt-4 inline-block text-primary underline">Back to Conduit</Link>
      </div>
    </div>
  );
}
