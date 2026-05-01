import { NextResponse } from "next/server";
import { executePaymentNotify } from "@/lib/executePaymentNotify";
import { verifyWebhookSecret } from "@/lib/webhookAuth";

export async function POST(req: Request) {
  const authError = verifyWebhookSecret(req);
  if (authError) return authError;

  let body: { sessionId?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  const message = typeof body.message === "string" ? body.message : "";

  if (!sessionId || !message.trim()) {
    return NextResponse.json(
      { error: "missing_sessionId_or_message" },
      { status: 400 },
    );
  }

  const { status, body: json } = await executePaymentNotify(sessionId, message);
  return NextResponse.json(json, { status });
}
