import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { handleInboundSms } from "@/lib/agent";
import { logMessage } from "@/lib/db";
import { sendSms, validateTwilioSignature } from "@/lib/sms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((value, key) => {
    params[key] = String(value);
  });

  const signature = req.headers.get("x-twilio-signature");
  const publicBase = process.env.PUBLIC_BASE_URL;
  const url = publicBase
    ? `${publicBase.replace(/\/$/, "")}/api/twilio/inbound`
    : req.url;

  if (!validateTwilioSignature(signature, url, params)) {
    return new NextResponse("Invalid signature", { status: 403 });
  }

  const from = params.From || "";
  const to = params.To || "";
  const body = params.Body || "";

  logMessage({
    id: randomUUID(),
    direction: "inbound",
    from_number: from,
    to_number: to,
    body,
  });

  // Twilio times out after ~15s, so answer with empty TwiML now and reply via the REST API.
  setImmediate(() => {
    void (async () => {
      try {
        const result = await handleInboundSms(from, body);
        for (const reply of result.replies) {
          await sendSms(from, reply.body, reply.quickReplies);
        }
      } catch (err) {
        console.error("[twilio/inbound] agent error", err);
        try {
          await sendSms(from, "Sorry, hit a snag. Try again in a moment.");
        } catch {
          /* ignore */
        }
      }
    })();
  });

  const emptyTwiml = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
  return new NextResponse(emptyTwiml, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
