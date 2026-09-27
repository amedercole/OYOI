import { NextResponse } from "next/server";
import { resetBrain } from "@/lib/brain";
import { resetDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  resetDb();
  await resetBrain();
  return NextResponse.json({ ok: true });
}
