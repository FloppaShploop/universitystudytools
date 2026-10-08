import { LIMITS } from "./security";

// Per-isolate token bucket + concurrency gate. Each edge isolate enforces its own
// budget; combine with platform-level rate limiting for global enforcement.
const buckets = new Map<string, { tokens: number; ts: number }>();
const inflightByClient = new Map<string, number>();
export const stats = { inflight: 0, total: 0, blocked: 0, errors: 0, cacheHits: 0, startedAt: Date.now() };

export function takeToken(client: string): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const { capacity, refillPerSec } = LIMITS.rate;
  let b = buckets.get(client);
  if (!b) {
    if (buckets.size > 20_000) buckets.clear();
    b = { tokens: capacity, ts: now };
    buckets.set(client, b);
  }
  b.tokens = Math.min(capacity, b.tokens + ((now - b.ts) / 1000) * refillPerSec);
  b.ts = now;
  if (b.tokens < 1) return { ok: false, retryAfter: Math.ceil((1 - b.tokens) / refillPerSec) };
  b.tokens -= 1;
  return { ok: true, retryAfter: 0 };
}

export function acquire(client: string): (() => void) | null {
  const c = inflightByClient.get(client) ?? 0;
  if (c >= LIMITS.concurrency.perClient || stats.inflight >= LIMITS.concurrency.global) return null;
  inflightByClient.set(client, c + 1);
  stats.inflight++;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    stats.inflight--;
    const n = (inflightByClient.get(client) ?? 1) - 1;
    if (n <= 0) inflightByClient.delete(client);
    else inflightByClient.set(client, n);
  };
}
