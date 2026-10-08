import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { ArrowLeft, Trash2, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { createAccount, deleteAccount, getViewer, listAccounts, updateAccount } from "@/lib/auth/auth.functions";
import { normalizeSite } from "@/lib/auth/sites";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Accounts — University Study Tools admin" },
      { name: "description", content: "Create accounts and choose which sites each person can open." },
      { property: "og:title", content: "Accounts — University Study Tools admin" },
      { property: "og:description", content: "Create accounts and choose which sites each person can open." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: async () => {
    const v = await getViewer();
    if (!v) throw redirect({ to: "/login" });
    if (v.role !== "admin") throw redirect({ to: "/" });
    return { accounts: await listAccounts() };
  },
  component: Admin,
});

const field = "w-full rounded-lg border border-input bg-background px-3 py-2 outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";

function SitesEditor({ sites, onChange }: { sites: string[]; onChange: (s: string[]) => void }) {
  const [v, setV] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const add = () => {
    const s = normalizeSite(v);
    if (!s) return setErr("Enter a site like youtube.com");
    if (!sites.includes(s)) onChange([...sites, s]);
    setV("");
    setErr(null);
  };
  return (
    <div>
      <div className="flex gap-2">
        <input value={v} onChange={(e) => setV(e.target.value)} placeholder="youtube.com" className={field}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <button type="button" onClick={add} className="rounded-lg border border-border px-3 text-sm hover:border-ring">Add</button>
      </div>
      {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {sites.length === 0 && <span className="text-xs text-muted-foreground">No sites — this person can't open anything yet.</span>}
        {sites.map((s) => (
          <span key={s} className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 font-mono text-xs">
            {s}
            <button type="button" aria-label={`Remove ${s}`} onClick={() => onChange(sites.filter((x) => x !== s))}><X className="size-3" /></button>
          </span>
        ))}
      </div>
    </div>
  );
}

function AccessControl({ allSites, sites, onAll, onSites }: { allSites: boolean; sites: string[]; onAll: (b: boolean) => void; onSites: (s: string[]) => void }) {
  return (
    <div className="space-y-3">
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>
          <span className="font-medium">{allSites ? "Access all sites" : "Access no sites except…"}</span>
          <span className="block text-xs text-muted-foreground">{allSites ? "Can browse anywhere." : "Only the sites listed below, shown as cards."}</span>
        </span>
        <Switch checked={allSites} onCheckedChange={onAll} />
      </label>
      {!allSites && <SitesEditor sites={sites} onChange={onSites} />}
    </div>
  );
}

type Account = Awaited<ReturnType<typeof listAccounts>>[number];

function AccountRow({ a, onDone }: { a: Account; onDone: () => void }) {
  const [allSites, setAll] = useState(a.all_sites);
  const [sites, setSites] = useState<string[]>(a.allowed_sites);
  const [pw, setPw] = useState("");
  const [saved, setSaved] = useState(false);
  const save = async () => {
    await updateAccount({ data: { id: a.id, allSites, sites, password: pw || undefined } });
    setPw("");
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    onDone();
  };
  const del = async () => {
    if (!confirm(`Delete ${a.username}?`)) return;
    await deleteAccount({ data: { id: a.id } });
    onDone();
  };
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <div className="font-mono font-medium">{a.username}</div>
        <button onClick={del} aria-label="Delete account" className="text-muted-foreground hover:text-destructive"><Trash2 className="size-4" /></button>
      </div>
      <div className="mt-4"><AccessControl allSites={allSites} sites={sites} onAll={setAll} onSites={setSites} /></div>
      <div className="mt-4 flex gap-2">
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password (optional)" className={field} />
        <button onClick={save} className="shrink-0 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">{saved ? "Saved" : "Save"}</button>
      </div>
    </div>
  );
}

function Admin() {
  const { accounts } = Route.useLoaderData();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [allSites, setAll] = useState(false);
  const [sites, setSites] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => router.invalidate();

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await createAccount({ data: { username, password, allSites, sites } });
      if (!r.ok) return setError(r.error);
      setUsername(""); setPassword(""); setAll(false); setSites([]);
      refresh();
    } catch (err) {
      setError(err instanceof Error && err.message.includes("6") ? "Password must be at least 6 characters" : "Check the username (3–32 letters/numbers) and password (6+ characters).");
    }
  };

  return (
    <div className="min-h-dvh bg-background px-5 py-10 text-foreground">
      <div className="mx-auto max-w-5xl">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Back to browser</Link>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Accounts</h1>
        <div className="mt-8 grid gap-8 lg:grid-cols-[360px_1fr]">
          <form onSubmit={create} className="h-fit space-y-4 rounded-2xl border border-border bg-card p-5">
            <h2 className="font-medium">New account</h2>
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" autoCapitalize="off" className={field} />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (6+ characters)" className={field} />
            <AccessControl allSites={allSites} sites={sites} onAll={setAll} onSites={setSites} />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <button className="w-full rounded-lg bg-primary py-2.5 font-medium text-primary-foreground hover:opacity-90">Create account</button>
          </form>
          <div className="space-y-4">
            {accounts.length === 0 && <p className="text-muted-foreground">No accounts yet.</p>}
            {accounts.map((a) => <AccountRow key={a.id + a.allowed_sites.join() + a.all_sites} a={a} onDone={refresh} />)}
          </div>
        </div>
      </div>
    </div>
  );
}
