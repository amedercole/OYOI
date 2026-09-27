import { NextResponse } from "next/server";
import { getBehaviorLog, getRecentDiffs, listPages } from "@/lib/brain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [pages, diffs, behavior] = await Promise.all([
    listPages(),
    getRecentDiffs(30),
    getBehaviorLog(),
  ]);
  return NextResponse.json({
    pages: pages.map((p) => ({
      slug: p.slug,
      title: p.title,
      mtime: p.mtime,
      preview: p.content.slice(0, 280),
    })),
    diffs,
    behavior,
  });
}
