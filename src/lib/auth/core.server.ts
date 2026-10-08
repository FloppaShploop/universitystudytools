// Server-only: password hashing, signed session cookies, admin checks.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const COOKIE = "conduit_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export type Viewer =
  | { role: "admin"; username: string; allSites: true; sites: string[] }
  | { role: "user"; id: string; username: string; allSites: boolean; sites: string[] };

const enc = new TextEncoder();
const b64u = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

function safeEqual(a: string, b: string) {
  const x = enc.encode(a), y = enc.encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}

async function hmac(data: string) {
  const secret = process.env["SESSION_SECRET"];
  if (!secret) throw new Error("SESSION_SECRET is not configured");
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

export async function hashPassword(pw: string, saltB64?: string) {
  const salt = saltB64 ? fromB64u(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 }, key, 256);
  return `${b64u(salt)}:${b64u(bits)}`;
}
export async function verifyPassword(pw: string, stored: string) {
  const [salt] = stored.split(":");
  if (!salt) return false;
  return safeEqual(await hashPassword(pw, salt), stored);
}

function admins() {
  const list: { u: string; p: string }[] = [];
  for (const n of ["1", "2"]) {
    const u = process.env[`ADMIN${n}_USERNAME`], p = process.env[`ADMIN${n}_PASSWORD`];
    if (u && p) list.push({ u: u.trim().toLowerCase(), p: p.trim() });
  }
  return list;
}

type Token = { k: "a" | "u"; s: string; exp: number };

export async function makeToken(t: Omit<Token, "exp">) {
  const body = b64u(enc.encode(JSON.stringify({ ...t, exp: Date.now() + MAX_AGE * 1000 })));
  return `${body}.${await hmac(body)}`;
}
export const cookieHeader = (value: string, maxAge = MAX_AGE) =>
  `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=${maxAge}`;

async function readToken(raw: string | undefined): Promise<Token | null> {
  if (!raw) return null;
  const [body, sig] = raw.split(".");
  if (!body || !sig || !safeEqual(await hmac(body), sig)) return null;
  try {
    const t = JSON.parse(new TextDecoder().decode(fromB64u(body))) as Token;
    return t.exp > Date.now() ? t : null;
  } catch {
    return null;
  }
}

export const DEVICE_COOKIE = "ust_device";
export const deviceCookieHeader = (id: string) =>
  `${DEVICE_COOKIE}=${id}; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=${60 * 60 * 24 * 400}`;
/** A device counts as "logged in" if it was active within this window. */
export const ACTIVE_WINDOW_MS = 30 * 60 * 1000;
export const BAN_MS = 7 * 24 * 60 * 60 * 1000;

export type LoginResult = { ok: true; k: "a" | "u"; s: string } | { ok: false; error: string };

export async function login(username: string, password: string, deviceId: string): Promise<LoginResult> {
  const name = username.trim().toLowerCase();
  for (const a of admins()) {
    if (safeEqual(a.u, name) && safeEqual(a.p, password.trim())) return { ok: true, k: "a", s: a.u };
  }
  const bad = { ok: false as const, error: "Wrong username or password" };
  const { data } = await supabaseAdmin.from("accounts").select("id,password_hash,banned_until").eq("username", name).maybeSingle();
  if (!data || !(await verifyPassword(password, data.password_hash))) return bad;
  if (data.banned_until && new Date(data.banned_until).getTime() > Date.now()) {
    return { ok: false, error: `This account is banned until ${new Date(data.banned_until).toUTCString()}.` };
  }
  // Same browser signing in again replaces its old session (tabs share one device).
  await supabaseAdmin.from("account_sessions").delete().eq("account_id", data.id).eq("device_id", deviceId);
  const since = new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString();
  const { count } = await supabaseAdmin.from("account_sessions").select("id", { count: "exact", head: true })
    .eq("account_id", data.id).gt("last_seen", since);
  if ((count ?? 0) > 0) {
    await banAccount(data.id);
    return { ok: false, error: "This account was signed in on another device, so it has been banned for one week." };
  }
  const { data: sess, error } = await supabaseAdmin.from("account_sessions").insert({ account_id: data.id, device_id: deviceId }).select("id").single();
  if (error || !sess) return { ok: false, error: "Couldn't sign in. Try again." };
  return { ok: true, k: "u", s: sess.id };
}

export async function banAccount(id: string) {
  await supabaseAdmin.from("accounts").update({ banned_until: new Date(Date.now() + BAN_MS).toISOString() }).eq("id", id);
  await kickAccount(id);
}
export async function kickAccount(id: string) {
  await supabaseAdmin.from("account_sessions").delete().eq("account_id", id);
  for (const [k, v] of cache) if (v.accountId === id) cache.delete(k);
}
export async function endSession(raw: string | undefined) {
  const t = await readToken(raw);
  if (t?.k === "u") {
    await supabaseAdmin.from("account_sessions").delete().eq("id", t.s);
    cache.delete(t.s);
  }
}

// Short per-isolate cache so proxied sub-requests don't each hit the database.
const cache = new Map<string, { v: Viewer | null; at: number; accountId?: string }>();

export async function viewerFromCookie(raw: string | undefined): Promise<Viewer | null> {
  const t = await readToken(raw);
  if (!t) return null;
  if (t.k === "a") {
    return admins().some((a) => a.u === t.s) ? { role: "admin", username: t.s, allSites: true, sites: [] } : null;
  }
  const hit = cache.get(t.s);
  if (hit && Date.now() - hit.at < 15_000) return hit.v;
  const { data: sess } = await supabaseAdmin.from("account_sessions").select("account_id,last_seen").eq("id", t.s).maybeSingle();
  let v: Viewer | null = null;
  if (sess) {
    const { data } = await supabaseAdmin.from("accounts").select("id,username,all_sites,allowed_sites,banned_until").eq("id", sess.account_id).maybeSingle();
    const banned = data?.banned_until && new Date(data.banned_until).getTime() > Date.now();
    if (data && !banned) {
      v = { role: "user", id: data.id, username: data.username, allSites: data.all_sites, sites: data.allowed_sites };
      if (Date.now() - new Date(sess.last_seen).getTime() > 60_000) {
        await supabaseAdmin.from("account_sessions").update({ last_seen: new Date().toISOString() }).eq("id", t.s);
      }
    }
  }
  cache.set(t.s, { v, at: Date.now(), accountId: sess?.account_id });
  return v;
}
export const clearViewerCache = (id: string) => {
  for (const [k, v] of cache) if (v.accountId === id) cache.delete(k);
};

export function cookieFrom(header: string | null, name = COOKIE): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return undefined;
}
