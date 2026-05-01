import { NextResponse } from "next/server";
import { executePaymentNotify } from "@/lib/executePaymentNotify";
import { normalizeNotifySlug } from "@/lib/notifySlug";
import { findLatestPendingSessionIdForNotifySlug } from "@/lib/paymentSessions";
import { verifyWebhookSecret } from "@/lib/webhookAuth";

/**
 * POST /api/payments/notify/ev/2
 * Body: { "message": "<ข้อความ SMS เต็ม>" }
 * ไม่ต้องส่ง sessionId — ใช้เซสชัน pending ล่าสุดที่สร้างด้วย notifySlug เดียวกัน (จาก ?hook=ev/2 บนหน้าชำระ)
 */
export async function POST(
  req: Request,
  context: { params: { slug: string[] } },
) {
  const authError = verifyWebhookSecret(req);
  if (authError) return authError;

  const segments = context.params.slug;
  const notifySlug = normalizeNotifySlug(segments?.join("/") ?? "");
  if (!notifySlug) {
    return NextResponse.json({ error: "invalid_notify_path" }, { status: 400 });
  }

  let body: { message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message : "";
  if (!message.trim()) {
    return NextResponse.json({ error: "missing_message" }, { status: 400 });
  }

  const sessionId = await findLatestPendingSessionIdForNotifySlug(notifySlug);
  if (!sessionId) {
    return NextResponse.json(
      {
        ok: false,
        matched: false,
        reason: "no_pending_session_for_slug",
        notifySlug,
        detail:
          "ไม่มีรายการรอโอนที่ผูกกับ slug นี้ — เปิดหน้าชำระด้วย ?hook=<slug> หรือตั้ง NEXT_PUBLIC_PAYMENT_NOTIFY_SLUG แล้วสร้างรายการก่อน",
      },
      { status: 404 },
    );
  }

  const { status, body: json } = await executePaymentNotify(sessionId, message);
  return NextResponse.json(json, { status });
}
