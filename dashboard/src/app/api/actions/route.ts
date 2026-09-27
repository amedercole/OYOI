import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { handleInboundSms } from "@/lib/agent";
import { listActionRuns, logMessage } from "@/lib/db";
import { getOwnerPhone, getTwilioPhone, sendSms } from "@/lib/sms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ actions: listActionRuns(50) });
}

/** Simulate an inbound owner SMS (typed or a tapped quick-reply button) from the phone mirror. */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const text = String(body.body || "").trim();
  if (!text) return NextResponse.json({ error: "body required" }, { status: 400 });

  const from = getOwnerPhone();

  logMessage({
    id: randomUUID(),
    direction: "inbound",
    from_number: from,
    to_number: getTwilioPhone() || "oyoi",
    body: text,
  });

  const result = await handleInboundSms(from, text);
  for (const reply of result.replies) {
    await sendSms(from, reply.body, {
      quickReplies: reply.quickReplies,
      cards: reply.cards,
    });
  }

  return NextResponse.json(result);
}
