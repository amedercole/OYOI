import { NextResponse } from "next/server";
import { resetBrain } from "@/lib/brain";
import { resetClock } from "@/lib/clock";
import { resetDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  resetDb();
  resetClock();
  await resetBrain();
  return NextResponse.json({ ok: true });
}
