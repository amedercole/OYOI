import { NextResponse } from "next/server";
import { listInventory, listAppliances } from "@/lib/brain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [inventory, appliances] = await Promise.all([listInventory(), listAppliances()]);
  return NextResponse.json({ inventory, appliances });
}
