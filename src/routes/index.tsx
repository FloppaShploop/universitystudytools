import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft, ArrowRight, RotateCw, House, Maximize, Minimize, Moon, Sun, Lock, Globe, X, ShieldCheck, Film, Zap, Users, LogOut,
} from "lucide-react";
import { fromProxyPath, normalizeUserInput, toProxyPath } from "@/lib/proxy/url";
import { getViewer, signOut } from "@/lib/auth/auth.functions";

type Search = { url?: string };

export const Route = createFileRoute("/")({
  validateSearch: (s: Record<string, unknown>): Search => (typeof s["url"] === "string" ? { url: s["url"] } : {}),
  head: () => ({
    meta: [
      { title: "University Study Tools" },
      { name: "description", content: "Browse JavaScript-heavy sites and stream video through a hardened, streaming web proxy." },
      { property: "og:title", content: "University Study Tools" },
      { property: "og:description", content: "Browse modern sites and stream video through a hardened, streaming web proxy." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: async () => {
    const viewer = await getViewer();
    if (!viewer) throw redirect({ to: "/login" });
    return { viewer };
  },
  component: Browser,
});

const QUICK = [
  { label: "Wikipedia", url: "https://en.wikipedia.org/wiki/Special:Random" },
  { label: "Hacker News", url: "https://news.ycombinator.com/" },
  { label: "MDN", url: "https://developer.mozilla.org/en-US/" },
  { label: "YouTube", url: "https://www.youtube.com/" },
  { label: "HLS test stream", url: "https://hls-js.netlify.app/demo/" },
  { label: "MP4 range test", url: "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4" },
];

type Health = { state: "checking" | "online" | "offline"; ms?: number };

function SiteCards({ sites, onGo }: { sites: string[]; onGo: (u: string) => void }) {
  return (
    <div className="bg-grid flex size-full justify-center overflow-auto px-5 py-12">
      <div className="w-full max-w-4xl">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">Your sites</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">Where to?</h1>
        {sites.length === 0 ? (
          <p className="mt-6 text-muted-foreground">No sites have been added to your account yet. Ask an admin for access.</p>
        ) : (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sites.map((s) => (
              <button
                key={s}
                onClick={() => onGo("https://" + s)}
                className="group flex items-center gap-4 rounded-2xl border border-border bg-card p-5 text-left transition hover:-translate-y-0.5 hover:border-ring"
              >
                <img src={`https://www.google.com/s2/favicons?domain=${s}&sz=64`} alt="" className="size-10 rounded-lg bg-background p-1" />
                <div className="min-w-0">
                  <div className="truncate font-medium">{s}</div>
                  <div className="text-xs text-muted-foreground group-hover:text-primary">Open →</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Browser() {
  const { viewer } = Route.useLoaderData();
  const router = useRouter();
  const logout = async () => {
    await signOut();
    await router.navigate({ to: "/login", replace: true });
  };
  const search = Route.useSearch();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [current, setCurrent] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<Health>({ state: "checking" });
  const [dark, setDark] = useState(true);
  const [full, setFull] = useState(false);

  // theme (persisted)
  useEffect(() => {
    const saved = localStorage.getItem("conduit-theme");
    setDark(saved ? saved === "dark" : true);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("conduit-theme", dark ? "dark" : "light");
  }, [dark]);

  // health / latency
  useEffect(() => {
    let alive = true;
    const ping = async () => {
      const t = performance.now();
      try {
        const r = await fetch("/api/public/health", { cache: "no-store" });
        if (!alive) return;
        setHealth(r.ok ? { state: "online", ms: Math.round(performance.now() - t) } : { state: "offline" });
      } catch {
        if (alive) setHealth({ state: "offline" });
      }
    };
    ping();
    const id = setInterval(ping, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const go = useCallback((raw: string) => {
    const url = normalizeUserInput(raw);
    if (!url) return;
    setError(null);
    setLoading(true);
    setCurrent(url);
    setAddress(url);
    setSrc(toProxyPath(url));
  }, []);

  useEffect(() => {
    if (search.url) go(search.url);
  }, [search.url, go]);

  // messages from the injected runtime inside proxied pages
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== location.origin || !e.data?.__proxy) return;
      if (e.source !== frameRef.current?.contentWindow) return;
      if (e.data.type === "nav") {
        setCurrent(e.data.url);
        setAddress(e.data.url);
        if (e.data.title) setTitle(e.data.title);
        setError(null);
      } else if (e.data.type === "error") {
        setError(`${e.data.status} · ${e.data.title}`);
        setLoading(false);
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  useEffect(() => {
    const onFs = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const onLoad = () => {
    setLoading(false);
    try {
      const w = frameRef.current?.contentWindow;
      if (!w) return;
      const t = fromProxyPath(w.location.pathname + w.location.search + w.location.hash);
      if (t) {
        setCurrent(t.href);
        setAddress(t.href);
      }
      setTitle(w.document.title || "");
    } catch {
      /* cross-origin (shouldn't happen) */
    }
  };

  const win = () => frameRef.current?.contentWindow ?? null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    go(address);
  };
  const home = () => {
    setSrc(null);
    setCurrent(null);
    setAddress("");
    setTitle("");
    setLoading(false);
    setError(null);
  };
  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else shellRef.current?.requestFullscreen?.();
  };

  const secure = current?.startsWith("https://");

  return (
    <div ref={shellRef} className="flex h-dvh flex-col bg-background text-foreground">
      <header className="relative z-10 border-b border-border bg-chrome">
        <div className="flex items-center gap-1.5 px-2 py-2 sm:gap-2 sm:px-3">
          <NavBtn label="Back" onClick={() => win()?.history.back()} disabled={!src}><ArrowLeft /></NavBtn>
          <NavBtn label="Forward" onClick={() => win()?.history.forward()} disabled={!src}><ArrowRight /></NavBtn>
          <NavBtn
            label={loading ? "Stop" : "Reload"}
            disabled={!src}
            onClick={() => {
              if (loading) { win()?.stop(); setLoading(false); }
              else { setLoading(true); win()?.location.reload(); }
            }}
          >
            {loading ? <X /> : <RotateCw />}
          </NavBtn>
          <NavBtn label="Home" onClick={home} className="hidden sm:inline-flex"><House /></NavBtn>

          <form onSubmit={submit} className="group flex min-w-0 flex-1 items-center gap-2 rounded-full border border-input bg-background px-3 py-2 transition focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30 sm:px-4 sm:py-2.5">
            {current ? (
              secure ? <Lock className="size-4 shrink-0 text-success" aria-label="HTTPS" /> : <Globe className="size-4 shrink-0 text-warning" aria-label="HTTP" />
            ) : (
              <Globe className="size-4 shrink-0 text-muted-foreground" />
            )}
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              placeholder="Search or enter a website address"
              aria-label="Address"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              inputMode="url"
              className="min-w-0 flex-1 bg-transparent font-mono text-sm outline-none placeholder:font-sans placeholder:text-muted-foreground sm:text-[15px]"
            />
          </form>

          <StatusPill health={health} />
          {viewer.role === "admin" && (
            <Link to="/admin" aria-label="Manage accounts" title="Manage accounts" className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground [&_svg]:size-[18px]"><Users /></Link>
          )}
          <NavBtn label={`Sign out (${viewer.username})`} onClick={logout}><LogOut /></NavBtn>
          <NavBtn label={dark ? "Light mode" : "Dark mode"} onClick={() => setDark((d) => !d)}>{dark ? <Sun /> : <Moon />}</NavBtn>
          <NavBtn label={full ? "Exit fullscreen" : "Fullscreen"} onClick={toggleFull} className="hidden sm:inline-flex">{full ? <Minimize /> : <Maximize />}</NavBtn>
        </div>
        {loading && (
          <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden" role="progressbar" aria-label="Loading">
            <div className="h-full w-2/5 animate-progress bg-primary" />
          </div>
        )}
        {(title || error) && src && (
          <div className="flex items-center gap-2 border-t border-border px-4 py-1 text-xs text-muted-foreground">
            {error ? <span className="font-medium text-destructive">{error}</span> : <span className="truncate">{title}</span>}
          </div>
        )}
      </header>

      <main className="relative flex-1 overflow-hidden">
        {src ? (
          <iframe
            ref={frameRef}
            key={src}
            src={src}
            onLoad={onLoad}
            title={title || "Proxied page"}
            className="size-full border-0 bg-card"
            allow="fullscreen; autoplay; picture-in-picture; clipboard-write"
            allowFullScreen
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-presentation allow-pointer-lock allow-orientation-lock"
          />
        ) : (
          viewer.allSites ? <StartPage onGo={go} /> : <SiteCards sites={viewer.sites} onGo={go} />
        )}
      </main>
    </div>
  );
}

function NavBtn({ children, label, onClick, disabled, className = "" }: { children: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-35 [&_svg]:size-[18px] ${className}`}
    >
      {children}
    </button>
  );
}

function StatusPill({ health }: { health: Health }) {
  const dot = health.state === "online" ? "bg-success" : health.state === "offline" ? "bg-destructive" : "bg-warning";
  const text = health.state === "online" ? `${health.ms}ms` : health.state === "offline" ? "Offline" : "…";
  return (
    <div className="hidden items-center gap-2 rounded-full border border-border px-3 py-1.5 font-mono text-xs text-muted-foreground md:flex" title="Gateway connection">
      <span className={`size-2 rounded-full ${dot}`} />
      {text}
    </div>
  );
}

function StartPage({ onGo }: { onGo: (u: string) => void }) {
  const [q, setQ] = useState("");
  return (
    <div className="bg-grid flex size-full items-center justify-center overflow-auto px-5 py-12">
      <div className="w-full max-w-2xl">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">Study tools</p>
        <h1 className="mt-3 text-5xl font-semibold tracking-tight sm:text-6xl">University Study Tools</h1>
        <p className="mt-3 max-w-lg text-muted-foreground">
          A streaming proxy for modern sites and video. Every request is checked, rewritten and streamed — nothing is stored.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onGo(q);
          }}
          className="mt-8 flex items-center gap-2 rounded-2xl border border-input bg-card p-2 shadow-sm focus-within:border-ring focus-within:ring-4 focus-within:ring-ring/20"
        >
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="example.com or a search"
            aria-label="Website address"
            spellCheck={false}
            autoCapitalize="off"
            inputMode="url"
            className="min-w-0 flex-1 bg-transparent px-3 py-3 font-mono text-base outline-none placeholder:font-sans placeholder:text-muted-foreground sm:text-lg"
          />
          <button type="submit" className="rounded-xl bg-primary px-5 py-3 font-medium text-primary-foreground transition hover:opacity-90">
            Go
          </button>
        </form>
        <div className="mt-5 flex flex-wrap gap-2">
          {QUICK.map((s) => (
            <button
              key={s.url}
              onClick={() => onGo(s.url)}
              className="rounded-full border border-border bg-card px-3.5 py-1.5 text-sm text-muted-foreground transition hover:border-ring hover:text-foreground"
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="mt-12 grid gap-4 border-t border-border pt-8 sm:grid-cols-3">
          <Feature icon={<Zap />} title="Streamed">Responses flow through without buffering. Byte ranges and keep-alive preserved.</Feature>
          <Feature icon={<Film />} title="Media-ready">HLS and DASH playlists rewritten; video seeks with range requests.</Feature>
          <Feature icon={<ShieldCheck />} title="Hardened">Private networks blocked, DNS verified, cookies isolated per site, rate limited.</Feature>
        </div>
        <p className="mt-8 text-xs text-muted-foreground">
          University Study Tools doesn't bypass logins, CAPTCHAs, DRM, paywalls or regional restrictions. Some sites refuse proxied traffic.
        </p>
      </div>
    </div>
  );
}

function Feature({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 font-medium [&_svg]:size-4 [&_svg]:text-primary">{icon}{title}</div>
      <p className="mt-1.5 text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
