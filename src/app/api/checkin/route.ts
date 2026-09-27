import { NextRequest, NextResponse } from "next/server";
import { runMorningCheckin } from "@/lib/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest) {
  const result = await runMorningCheckin();
  return NextResponse.json(result);
}

export async function GET() {
  const result = await runMorningCheckin();
  return NextResponse.json(result);
}
