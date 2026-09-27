import twilio from "twilio";
import { randomUUID } from "crypto";
import { logMessage } from "./db";

const DEMO_OWNER_PHONE = "+15555550100";

function client() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return twilio(sid, token);
}

export function getTwilioPhone() {
  return process.env.TWILIO_PHONE_NUMBER || "";
}

export function getOwnerPhone() {
  return process.env.OWNER_PHONE_NUMBER || DEMO_OWNER_PHONE;
}

/**
 * Quick replies render as tappable buttons in the dashboard phone mirror.
 * Plain SMS has no buttons, so real texts get them as a short hint line instead;
 * the agent understands free-form replies either way.
 */
export async function sendSms(to: string, body: string, quickReplies?: string[]) {
  const from = getTwilioPhone();
  const c = client();

  logMessage({
    id: randomUUID(),
    direction: "outbound",
    from_number: from || "oyoi",
    to_number: to,
    body,
    quick_replies: quickReplies,
  });

  if (!c || !from || to === DEMO_OWNER_PHONE) {
    console.log(`[sms:mock] -> ${to}: ${body}`);
    return { sid: `mock_${Date.now()}`, mocked: true };
  }

  const smsBody = quickReplies?.length ? `${body}\n\n(${quickReplies.join(" / ")})` : body;
  const msg = await c.messages.create({ to, from, body: smsBody });
  return { sid: msg.sid, mocked: false };
}

export function validateTwilioSignature(
  signature: string | null,
  url: string,
  params: Record<string, string>
): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) {
    return process.env.NODE_ENV !== "production";
  }
  if (!signature) return false;
  return twilio.validateRequest(token, signature, url, params);
}
