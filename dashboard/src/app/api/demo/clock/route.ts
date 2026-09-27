import { NextResponse } from "next/server";
import { getClock } from "@/lib/clock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getClock());
}
