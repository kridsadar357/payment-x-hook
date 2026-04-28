import {
  getSessionStateForNotify,
  markSessionPaidFromSms,
} from "@/lib/paymentSessions";
import {
  amountsMatch,
  isWithinTransferWindow,
  parseThaiBankSmsMessage,
} from "@/lib/parseBankSms";

const EARLY_SLACK_MS = 60_000;
const LATE_MS = 150_000;

export type NotifyHttpResult = { status: number; body: Record<string, unknown> };

/** Logic ร่วม: POST /api/payments/notify และ POST /api/payments/notify/[...slug] */
export async function executePaymentNotify(
  sessionId: string,
  message: string,
): Promise<NotifyHttpResult> {
  const state = await getSessionStateForNotify(sessionId);

  if (state.kind === "missing" || state.kind === "expired") {
    return {
      status: 404,
      body: { ok: false, matched: false, reason: "session_not_found_or_expired" },
    };
  }

  if (state.kind === "paid") {
    return {
      status: 200,
      body: {
        ok: true,
        matched: true,
        paymentSuccess: true,
        alreadyPaid: true,
        amount: state.amount,
        sessionId,
        sessionCreatedAt: new Date(state.createdAt).toISOString(),
        paidAt: state.paidAt?.toISOString() ?? null,
        smsMatchedAt: state.smsMatchedAt?.toISOString() ?? null,
      },
    };
  }

  const session = state;

  const parsed = parseThaiBankSmsMessage(message);
  if (!parsed) {
    return {
      status: 200,
      body: {
        ok: true,
        matched: false,
        reason: "parse_error",
        detail: "ไม่สามารถอ่านวันที่/เวลา/ยอดจากข้อความได้",
      },
    };
  }

  if (!amountsMatch(parsed.transferAmount, session.amount)) {
    return {
      status: 200,
      body: {
        ok: true,
        matched: false,
        reason: "amount_mismatch",
        expectedAmount: session.amount,
        parsedAmount: parsed.transferAmount,
        parsed: {
          smsTime: parsed.occurredAt.toISOString(),
          rawDate: parsed.rawDate,
          rawTime: parsed.rawTime,
        },
      },
    };
  }

  const smsMs = parsed.occurredAt.getTime();
  if (!isWithinTransferWindow(smsMs, session.createdAt, EARLY_SLACK_MS, LATE_MS)) {
    return {
      status: 200,
      body: {
        ok: true,
        matched: false,
        reason: "outside_time_window",
        detail:
          "เวลาใน SMS ไม่อยู่ในช่วงที่อนุญาต (หลังเริ่มรายการไม่เกิน 2.5 นาที และไม่ก่อนเกิน 1 นาที)",
        sessionCreatedAt: new Date(session.createdAt).toISOString(),
        smsTime: parsed.occurredAt.toISOString(),
        limitsMs: { earlySlack: EARLY_SLACK_MS, late: LATE_MS },
      },
    };
  }

  const mark = await markSessionPaidFromSms(sessionId, {
    smsOccurredAt: parsed.occurredAt,
    rawMessage: message,
  });

  if (mark === "already_paid") {
    return {
      status: 200,
      body: {
        ok: true,
        matched: true,
        paymentSuccess: true,
        alreadyPaid: true,
        sessionId,
        amount: session.amount,
        sessionCreatedAt: new Date(session.createdAt).toISOString(),
        smsTime: parsed.occurredAt.toISOString(),
        parsed: {
          rawDate: parsed.rawDate,
          rawTime: parsed.rawTime,
          transferAmount: parsed.transferAmount,
        },
      },
    };
  }

  if (mark === "not_pending") {
    return {
      status: 409,
      body: { ok: false, matched: false, reason: "session_not_pending" },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      matched: true,
      paymentSuccess: true,
      alreadyPaid: false,
      sessionId,
      amount: session.amount,
      sessionCreatedAt: new Date(session.createdAt).toISOString(),
      smsTime: parsed.occurredAt.toISOString(),
      parsed: {
        rawDate: parsed.rawDate,
        rawTime: parsed.rawTime,
        transferAmount: parsed.transferAmount,
      },
    },
  };
}
