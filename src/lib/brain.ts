import { execFile, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const SEED_ROOT = path.join(process.cwd(), "brain-seed");
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
  if (keys.length === 0) return body;
  const fm = keys.map((k) => `${k}: ${frontmatter[k]}`).join("\n");
  return `---\n${fm}\n---\n\n${body.trim()}\n`;
}

function seedPathForSlug(slug: string): string {
  return path.join(SEED_ROOT, `${slug}.md`);
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

async function gbrainGet(slug: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(GBRAIN_BIN, ["get", slug, "--json"], {
      timeout: 15000,
      maxBuffer: 2 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout);
    return parsed.content || parsed.page?.content || parsed.body || stdout;
  } catch {
    try {
      const { stdout } = await execFileAsync(GBRAIN_BIN, ["get", slug], {
        timeout: 15000,
        maxBuffer: 2 * 1024 * 1024,
      });
      return stdout;
    } catch {
      return null;
    }
  }
}

async function gbrainPut(slug: string, content: string): Promise<void> {
  try {
    await new Promise<void>((resolve, reject) => {
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
  } catch (err) {
    console.warn("[brain] gbrain put failed, keeping local mirror only", err);
  }
}

export async function listPages(prefix?: string): Promise<BrainPage[]> {
  const slugs = walkMarkdown(SEED_ROOT).filter((s) => !prefix || s.startsWith(prefix));
  const pages: BrainPage[] = [];
  for (const slug of slugs) {
    const page = await getPage(slug);
    if (page) pages.push(page);
  }
  return pages;
}

export async function getPage(slug: string): Promise<BrainPage | null> {
  const file = seedPathForSlug(slug);
  let content: string | null = null;
  let mtime = new Date().toISOString();

  if (fs.existsSync(file)) {
    content = fs.readFileSync(file, "utf8");
    mtime = fs.statSync(file).mtime.toISOString();
  } else if (await gbrainAvailable()) {
    content = await gbrainGet(slug);
  }

  if (!content) return null;
  const { frontmatter, body } = parseFrontmatter(content);
  const titleMatch = body.match(/^#\s+(.+)$/m);
  return {
    slug,
    content,
    frontmatter,
    title: titleMatch?.[1] || slug,
    mtime,
  };
}

export async function putPage(
  slug: string,
  content: string,
  opts?: { syncGbrain?: boolean }
): Promise<BrainPage> {
  const file = seedPathForSlug(slug);
  fs.mkdirSync(path.dirname(file), { recursive: true });

  // Version history for diffs
  const versionsDir = path.join(process.cwd(), "data", "versions", slug);
  if (fs.existsSync(file)) {
    fs.mkdirSync(versionsDir, { recursive: true });
    const prev = fs.readFileSync(file, "utf8");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(path.join(versionsDir, `${stamp}.md`), prev);
  }

  fs.writeFileSync(file, content);
  if (opts?.syncGbrain !== false && (await gbrainAvailable())) {
    await gbrainPut(slug, content);
  }
  const page = await getPage(slug);
  if (!page) throw new Error(`Failed to write page ${slug}`);
  return page;
}

export async function updateFrontmatter(
  slug: string,
  patch: Record<string, string | number>,
  timelineNote?: string
): Promise<BrainPage> {
  const existing = await getPage(slug);
  if (!existing) throw new Error(`Page not found: ${slug}`);
  const { frontmatter, body } = parseFrontmatter(existing.content);
  const nextFm = { ...frontmatter, ...patch };
  let nextBody = body;
  if (timelineNote) {
    const date = new Date().toISOString().slice(0, 10);
    if (nextBody.includes("## Timeline")) {
      nextBody = nextBody.replace("## Timeline", `## Timeline\n- ${date}: ${timelineNote}`);
    } else {
      nextBody = `${nextBody.trim()}\n\n## Timeline\n- ${date}: ${timelineNote}\n`;
    }
  }
  return putPage(slug, serializePage(nextFm, nextBody));
}

export async function appendActionMemory(summary: string): Promise<void> {
  const slug = "actions/log";
  const existing = (await getPage(slug))?.content || "# Actions Log\n\n";
  const date = new Date().toISOString();
  const next = `${existing.trim()}\n\n## ${date}\n${summary}\n`;
  await putPage(slug, next);
}

export async function listInventory() {
  const pages = await listPages("inventory/");
  return pages.map((p) => ({
    slug: p.slug,
    name: String(p.frontmatter.name || p.title),
    qty: Number(p.frontmatter.qty ?? 0),
    unit: String(p.frontmatter.unit || ""),
    par: Number(p.frontmatter.par ?? 0),
    supplier: String(p.frontmatter.supplier || ""),
    sku: String(p.frontmatter.sku || ""),
    reorder_qty: Number(p.frontmatter.reorder_qty ?? 0),
    low: Number(p.frontmatter.qty ?? 0) < Number(p.frontmatter.par ?? 0),
    content: p.content,
  }));
}

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
    content: p.content,
  }));
}

export async function searchBrain(query: string): Promise<BrainPage[]> {
  const q = query.toLowerCase();
  const pages = await listPages();
  return pages.filter(
    (p) =>
      p.slug.toLowerCase().includes(q) ||
      p.title.toLowerCase().includes(q) ||
      p.content.toLowerCase().includes(q)
  );
}

export async function getVersions(slug: string): Promise<{ stamp: string; content: string }[]> {
  const dir = path.join(process.cwd(), "data", "versions", slug);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .reverse()
    .map((f) => ({
      stamp: f.replace(/\.md$/, ""),
      content: fs.readFileSync(path.join(dir, f), "utf8"),
    }));
}

export async function getRecentDiffs(limit = 20) {
  const versionsRoot = path.join(process.cwd(), "data", "versions");
  if (!fs.existsSync(versionsRoot)) return [];
  const diffs: { slug: string; stamp: string; before: string; after: string }[] = [];

  function collect(dir: string, slugParts: string[] = []) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collect(full, [...slugParts, entry.name]);
      } else if (entry.name.endsWith(".md")) {
        const slug = slugParts.join("/");
        const stamp = entry.name.replace(/\.md$/, "");
        const before = fs.readFileSync(full, "utf8");
        const after = fs.existsSync(seedPathForSlug(slug))
          ? fs.readFileSync(seedPathForSlug(slug), "utf8")
          : "";
        diffs.push({ slug, stamp, before, after });
      }
    }
  }
  collect(versionsRoot);
  return diffs.sort((a, b) => b.stamp.localeCompare(a.stamp)).slice(0, limit);
}

export { serializePage, parseFrontmatter, gbrainAvailable };
