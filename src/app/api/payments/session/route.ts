import { NextResponse } from "next/server";
import { createPaymentSession } from "@/lib/paymentSessions";
import { normalizeNotifySlug } from "@/lib/notifySlug";

const MAX_BAHT = 999_999;
const MIN_BAHT = 10;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const amount = typeof (body as { amount?: unknown }).amount === "number"
    ? (body as { amount: number }).amount
    : parseFloat(String((body as { amount?: unknown }).amount));

  if (!Number.isFinite(amount) || amount < MIN_BAHT || amount > MAX_BAHT) {
    return NextResponse.json({ error: "invalid_amount" }, { status: 400 });
  }

  const rawSlug = (body as { notifySlug?: unknown }).notifySlug;
  const notifySlug = normalizeNotifySlug(
    typeof rawSlug === "string" ? rawSlug : null,
  );

  const rounded = Math.round(amount * 100) / 100;
  const { sessionId, createdAt } = await createPaymentSession(rounded, notifySlug);

  return NextResponse.json({
    sessionId,
    amount: rounded,
    createdAt,
    notifySlug,
    window: {
      earlySlackMs: 60_000,
      lateMs: 150_000,
      note: "รายการ SMS ต้องมีเวลาไม่ก่อนเริ่มเกิน 1 นาที และไม่เกิน 2.5 นาทีหลังเริ่มสร้างรายการ",
    },
  });
}
