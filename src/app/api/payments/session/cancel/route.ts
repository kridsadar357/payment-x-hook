import { NextResponse } from "next/server";
import { cancelPaymentSession } from "@/lib/paymentSessions";

export async function POST(req: Request) {
  let body: { sessionId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  if (!sessionId) {
    return NextResponse.json({ error: "missing_session_id" }, { status: 400 });
  }

  const result = await cancelPaymentSession(sessionId);
  if (result === "missing") {
    return NextResponse.json({ ok: false, status: "missing" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, status: result });
}

