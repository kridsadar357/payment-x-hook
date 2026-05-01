import { randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type PaymentSession = {
  amount: number;
  createdAt: number;
};

const TTL_MS = 15 * 60 * 1000;
const STATUS_PENDING = "pending";
const STATUS_PAID = "paid";
const STATUS_EXPIRED = "expired";
const STATUS_CANCELLED = "cancelled";

function isExpiredByTtl(createdAt: Date): boolean {
  return Date.now() - createdAt.getTime() > TTL_MS;
}

export async function createPaymentSession(
  amount: number,
  notifySlug: string | null = null,
): Promise<{ sessionId: string; createdAt: number }> {
  const sessionId = randomBytes(18).toString("base64url");
  const row = await prisma.paymentSession.create({
    data: {
      id: sessionId,
      amount,
      status: STATUS_PENDING,
      ...(notifySlug ? { notifySlug } : {}),
    },
  });
  return { sessionId: row.id, createdAt: row.createdAt.getTime() };
}

/** หา session ล่าสุดที่ pending + ยังไม่เกิน TTL สำหรับ notify slug (iOS Shortcut แบบไม่ส่ง sessionId) */
export async function findLatestPendingSessionIdForNotifySlug(
  notifySlug: string,
): Promise<string | null> {
  const since = new Date(Date.now() - TTL_MS);
  /** ใช้ $queryRaw แทน findFirst(where: { notifySlug }) เพื่อไม่พึ่งชนิด WhereInput ที่ IDE บางที stale หลัง prisma generate */
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id FROM payment_sessions
    WHERE notify_slug = ${notifySlug}
      AND status = ${STATUS_PENDING}::payment_session_status
      AND created_at >= ${since}
    ORDER BY created_at DESC
    LIMIT 1
  `);
  return rows[0]?.id ?? null;
}

/** ผลสำหรับ notify: ยังไม่มี / หมดอายุ / จ่ายแล้ว (idempotent) / รอโอน */
export type NotifySessionState =
  | { kind: "missing" }
  | { kind: "expired" }
  | { kind: "paid"; amount: number; createdAt: number; paidAt: Date | null; smsMatchedAt: Date | null }
  | { kind: "pending"; amount: number; createdAt: number };

export async function getSessionStateForNotify(sessionId: string): Promise<NotifySessionState> {
  const row = await prisma.paymentSession.findUnique({ where: { id: sessionId } });
  if (!row) return { kind: "missing" };

  if (row.status === STATUS_PAID) {
    return {
      kind: "paid",
      amount: Number(row.amount),
      createdAt: row.createdAt.getTime(),
      paidAt: row.paidAt,
      smsMatchedAt: row.smsMatchedAt,
    };
  }

  if (row.status === STATUS_EXPIRED || row.status === STATUS_CANCELLED) {
    return { kind: "expired" };
  }

  if (row.status === STATUS_PENDING && isExpiredByTtl(row.createdAt)) {
    await prisma.paymentSession.update({
      where: { id: sessionId },
      data: { status: STATUS_EXPIRED },
    });
    return { kind: "expired" };
  }

  return {
    kind: "pending",
    amount: Number(row.amount),
    createdAt: row.createdAt.getTime(),
  };
}

/** อ่านเซสชันที่ยังใช้แจ้งเตือนได้ (pending + ยังไม่เกิน TTL) — สำหรับ API อื่นถ้าต้องการ */
export async function getPaymentSession(
  sessionId: string,
): Promise<PaymentSession | undefined> {
  const state = await getSessionStateForNotify(sessionId);
  if (state.kind !== "pending") return undefined;
  return { amount: state.amount, createdAt: state.createdAt };
}

export async function cancelPaymentSession(
  sessionId: string,
): Promise<"cancelled" | "already_final" | "missing"> {
  const updated = await prisma.paymentSession.updateMany({
    where: { id: sessionId, status: STATUS_PENDING },
    data: { status: STATUS_CANCELLED },
  });
  if (updated.count === 1) return "cancelled";

  const row = await prisma.paymentSession.findUnique({ where: { id: sessionId } });
  if (!row) return "missing";
  return "already_final";
}

export type SessionStatusForClient =
  | { kind: "missing" }
  | { kind: "pending"; amount: number; createdAt: number }
  | { kind: "paid"; amount: number; createdAt: number; paidAt: Date | null; smsMatchedAt: Date | null }
  | { kind: "expired_or_cancelled" };

/** สำหรับหน้า client polling สถานะหลังสร้าง QR */
export async function getSessionStatusForClient(sessionId: string): Promise<SessionStatusForClient> {
  const state = await getSessionStateForNotify(sessionId);
  if (state.kind === "missing") return { kind: "missing" };
  if (state.kind === "expired") return { kind: "expired_or_cancelled" };
  if (state.kind === "pending") {
    return { kind: "pending", amount: state.amount, createdAt: state.createdAt };
  }
  return {
    kind: "paid",
    amount: state.amount,
    createdAt: state.createdAt,
    paidAt: state.paidAt,
    smsMatchedAt: state.smsMatchedAt,
  };
}

const SMS_SNIPPET_MAX = 2000;

export async function markSessionPaidFromSms(
  sessionId: string,
  opts: { smsOccurredAt: Date; rawMessage: string },
): Promise<"updated" | "already_paid" | "not_pending"> {
  const snippet = opts.rawMessage.slice(0, SMS_SNIPPET_MAX);
  const now = new Date();

  const updated = await prisma.paymentSession.updateMany({
    where: { id: sessionId, status: STATUS_PENDING },
    data: {
      status: STATUS_PAID,
      paidAt: now,
      smsMatchedAt: opts.smsOccurredAt,
      smsRawSnippet: snippet,
    },
  });

  if (updated.count === 1) return "updated";

  const row = await prisma.paymentSession.findUnique({ where: { id: sessionId } });
  if (row?.status === STATUS_PAID) return "already_paid";
  return "not_pending";
}
