import twilio from "twilio";
import { randomUUID } from "crypto";
import { getLastOwnerChannel, logMessage, type MessageChannel, type ProductCard } from "./db";

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

export type SendOptions = {
  quickReplies?: string[];
  cards?: ProductCard[];
  /** Force a channel; otherwise follow Tony's last inbound channel. */
  channel?: MessageChannel;
};

function formatSmsBody(body: string, opts?: SendOptions): string {
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
 * Reply to Tony on the right channel. Web replies are logged only (shown in /chat);
 * SMS replies also go out through Twilio. Async agent follow-ups (shop results, etc.)
 * omit `channel` and inherit wherever Tony last wrote from.
 */
export async function sendToOwner(to: string, body: string, opts?: SendOptions | string[]) {
  const options: SendOptions | undefined = Array.isArray(opts)
    ? { quickReplies: opts }
    : opts;

  const channel: MessageChannel = options?.channel ?? getLastOwnerChannel();
  const from = getTwilioPhone();

  logMessage({
    id: randomUUID(),
    direction: "outbound",
    from_number: from || "oyi",
    to_number: to,
    body,
    channel,
    quick_replies: options?.quickReplies,
    cards: options?.cards,
  });

  if (channel === "web") {
    console.log(`[chat:web] -> ${to}: ${body}`);
    return { sid: `web_${Date.now()}`, mocked: true, channel };
  }

  const c = client();
  if (!c || !from || to === DEMO_OWNER_PHONE) {
    console.log(`[sms:mock] -> ${to}: ${body}`);
    return { sid: `mock_${Date.now()}`, mocked: true, channel };
  }

  const msg = await c.messages.create({
    to,
    from,
    body: formatSmsBody(body, options),
  });
  return { sid: msg.sid, mocked: false, channel };
}

/** @deprecated Prefer sendToOwner — kept as an alias for older call sites. */
export const sendSms = sendToOwner;

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
