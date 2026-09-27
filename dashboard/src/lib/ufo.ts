/**
 * Server-only client for the owner's ufo surfaces: chat (directive wire), conversation list,
 * transcript join, and the restaurant_inventory read projection.
 */

export type ChatMessage = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  channel: "web" | "sms";
  created_at: string;
};

export type ConversationRow = {
  id: string;
  title: string;
  surface: string;
  surface_label: string | null;
  speaker: string | null;
  agent: string;
  main: boolean;
  last_at: number;
  postable: boolean;
  channel: string | null;
  turn: { status: string };
  unread: boolean;
};

export type InventoryItem = {
  name: string;
  unit: string;
  on_hand: number | null;
  estimate: number | null;
  par: number | null;
  reorder_at: number | null;
  supplier: string | null;
  counted_at: string | null;
  daily_use: number | null;
  order_every_days: number | null;
  last_ordered: string | null;
  days_left: number | null;
  next_checkup: string | null;
  checkup_reason: "projected_low" | "order_day" | "recheck" | null;
  due: boolean;
  low: boolean;
  to_order: number | null;
  last_checkup: string | null;
};

export type InventoryView = {
  items: InventoryItem[];
  checkup_requested: boolean;
};

const DASHBOARD_CHANNEL = "dashboard";
const HOLD_MS = 90_000;

function config() {
  const base = process.env.UFO_BASE_URL?.replace(/\/$/, "");
  const token = process.env.UFO_TOKEN?.trim();
  if (!base) throw new Error("UFO_BASE_URL is required");
  if (!token) throw new Error("UFO_TOKEN is required");
  return { base, token };
}

function authHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("authorization", `Bearer ${config().token}`);
  return headers;
}

function parseDirectives(body: string): { verb: string; fields: string[] }[] {
  return body
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [verb, ...fields] = line.split("\t");
      return { verb, fields };
    });
}

function unescapeField(value: string): string {
  return value.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\\\/g, "\\");
}

async function readStream(res: Response): Promise<string> {
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ufo ${res.status}: ${detail.slice(0, 200)}`);
  }
  return res.text();
}

async function holdChat(
  path: string,
  body: string,
  since?: { turnId: string; cursor: string }
): Promise<{ says: string[]; yous: string[]; since?: { turnId: string; cursor: string }; done: boolean }> {
  const { base } = config();
  const headers = authHeaders({ "content-type": "text/plain" });
  if (since) headers.set("x-ufo-since", `${since.turnId}:${since.cursor}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HOLD_MS);
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await readStream(res);
    const lines = parseDirectives(text);
    const says: string[] = [];
    const yous: string[] = [];
    let nextSince: { turnId: string; cursor: string } | undefined;
    let done = false;
    let poll = false;
    for (const { verb, fields } of lines) {
      if (verb === "say" && fields[0]) says.push(unescapeField(fields[0]));
      if (verb === "you" && fields[0]) yous.push(unescapeField(fields[0]));
      if (verb === "since" && fields[0] && fields[1] !== undefined) {
        nextSince = { turnId: fields[0], cursor: fields[1] };
      }
      if (verb === "ask" || verb === "listen") done = true;
      if (verb === "poll") poll = true;
    }
    if (poll && nextSince && !done) {
      return holdChat(path, "", nextSince);
    }
    return { says, yous, since: nextSince, done: done || !poll };
  } finally {
    clearTimeout(timer);
  }
}

export async function sendChat(text: string): Promise<{ reply: string }> {
  const path = `/surface/ufo/${DASHBOARD_CHANNEL}`;
  const { says } = await holdChat(path, text);
  return { reply: says.join("\n\n").trim() };
}

export async function listConversations(): Promise<ConversationRow[]> {
  const { base } = config();
  const res = await fetch(`${base}/surface/ufo/conversations`, {
    headers: authHeaders(),
    cache: "no-store",
  });
  const data = (await readStream(res).then((t) => JSON.parse(t))) as {
    conversations: ConversationRow[];
  };
  return data.conversations ?? [];
}

export async function readThread(conversationId: string): Promise<ChatMessage[]> {
  const path = `/surface/ufo/conversation/${conversationId}`;
  const { base } = config();
  const headers = authHeaders({ "content-type": "text/plain" });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers,
      body: "",
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await readStream(res);
    const lines = parseDirectives(text);
    const messages: ChatMessage[] = [];
    let seq = 0;
    for (const { verb, fields } of lines) {
      if (verb === "since" || verb === "listen" || verb === "ask" || verb === "poll") break;
      if (verb === "you" && fields[0]) {
        messages.push({
          id: `${conversationId}-you-${seq++}`,
          direction: "inbound",
          body: unescapeField(fields[0]),
          channel: "sms",
          created_at: new Date().toISOString(),
        });
      }
      if (verb === "say" && fields[0]) {
        messages.push({
          id: `${conversationId}-say-${seq++}`,
          direction: "outbound",
          body: unescapeField(fields[0]),
          channel: "sms",
          created_at: new Date().toISOString(),
        });
      }
    }
    return messages;
  } finally {
    clearTimeout(timer);
  }
}

export async function readDashboardThread(): Promise<ChatMessage[]> {
  const path = `/surface/ufo/${DASHBOARD_CHANNEL}`;
  const { base } = config();
  const headers = authHeaders({ "content-type": "text/plain" });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers,
      body: "",
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await readStream(res);
    const lines = parseDirectives(text);
    const messages: ChatMessage[] = [];
    let seq = 0;
    for (const { verb, fields } of lines) {
      if (verb === "since" || verb === "listen" || verb === "ask" || verb === "poll") break;
      if (verb === "you" && fields[0]) {
        messages.push({
          id: `dashboard-you-${seq++}`,
          direction: "inbound",
          body: unescapeField(fields[0]),
          channel: "web",
          created_at: new Date().toISOString(),
        });
      }
      if (verb === "say" && fields[0]) {
        messages.push({
          id: `dashboard-say-${seq++}`,
          direction: "outbound",
          body: unescapeField(fields[0]),
          channel: "web",
          created_at: new Date().toISOString(),
        });
      }
    }
    return messages;
  } finally {
    clearTimeout(timer);
  }
}

export async function getInventory(): Promise<InventoryView> {
  const { base } = config();
  const res = await fetch(`${base}/ext/restaurant_inventory/inventory`, {
    headers: authHeaders(),
    cache: "no-store",
  });
  return JSON.parse(await readStream(res)) as InventoryView;
}

export function debuggerUrl(): string {
  return `${config().base}/surface/debug`;
}
