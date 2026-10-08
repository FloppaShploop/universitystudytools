import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { getViewer, signIn } from "@/lib/auth/auth.functions";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — Conduit" },
      { name: "description", content: "Sign in to your Conduit account." },
      { property: "og:title", content: "Sign in — Conduit" },
      { property: "og:description", content: "Sign in to your Conduit account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: async () => {
    if (await getViewer()) throw redirect({ to: "/" });
  },
  component: Login,
});

function Login() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await signIn({ data: { username, password } });
      if (!r.ok) setError(r.error);
      else await router.navigate({ to: "/", replace: true });
    } catch {
      setError("Couldn't sign in. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-grid flex min-h-dvh items-center justify-center bg-background px-5 text-foreground">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-sm">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">Web gateway</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Conduit</h1>
        <p className="mt-1 text-sm text-muted-foreground">Accounts are created by an admin.</p>
        <label className="mt-6 block text-sm font-medium">Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="off"
            className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2.5 outline-none focus:border-ring focus:ring-2 focus:ring-ring/30" />
        </label>
        <label className="mt-4 block text-sm font-medium">Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
            className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2.5 outline-none focus:border-ring focus:ring-2 focus:ring-ring/30" />
        </label>
        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
        <button disabled={busy} className="mt-6 w-full rounded-lg bg-primary py-2.5 font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50">
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
