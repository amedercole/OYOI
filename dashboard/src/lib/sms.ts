import twilio from "twilio";
import { randomUUID } from "crypto";
import { logMessage, type ProductCard } from "./db";

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

export type SmsOptions = {
  quickReplies?: string[];
  cards?: ProductCard[];
};

function formatSmsBody(body: string, opts?: SmsOptions): string {
  let text = body;
  if (opts?.cards?.length) {
    const lines = opts.cards.map(
      (c, i) => `${i + 1}) ${c.title} — ${c.price} @ ${c.source}\n${c.link}`
    );
    text = `${body}\n\n${lines.join("\n\n")}\n\n(reply 1, 2, 3 or describe what you want)`;
  } else if (opts?.quickReplies?.length) {
    text = `${body}\n\n(${opts.quickReplies.join(" / ")})`;
  }
  return text;
}

/**
 * Quick replies and product cards render in the dashboard phone mirror.
 * Plain SMS gets a numbered list / hint line instead.
 */
export async function sendSms(to: string, body: string, opts?: SmsOptions | string[]) {
  // Back-compat: third arg used to be quickReplies string[]
  const options: SmsOptions | undefined = Array.isArray(opts)
    ? { quickReplies: opts }
    : opts;

  const from = getTwilioPhone();
  const c = client();

  logMessage({
    id: randomUUID(),
    direction: "outbound",
    from_number: from || "oyoi",
    to_number: to,
    body,
    quick_replies: options?.quickReplies,
    cards: options?.cards,
  });

  if (!c || !from || to === DEMO_OWNER_PHONE) {
    console.log(`[sms:mock] -> ${to}: ${body}`);
    return { sid: `mock_${Date.now()}`, mocked: true };
  }

  const msg = await c.messages.create({
    to,
    from,
    body: formatSmsBody(body, options),
  });
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
