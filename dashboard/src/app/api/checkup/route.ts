import { NextResponse } from "next/server";
import { sendChat } from "@/lib/ufo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await sendChat(
      "Send the inventory check-up now. Use inventory_checkup_now."
    );
    return NextResponse.json({ ok: true, text: result.reply });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ufo unavailable";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
