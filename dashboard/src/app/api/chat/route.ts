import { NextRequest, NextResponse } from "next/server";
import {
  listConversations,
  readDashboardThread,
  readThread,
  sendChat,
} from "@/lib/ufo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const conversations = await listConversations();
    const sms = conversations.find((c) => c.surface === "sms");
    const [webMessages, smsMessages] = await Promise.all([
      readDashboardThread(),
      sms ? readThread(sms.id) : Promise.resolve([]),
    ]);
    return NextResponse.json({
      web: webMessages,
      sms: smsMessages.map((m) => ({ ...m, channel: "sms" as const })),
      smsConversationId: sms?.id ?? null,
      smsPostable: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ufo unavailable";
    return NextResponse.json({ error: message, web: [], sms: [] }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const text = String(body.body || "").trim();
  if (!text) return NextResponse.json({ error: "body required" }, { status: 400 });
  try {
    const result = await sendChat(text);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "ufo unavailable";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
