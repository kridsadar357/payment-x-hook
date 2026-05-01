import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

const SECRET_HEADER = "x-webhook-secret";
const TS_HEADER = "x-webhook-timestamp";
const NONCE_HEADER = "x-webhook-nonce";
const RELAY_SECRET_HEADER = "x-relay-secret";

type RateBucket = { count: number; resetAtMs: number };
type SecurityStore = {
  nonceUsedUntilMs: Map<string, number>;
  rateBuckets: Map<string, RateBucket>;
};

function getSecurityStore(): SecurityStore {
  const g = globalThis as typeof globalThis & { __webhookSecurityStore?: SecurityStore };
  if (!g.__webhookSecurityStore) {
    g.__webhookSecurityStore = {
      nonceUsedUntilMs: new Map<string, number>(),
      rateBuckets: new Map<string, RateBucket>(),
    };
  }
  return g.__webhookSecurityStore;
}

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function parseTsToMs(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  // accept seconds or milliseconds
  if (n > 1e12) return Math.trunc(n);
  return Math.trunc(n * 1000);
}

function extractClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xr = req.headers.get("x-real-ip");
  if (xr) return xr.trim();
  return "unknown";
}

function enforceRateLimit(req: Request): NextResponse | null {
  const limitPerMinute = Number(process.env.WEBHOOK_RATE_LIMIT_PER_MINUTE ?? "60");
  const limit = Number.isFinite(limitPerMinute) && limitPerMinute > 0 ? Math.floor(limitPerMinute) : 60;
  const windowMs = 60_000;
  const now = Date.now();
  const ip = extractClientIp(req);
  const path = new URL(req.url).pathname;
  const key = `${ip}:${path}`;
  const store = getSecurityStore();
  const prev = store.rateBuckets.get(key);

  if (!prev || prev.resetAtMs <= now) {
    store.rateBuckets.set(key, { count: 1, resetAtMs: now + windowMs });
  } else {
    prev.count += 1;
    if (prev.count > limit) {
      return NextResponse.json(
        { error: "rate_limited", detail: "too_many_requests" },
        { status: 429, headers: { "Retry-After": String(Math.ceil((prev.resetAtMs - now) / 1000)) } },
      );
    }
  }

  // lightweight cleanup
  if (store.rateBuckets.size > 500) {
    store.rateBuckets.forEach((v, k) => {
      if (v.resetAtMs <= now) store.rateBuckets.delete(k);
    });
  }

  return null;
}

function enforceReplayProtection(req: Request): NextResponse | null {
  const expected = (process.env.WEBHOOK_SECRET ?? "").trim();
  const isProd = process.env.NODE_ENV === "production";
  const replayRequired = isProd || process.env.WEBHOOK_REQUIRE_REPLAY_PROTECTION === "1";
  if (!expected) return null; // secret gate handles prod misconfig separately
  if (!replayRequired) return null;

  const tsRaw = (req.headers.get(TS_HEADER) ?? "").trim();
  const nonce = (req.headers.get(NONCE_HEADER) ?? "").trim();
  if (!tsRaw || !nonce) {
    return NextResponse.json({ error: "missing_replay_headers" }, { status: 401 });
  }
  if (!/^[a-zA-Z0-9._:-]{8,128}$/.test(nonce)) {
    return NextResponse.json({ error: "invalid_nonce" }, { status: 401 });
  }

  const tsMs = parseTsToMs(tsRaw);
  if (tsMs == null) {
    return NextResponse.json({ error: "invalid_timestamp" }, { status: 401 });
  }
  const now = Date.now();
  const allowedSkewMsRaw = Number(process.env.WEBHOOK_ALLOWED_SKEW_MS ?? "90000");
  const allowedSkewMs = Number.isFinite(allowedSkewMsRaw) && allowedSkewMsRaw > 0 ? Math.floor(allowedSkewMsRaw) : 90_000;
  if (Math.abs(now - tsMs) > allowedSkewMs) {
    return NextResponse.json({ error: "stale_request" }, { status: 401 });
  }

  const nonceTtlRaw = Number(process.env.WEBHOOK_NONCE_TTL_MS ?? "300000");
  const nonceTtlMs = Number.isFinite(nonceTtlRaw) && nonceTtlRaw > 0 ? Math.floor(nonceTtlRaw) : 300_000;
  const store = getSecurityStore();
  const usedUntil = store.nonceUsedUntilMs.get(nonce);
  if (usedUntil && usedUntil > now) {
    return NextResponse.json({ error: "replayed_request" }, { status: 401 });
  }
  store.nonceUsedUntilMs.set(nonce, now + nonceTtlMs);

  if (store.nonceUsedUntilMs.size > 5000) {
    store.nonceUsedUntilMs.forEach((exp, k) => {
      if (exp <= now) store.nonceUsedUntilMs.delete(k);
    });
  }

  return null;
}

/**
 * ยืนยัน webhook secret สำหรับ endpoint notify
 * - production: ต้องตั้ง WEBHOOK_SECRET (fail closed)
 * - non-production: ถ้าไม่ตั้ง จะอนุญาตเพื่อ dev convenience
 * เพิ่ม replay protection + rate limit สำหรับ production
 */
export function verifyWebhookSecret(req: Request): NextResponse | null {
  const expected = (process.env.WEBHOOK_SECRET ?? "").trim();
  const isProd = process.env.NODE_ENV === "production";

  if (!expected) {
    if (isProd) {
      return NextResponse.json(
        { error: "server_misconfigured", detail: "WEBHOOK_SECRET is required in production" },
        { status: 500 },
      );
    }
    return null;
  }

  const got = (req.headers.get(SECRET_HEADER) ?? "").trim();
  if (!got || !safeEqual(got, expected)) {
    return NextResponse.json({ error: "unauthorized_webhook" }, { status: 401 });
  }

  const replayError = enforceReplayProtection(req);
  if (replayError) return replayError;

  const rateError = enforceRateLimit(req);
  if (rateError) return rateError;

  return null;
}

/**
 * Relay auth สำหรับ iOS Shortcuts แบบ static header
 * ใช้ WEBHOOK_RELAY_SECRET (fallback: WEBHOOK_SECRET) + rate limit
 * ไม่บังคับ replay headers เพราะ Shortcuts ตั้ง header แบบ dynamic ได้ยาก
 */
export function verifyRelaySecret(req: Request): NextResponse | null {
  const expected = ((process.env.WEBHOOK_RELAY_SECRET ?? "").trim() || (process.env.WEBHOOK_SECRET ?? "").trim());
  const isProd = process.env.NODE_ENV === "production";

  if (!expected) {
    if (isProd) {
      return NextResponse.json(
        { error: "server_misconfigured", detail: "WEBHOOK_RELAY_SECRET (or WEBHOOK_SECRET) is required in production" },
        { status: 500 },
      );
    }
    return null;
  }

  const got = ((req.headers.get(RELAY_SECRET_HEADER) ?? "").trim() || (req.headers.get(SECRET_HEADER) ?? "").trim());
  if (!got || !safeEqual(got, expected)) {
    return NextResponse.json({ error: "unauthorized_relay" }, { status: 401 });
  }

  const rateError = enforceRateLimit(req);
  if (rateError) return rateError;

  return null;
}

