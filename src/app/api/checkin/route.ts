import { NextResponse } from "next/server";
import { runMorningCheckin } from "@/lib/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(await runMorningCheckin());
}
