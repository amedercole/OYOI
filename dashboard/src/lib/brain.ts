import { execFile, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { addDays, daysBetween, todayISO } from "./clock";

const execFileAsync = promisify(execFile);

const SEED_ROOT = path.join(process.cwd(), "brain-seed");
const LIVE_ROOT = path.join(process.cwd(), "data", "brain");
const VERSIONS_ROOT = path.join(process.cwd(), "data", "versions");
const GBRAIN_BIN = process.env.GBRAIN_BIN || path.join(process.env.HOME || "", ".bun/bin/gbrain");

export type BrainPage = {
  slug: string;
  content: string;
  frontmatter: Record<string, string | number>;
  title: string;
  mtime: string;
};

function parseFrontmatter(raw: string): { frontmatter: Record<string, string | number>; body: string } {
  if (!raw.startsWith("---")) return { frontmatter: {}, body: raw };
  const end = raw.indexOf("---", 3);
  if (end === -1) return { frontmatter: {}, body: raw };
  const block = raw.slice(3, end).trim();
  const body = raw.slice(end + 3).replace(/^\s+/, "");
  const frontmatter: Record<string, string | number> = {};
  for (const line of block.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value: string | number = line.slice(idx + 1).trim();
    if (/^-?\d+(\.\d+)?$/.test(value)) value = Number(value);
    frontmatter[key] = value;
  }
  return { frontmatter, body };
}

function serializePage(frontmatter: Record<string, string | number>, body: string): string {
  const keys = Object.keys(frontmatter);
  if (keys.length === 0) return `${body.trim()}\n`;
  const fm = keys.map((k) => `${k}: ${frontmatter[k]}`).join("\n");
  return `---\n${fm}\n---\n\n${body.trim()}\n`;
}

export function parseTimeline(content: string): string[] {
  const idx = content.indexOf("## Timeline");
  if (idx === -1) return [];
  return content
    .slice(idx)
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim());
}

/** Seeds use {{-N}} for "N days before the demo starts" so the story never goes stale. */
function resolveSeedDates(content: string): string {
  const today = todayISO();
  return content.replace(/\{\{(-?\d+)\}\}/g, (_, n) => addDays(today, Number(n)));
}

function ensureLive() {
  if (!fs.existsSync(LIVE_ROOT)) {
    fs.mkdirSync(path.dirname(LIVE_ROOT), { recursive: true });
    fs.cpSync(SEED_ROOT, LIVE_ROOT, { recursive: true });
    for (const slug of walkMarkdown(LIVE_ROOT)) {
      const file = livePathForSlug(slug);
      fs.writeFileSync(file, resolveSeedDates(fs.readFileSync(file, "utf8")));
    }
  }
}

function livePathForSlug(slug: string): string {
  return path.join(LIVE_ROOT, `${slug}.md`);
}

function walkMarkdown(dir: string, prefix = ""): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMarkdown(full, rel));
    else if (entry.name.endsWith(".md")) out.push(rel.replace(/\.md$/, ""));
  }
  return out;
}

async function gbrainAvailable(): Promise<boolean> {
  try {
    await execFileAsync(GBRAIN_BIN, ["--version"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function gbrainPut(slug: string, content: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(GBRAIN_BIN, ["put", slug, "--force"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("gbrain put timed out"));
    }, 20000);
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr || `gbrain put exited ${code}`));
    });
    child.stdin.write(content);
    child.stdin.end();
  });
}

// PGLite only allows one process at a time, so GBrain writes drain one at a time in the
// background instead of blocking the SMS reply. Pending writes to the same page collapse
// into the latest content.
type GlobalQueue = { __oyiGbrainPending?: Map<string, string>; __oyiGbrainDraining?: boolean };

function queueGbrainPut(slug: string, content: string) {
  const g = globalThis as unknown as GlobalQueue;
  g.__oyiGbrainPending ??= new Map();
  g.__oyiGbrainPending.set(slug, content);
  if (!g.__oyiGbrainDraining) void drainGbrainQueue(g);
}

async function drainGbrainQueue(g: GlobalQueue) {
  g.__oyiGbrainDraining = true;
  try {
    const pending = g.__oyiGbrainPending!;
    while (pending.size > 0) {
      const [slug, content] = pending.entries().next().value as [string, string];
      pending.delete(slug);
      await gbrainPut(slug, content).catch((err) => {
        console.warn(`[brain] gbrain put ${slug} failed, local mirror still updated`, err);
      });
    }
  } finally {
    g.__oyiGbrainDraining = false;
  }
}

export async function listPages(prefix?: string): Promise<BrainPage[]> {
  ensureLive();
  const slugs = walkMarkdown(LIVE_ROOT).filter((s) => !prefix || s.startsWith(prefix));
  const pages: BrainPage[] = [];
  for (const slug of slugs) {
    const page = await getPage(slug);
    if (page) pages.push(page);
  }
  return pages;
}

export async function getPage(slug: string): Promise<BrainPage | null> {
  ensureLive();
  const file = livePathForSlug(slug);
  if (!fs.existsSync(file)) return null;
  const content = fs.readFileSync(file, "utf8");
  const { frontmatter, body } = parseFrontmatter(content);
  const titleMatch = body.match(/^#\s+(.+)$/m);
  return {
    slug,
    content,
    frontmatter,
    title: titleMatch?.[1] || slug,
    mtime: fs.statSync(file).mtime.toISOString(),
  };
}

export async function putPage(slug: string, content: string): Promise<BrainPage> {
  ensureLive();
  const file = livePathForSlug(slug);
  fs.mkdirSync(path.dirname(file), { recursive: true });

  if (fs.existsSync(file)) {
    const versionsDir = path.join(VERSIONS_ROOT, slug);
    fs.mkdirSync(versionsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(path.join(versionsDir, `${stamp}.md`), fs.readFileSync(file, "utf8"));
  }

  fs.writeFileSync(file, content);
  queueGbrainPut(slug, content);

  const page = await getPage(slug);
  if (!page) throw new Error(`Failed to write page ${slug}`);
  return page;
}

/**
 * One write per edit so each change shows up as a single diff.
 * `replace` only touches the Compiled Truth section, never the Timeline history.
 */
export async function editPage(
  slug: string,
  edit: {
    patch?: Record<string, string | number>;
    timeline?: string;
    replace?: Array<[string, string]>;
  }
): Promise<BrainPage> {
  const existing = await getPage(slug);
  if (!existing) throw new Error(`Page not found: ${slug}`);
  const { frontmatter, body } = parseFrontmatter(existing.content);

  const tlIdx = body.indexOf("## Timeline");
  let truth = tlIdx === -1 ? body : body.slice(0, tlIdx);
  let timeline = tlIdx === -1 ? "" : body.slice(tlIdx);

  for (const [from, to] of edit.replace ?? []) {
    truth = truth.split(from).join(to);
  }

  if (edit.timeline) {
    const entry = `- ${todayISO()}: ${edit.timeline}`;
    timeline = timeline
      ? timeline.replace("## Timeline", `## Timeline\n${entry}`)
      : `## Timeline\n${entry}\n`;
  }

  const nextBody = `${truth.trimEnd()}\n\n${timeline}`.trim();
  return putPage(slug, serializePage({ ...frontmatter, ...(edit.patch ?? {}) }, nextBody));
}

export function appendTimeline(slug: string, note: string) {
  return editPage(slug, { timeline: note });
}

export async function appendActionMemory(summary: string): Promise<void> {
  const slug = "actions/log";
  const existing = (await getPage(slug))?.content || "# Actions Log\n\n";
  const next = `${existing.trim()}\n\n## ${todayISO()} ${new Date().toISOString().slice(11, 19)}\n${summary}\n`;
  await putPage(slug, next);
}

export type CheckupReason = "projected_low" | "order_day" | "recheck";

/** Rounds an estimated amount the way Tony would say it: whole units, or halves for small amounts. */
export function formatAmount(n: number): string {
  if (n >= 10) return String(Math.round(n));
  return String(Math.round(n * 2) / 2);
}

/**
 * Nobody weighs the cheese, so on-hand amounts are projections from the last count and an
 * estimated daily usage. The next check-up is the earlier of "projected to hit the low point"
 * and "usual order day", pushed back by any snooze from a "still have some" reply.
 */
function projectItem(fm: Record<string, string | number>) {
  const today = todayISO();
  const par = Number(fm.par ?? 0);
  const lastCount = Number(fm.last_count ?? 0);
  const lastCounted = String(fm.last_counted || today);
  const dailyUse = Number(fm.daily_use ?? 0);
  const every = Number(fm.order_every_days ?? 0);
  const lastOrdered = fm.last_ordered ? String(fm.last_ordered) : "";
  const snooze = fm.snooze_until ? String(fm.snooze_until) : "";

  const elapsed = Math.max(0, daysBetween(lastCounted, today));
  const estimate = Math.max(0, lastCount - dailyUse * elapsed);

  const candidates: { date: string; reason: CheckupReason }[] = [];
  if (dailyUse > 0) {
    const daysToLow = Math.ceil((lastCount - par) / dailyUse - 1e-9);
    candidates.push({ date: addDays(lastCounted, Math.max(0, daysToLow)), reason: "projected_low" });
  }
  if (every > 0 && lastOrdered) {
    candidates.push({ date: addDays(lastOrdered, every), reason: "order_day" });
  }
  candidates.sort((a, b) => a.date.localeCompare(b.date));
  let next = candidates[0] ?? null;
  if (next && snooze && snooze > next.date) next = { date: snooze, reason: "recheck" };

  return {
    estimate,
    daily_use: dailyUse,
    last_count: lastCount,
    last_counted: lastCounted,
    days_left: dailyUse > 0 ? estimate / dailyUse : null,
    next_checkup: next?.date ?? "",
    checkup_reason: next?.reason ?? null,
    due: !!next && next.date <= today,
    low: estimate <= par,
  };
}

export async function listInventory() {
  const pages = await listPages("inventory/");
  return pages.map((p) => ({
    slug: p.slug,
    name: String(p.frontmatter.name || p.title),
    unit: String(p.frontmatter.unit || ""),
    par: Number(p.frontmatter.par ?? 0),
    supplier: String(p.frontmatter.supplier || ""),
    sku: String(p.frontmatter.sku || ""),
    reorder_qty: Number(p.frontmatter.reorder_qty ?? 0),
    order_every_days: Number(p.frontmatter.order_every_days ?? 0),
    ...projectItem(p.frontmatter),
    content: p.content,
  }));
}

export type InventoryItem = Awaited<ReturnType<typeof listInventory>>[number];

export async function listAppliances() {
  const pages = await listPages("appliances/");
  return pages.map((p) => ({
    slug: p.slug,
    name: String(p.frontmatter.name || p.title),
    status: String(p.frontmatter.status || "unknown"),
    last_service: String(p.frontmatter.last_service || ""),
    next_service: String(p.frontmatter.next_service || ""),
    content: p.content,
  }));
}

export async function listWorkflows() {
  const pages = await listPages("workflows/");
  return pages.map((p) => ({
    slug: p.slug,
    id: String(p.frontmatter.id || p.slug),
    trigger: String(p.frontmatter.trigger || ""),
    action: String(p.frontmatter.action || ""),
    channel: String(p.frontmatter.channel || ""),
    supplier: String(p.frontmatter.supplier || ""),
    contact: String(p.frontmatter.contact || ""),
    title: p.title,
    fm: p.frontmatter,
    timeline: parseTimeline(p.content),
    content: p.content,
  }));
}

export type Workflow = Awaited<ReturnType<typeof listWorkflows>>[number];

export async function getBehaviorLog(): Promise<string[]> {
  const page = await getPage("preferences/owner-behavior");
  return page ? parseTimeline(page.content) : [];
}

export async function getRecentDiffs(limit = 20) {
  if (!fs.existsSync(VERSIONS_ROOT)) return [];
  const diffs: { slug: string; stamp: string; before: string; after: string }[] = [];

  function collect(dir: string, slugParts: string[] = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collect(full, [...slugParts, entry.name]);
      } else if (entry.name.endsWith(".md")) {
        const slug = slugParts.join("/");
        const live = livePathForSlug(slug);
        diffs.push({
          slug,
          stamp: entry.name.replace(/\.md$/, ""),
          before: fs.readFileSync(full, "utf8"),
          after: fs.existsSync(live) ? fs.readFileSync(live, "utf8") : "",
        });
      }
    }
  }
  collect(VERSIONS_ROOT);
  return diffs.sort((a, b) => b.stamp.localeCompare(a.stamp)).slice(0, limit);
}

/** Restores the live brain to the pristine seed and re-syncs GBrain. */
export async function resetBrain() {
  fs.rmSync(LIVE_ROOT, { recursive: true, force: true });
  fs.rmSync(VERSIONS_ROOT, { recursive: true, force: true });
  ensureLive();
  if (await gbrainAvailable()) {
    for (const slug of walkMarkdown(LIVE_ROOT)) {
      queueGbrainPut(slug, fs.readFileSync(livePathForSlug(slug), "utf8"));
    }
  }
}
