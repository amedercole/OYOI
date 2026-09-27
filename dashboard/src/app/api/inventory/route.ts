import { NextResponse } from "next/server";
import { getInventory } from "@/lib/ufo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const view = await getInventory();
    const today = new Date().toISOString().slice(0, 10);
    const inventory = view.items.map((item) => ({
      slug: item.name.toLowerCase().replace(/\s+/g, "-"),
      name: item.name,
      unit: item.unit,
      par: item.reorder_at ?? item.par ?? 0,
      stock_par: item.par,
      estimate: item.estimate ?? 0,
      daily_use: item.daily_use ?? 0,
      last_count: item.on_hand ?? 0,
      last_counted: item.counted_at ? item.counted_at.slice(0, 10) : today,
      days_left: item.days_left,
      next_checkup: item.next_checkup ?? "",
      checkup_reason: item.checkup_reason,
      due: item.due,
      low: item.low,
      supplier: item.supplier,
      to_order: item.to_order,
    }));
    return NextResponse.json({
      inventory,
      checkup_requested: view.checkup_requested,
      clock: { today, offsetDays: 0 },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ufo unavailable";
    return NextResponse.json({ error: message, inventory: [] }, { status: 503 });
  }
}
