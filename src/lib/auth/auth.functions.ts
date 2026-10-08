import { createServerFn } from "@tanstack/react-start";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";

async function current() {
  const core = await import("./core.server");
  const v = await core.viewerFromCookie(core.cookieFrom(getRequest().headers.get("cookie")));
  return { core, v };
}
async function requireAdmin() {
  const { core, v } = await current();
  if (v?.role !== "admin") throw new Error("Admins only");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return { core, db: supabaseAdmin };
}

export const getViewer = createServerFn({ method: "GET" }).handler(async () => (await current()).v);

export const signIn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(200) }).parse(d))
  .handler(async ({ data }) => {
    const core = await import("./core.server");
    const cookies = getRequest().headers.get("cookie");
    const existing = core.cookieFrom(cookies, core.DEVICE_COOKIE);
    const deviceId = existing && /^[a-f0-9-]{36}$/.test(existing) ? existing : crypto.randomUUID();
    const who = await core.login(data.username, data.password, deviceId);
    const set = [core.deviceCookieHeader(deviceId)];
    if (who.ok) {
      await core.endSession(core.cookieFrom(cookies));
      set.push(core.cookieHeader(await core.makeToken({ k: who.k, s: who.s })));
    }
    setResponseHeader("set-cookie", set);
    return who.ok ? { ok: true as const } : { ok: false as const, error: who.error };
  });

export const signOut = createServerFn({ method: "POST" }).handler(async () => {
  const core = await import("./core.server");
  await core.endSession(core.cookieFrom(getRequest().headers.get("cookie")));
  setResponseHeader("set-cookie", core.cookieHeader("", 0));
  return { ok: true };
});

const sitesSchema = z.array(z.string().max(253)).max(100);

export const listAccounts = createServerFn({ method: "GET" }).handler(async () => {
  const { core, db } = await requireAdmin();
  const { data, error } = await db.from("accounts").select("id,username,all_sites,allowed_sites,created_at,banned_until").order("created_at");
  if (error) throw new Error(error.message);
  const since = new Date(Date.now() - core.ACTIVE_WINDOW_MS).toISOString();
  const { data: sess } = await db.from("account_sessions").select("account_id").gt("last_seen", since);
  const counts = new Map<string, number>();
  for (const r of sess ?? []) counts.set(r.account_id, (counts.get(r.account_id) ?? 0) + 1);
  return data.map((a) => ({
    ...a,
    devices: counts.get(a.id) ?? 0,
    banned: !!a.banned_until && new Date(a.banned_until).getTime() > Date.now(),
  }));
});

export const createAccount = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,32}$/, "3–32 letters, numbers, . _ -"),
      password: z.string().min(6).max(200),
      allSites: z.boolean(),
      sites: sitesSchema,
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const { core, db } = await requireAdmin();
    const { error } = await db.from("accounts").insert({
      username: data.username,
      password_hash: await core.hashPassword(data.password),
      all_sites: data.allSites,
      allowed_sites: data.sites,
    });
    if (error) return { ok: false as const, error: error.code === "23505" ? "That username is taken" : error.message };
    return { ok: true as const };
  });

export const updateAccount = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), allSites: z.boolean(), sites: sitesSchema, password: z.string().min(6).max(200).optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { core, db } = await requireAdmin();
    const patch: { all_sites: boolean; allowed_sites: string[]; password_hash?: string } = { all_sites: data.allSites, allowed_sites: data.sites };
    if (data.password) patch.password_hash = await core.hashPassword(data.password);
    const { error } = await db.from("accounts").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    core.clearViewerCache(data.id);
    return { ok: true };
  });

export const deleteAccount = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { core, db } = await requireAdmin();
    const { error } = await db.from("accounts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    core.clearViewerCache(data.id);
    return { ok: true };
  });

export const moderateAccount = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), action: z.enum(["kick", "ban", "unban"]) }).parse(d))
  .handler(async ({ data }) => {
    const { core, db } = await requireAdmin();
    if (data.action === "kick") await core.kickAccount(data.id);
    else if (data.action === "ban") await core.banAccount(data.id);
    else {
      await db.from("accounts").update({ banned_until: null }).eq("id", data.id);
      core.clearViewerCache(data.id);
    }
    return { ok: true };
  });
