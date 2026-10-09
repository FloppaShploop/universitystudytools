// Server-only database bridge. Uses only the public URL + publishable key plus a
// shared DB_BRIDGE_KEY, so it works on any host (Lovable, Netlify, ...).
import { createClient } from "@supabase/supabase-js";

export async function db<T = unknown>(op: string, args: Record<string, unknown> = {}): Promise<T> {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  const bridge = process.env["DB_BRIDGE_KEY"];
  if (!url || !key || !bridge) throw new Error("Missing SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY or DB_BRIDGE_KEY");
  const client = createClient(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
  const { data, error } = await client.rpc("app_db" as never, { p_key: bridge, p_op: op, p_args: args } as never);
  if (error) throw new Error(`Database error (${op}): ${error.message}`);
  return data as T;
}
