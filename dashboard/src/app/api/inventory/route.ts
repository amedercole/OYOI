import { NextResponse } from "next/server";
import { listInventory, listAppliances } from "@/lib/brain";
import { getClock } from "@/lib/clock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [inventory, appliances] = await Promise.all([listInventory(), listAppliances()]);
  return NextResponse.json({ inventory, appliances, clock: getClock() });
}
