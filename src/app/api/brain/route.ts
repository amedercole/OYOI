import { NextResponse } from "next/server";
import { getRecentDiffs, listPages } from "@/lib/brain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [pages, diffs] = await Promise.all([listPages(), getRecentDiffs(30)]);
  return NextResponse.json({
    pages: pages.map((p) => ({
      slug: p.slug,
      title: p.title,
      mtime: p.mtime,
      preview: p.content.slice(0, 280),
    })),
    diffs,
  });
}
