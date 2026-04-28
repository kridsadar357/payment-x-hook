import { randomBytes } from "crypto";
import {
  PaymentSessionStatus,
  Prisma,
} from "../../node_modules/.prisma/client/index.js";
import { prisma } from "@/lib/prisma";

export type PaymentSession = {
  amount: number;
  createdAt: number;
};

const TTL_MS = 15 * 60 * 1000;

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
      status: PaymentSessionStatus.pending,
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
      AND status = ${PaymentSessionStatus.pending}::payment_session_status
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

  if (row.status === PaymentSessionStatus.paid) {
    return {
      kind: "paid",
      amount: Number(row.amount),
      createdAt: row.createdAt.getTime(),
      paidAt: row.paidAt,
      smsMatchedAt: row.smsMatchedAt,
    };
  }

  if (row.status === PaymentSessionStatus.expired || row.status === PaymentSessionStatus.cancelled) {
    return { kind: "expired" };
  }

  if (row.status === PaymentSessionStatus.pending && isExpiredByTtl(row.createdAt)) {
    await prisma.paymentSession.update({
      where: { id: sessionId },
      data: { status: PaymentSessionStatus.expired },
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

const SMS_SNIPPET_MAX = 2000;

export async function markSessionPaidFromSms(
  sessionId: string,
  opts: { smsOccurredAt: Date; rawMessage: string },
): Promise<"updated" | "already_paid" | "not_pending"> {
  const snippet = opts.rawMessage.slice(0, SMS_SNIPPET_MAX);
  const now = new Date();

  const updated = await prisma.paymentSession.updateMany({
    where: { id: sessionId, status: PaymentSessionStatus.pending },
    data: {
      status: PaymentSessionStatus.paid,
      paidAt: now,
      smsMatchedAt: opts.smsOccurredAt,
      smsRawSnippet: snippet,
    },
  });

  if (updated.count === 1) return "updated";

  const row = await prisma.paymentSession.findUnique({ where: { id: sessionId } });
  if (row?.status === PaymentSessionStatus.paid) return "already_paid";
  return "not_pending";
}
