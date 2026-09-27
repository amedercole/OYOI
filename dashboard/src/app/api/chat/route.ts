import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { handleInboundSms } from "@/lib/agent";
import { listMessages, logMessage } from "@/lib/db";
import { getOwnerPhone, getTwilioPhone, sendToOwner } from "@/lib/sms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    messages: listMessages(200),
    twilioPhone: getTwilioPhone() || null,
  });
}

/** Owner message from the web Chat page — same thread as SMS, replies stay on web. */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const text = String(body.body || "").trim();
  if (!text) return NextResponse.json({ error: "body required" }, { status: 400 });

  const from = getOwnerPhone();

  logMessage({
    id: randomUUID(),
    direction: "inbound",
    from_number: from,
    to_number: getTwilioPhone() || "oyi",
    body: text,
    channel: "web",
  });

  const result = await handleInboundSms(from, text);
  for (const reply of result.replies) {
    await sendToOwner(from, reply.body, {
      quickReplies: reply.quickReplies,
      cards: reply.cards,
      channel: "web",
    });
  }

  return NextResponse.json(result);
}
