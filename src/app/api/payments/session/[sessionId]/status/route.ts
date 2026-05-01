import { NextResponse } from "next/server";
import { getSessionStatusForClient } from "@/lib/paymentSessions";

export async function GET(
  _req: Request,
  context: { params: { sessionId: string } },
) {
  const sessionId = (context.params.sessionId ?? "").trim();
  if (!sessionId) {
    return NextResponse.json({ error: "missing_session_id" }, { status: 400 });
  }

  const state = await getSessionStatusForClient(sessionId);
  if (state.kind === "missing") {
    return NextResponse.json({ ok: false, status: "missing" }, { status: 404 });
  }

  if (state.kind === "expired_or_cancelled") {
    return NextResponse.json({ ok: true, status: "expired_or_cancelled" });
  }

  if (state.kind === "pending") {
    return NextResponse.json({
      ok: true,
      status: "pending",
      amount: state.amount,
      createdAt: new Date(state.createdAt).toISOString(),
    });
  }

  return NextResponse.json({
    ok: true,
    status: "paid",
    amount: state.amount,
    createdAt: new Date(state.createdAt).toISOString(),
    paidAt: state.paidAt?.toISOString() ?? null,
    smsMatchedAt: state.smsMatchedAt?.toISOString() ?? null,
  });
}

