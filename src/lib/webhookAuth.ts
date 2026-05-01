import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

const SECRET_HEADER = "x-webhook-secret";

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * ยืนยัน webhook secret สำหรับ endpoint notify
 * - production: ต้องตั้ง WEBHOOK_SECRET (fail closed)
 * - non-production: ถ้าไม่ตั้ง จะอนุญาตเพื่อ dev convenience
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

  return null;
}

