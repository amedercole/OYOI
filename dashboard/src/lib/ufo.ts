/**
 * Server-only client for the owner's ufo surfaces: chat (directive wire), conversation list,
 * transcript join, and the restaurant_inventory read projection.
 */

export type SharedFile = { name: string; url: string };

export type ChatMessage = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  files: SharedFile[];
};

export type ChatSummary = {
  id: string;
  title: string;
  kind: "web" | "text";
  channel: string | null;
  lastAt: number;
  busy: boolean;
};

type ConversationRow = {
  id: string;
  title: string;
  surface: string;
  last_at: number;
  channel: string | null;
  turn: "running" | "queued" | "parked" | "idle";
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
  return value.replace(/\\([\\nt])/g, (_, c: string) => (c === "n" ? "\n" : c === "t" ? "\t" : "\\"));
}

function agentText(verb: string, fields: string[]): string | null {
  if (verb === "say") return fields[0] ? unescapeField(fields[0]) : null;
  if (verb !== "frame" || fields[0] !== "terminal" || !fields[1]) return null;
  const { text } = JSON.parse(unescapeField(fields[1])) as { text: string | null };
  return text || null;
}

function threadMessages(text: string, idPrefix: string): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const { verb, fields } of parseDirectives(text)) {
    if (verb === "since" || verb === "listen" || verb === "ask" || verb === "poll") break;
    if (verb === "file" && fields[0]) {
      const last = messages.at(-1);
      const file = { name: unescapeField(fields[0]), url: fields[2] ?? "" };
      if (last?.direction === "outbound") last.files.push(file);
      else messages.push({ id: `${idPrefix}-${messages.length}`, direction: "outbound", body: "", files: [file] });
      continue;
    }
    const said = verb === "you" && fields[0] ? unescapeField(fields[0]) : agentText(verb, fields);
    if (said === null) continue;
    messages.push({
      id: `${idPrefix}-${messages.length}`,
      direction: verb === "you" ? "inbound" : "outbound",
      body: said,
      files: [],
    });
  }
  return messages;
}

async function replay(path: string): Promise<string> {
  const { base } = config();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: authHeaders({ "content-type": "text/plain" }),
      body: "",
      signal: controller.signal,
      cache: "no-store",
    });
    return await readStream(res);
  } finally {
    clearTimeout(timer);
  }
}

async function readStream(res: Response): Promise<string> {
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ufo ${res.status}: ${detail.slice(0, 200)}`);
  }
  return res.text();
}

async function holdChat(path: string, body: string, since?: { turnId: string; cursor: string }): Promise<string[]> {
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
    let nextSince: { turnId: string; cursor: string } | undefined;
    let done = false;
    let poll = false;
    for (const { verb, fields } of lines) {
      const said = agentText(verb, fields);
      if (said !== null) says.push(said);
      if (verb === "since" && fields[0] && fields[1] !== undefined) {
        nextSince = { turnId: fields[0], cursor: fields[1] };
      }
      if (verb === "ask" || verb === "listen") done = true;
      if (verb === "poll") poll = true;
    }
    if (poll && nextSince && !done) return [...says, ...(await holdChat(path, "", nextSince))];
    return says;
  } finally {
    clearTimeout(timer);
  }
}

export async function sendChat(channel: string, text: string): Promise<{ reply: string }> {
  const says = await holdChat(`/surface/ufo/${encodeURIComponent(channel)}`, text);
  return { reply: says.join("\n\n").trim() };
}

export async function listChats(): Promise<ChatSummary[]> {
  const { base } = config();
  const res = await fetch(`${base}/surface/ufo/conversations`, {
    headers: authHeaders(),
    cache: "no-store",
  });
  const { conversations } = JSON.parse(await readStream(res)) as { conversations: ConversationRow[] };
  return conversations
    .filter((row) => row.surface === "sms" || (row.surface === "ufo" && row.channel !== null))
    .map((row) => ({
      id: row.id,
      title: row.title,
      kind: row.surface === "sms" ? "text" : "web",
      channel: row.channel,
      lastAt: row.last_at,
      busy: row.turn === "running" || row.turn === "queued",
    }));
}

export async function readThread(conversationId: string): Promise<ChatMessage[]> {
  return threadMessages(
    await replay(`/surface/ufo/conversation/${encodeURIComponent(conversationId)}`),
    conversationId
  );
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
