import { NextRequest, NextResponse } from "next/server";
import { listChats, readThread, sendChat } from "@/lib/ufo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHANNEL = /^[A-Za-z0-9_-]{1,64}$/;

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  try {
    if (id) return NextResponse.json({ messages: await readThread(id) });
    return NextResponse.json({ chats: await listChats() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ufo unavailable";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { channel?: string; body?: string };
  const text = String(body.body || "").trim();
  const channel = String(body.channel || "");
  if (!text) return NextResponse.json({ error: "body required" }, { status: 400 });
  if (!CHANNEL.test(channel)) return NextResponse.json({ error: "channel required" }, { status: 400 });
  try {
    return NextResponse.json(await sendChat(channel, text));
  } catch (error) {
    const message = error instanceof Error ? error.message : "ufo unavailable";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
