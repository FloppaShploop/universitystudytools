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
    const who = await core.login(data.username, data.password);
    if (!who) return { ok: false as const, error: "Wrong username or password" };
    setResponseHeader("set-cookie", core.cookieHeader(await core.makeToken(who)));
    return { ok: true as const };
  });

export const signOut = createServerFn({ method: "POST" }).handler(async () => {
  const core = await import("./core.server");
  setResponseHeader("set-cookie", core.cookieHeader("", 0));
  return { ok: true };
});

const sitesSchema = z.array(z.string().max(253)).max(100);

export const listAccounts = createServerFn({ method: "GET" }).handler(async () => {
  const { db } = await requireAdmin();
  const { data, error } = await db.from("accounts").select("id,username,all_sites,allowed_sites,created_at").order("created_at");
  if (error) throw new Error(error.message);
  return data;
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
