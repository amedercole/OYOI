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

/** Simulate an inbound owner SMS from the dashboard phone mirror */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const text = String(body.body || "").trim();
  if (!text) return NextResponse.json({ error: "body required" }, { status: 400 });

  const from = getOwnerPhone() || "+15555550100";
  const to = getTwilioPhone() || "+15555550199";

  logMessage({
    id: randomUUID(),
    direction: "inbound",
    from_number: from,
    to_number: to,
    body: text,
  });

  const result = await handleInboundSms(from, text);
  await sendSms(from, result.reply);

  return NextResponse.json(result);
}
