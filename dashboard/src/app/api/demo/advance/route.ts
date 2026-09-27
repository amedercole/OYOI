import { NextResponse } from "next/server";
import { runDueCheckups } from "@/lib/agent";
import { advanceClock } from "@/lib/clock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Demo only: jump the clock forward and fire whatever check-ups come due that morning. */
export async function POST(req: Request) {
  const { days = 1 } = (await req.json().catch(() => ({}))) as { days?: number };
  const clock = advanceClock(Math.max(1, Math.min(14, Number(days) || 1)));
  const checkups = await runDueCheckups();
  return NextResponse.json({ clock, ...checkups });
}
