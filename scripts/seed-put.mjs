#!/usr/bin/env node
// Pushes brain-seed/ into GBrain, resolving {{-N}} tokens to dates N days before today.
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "brain-seed");
const bin = process.env.GBRAIN_BIN || "gbrain";

function today() {
  const now = new Date();
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

function resolve(content) {
  return content.replace(/\{\{(-?\d+)\}\}/g, (_, n) =>
    new Date(today() + Number(n) * 86_400_000).toISOString().slice(0, 10)
  );
}

function walk(dir, prefix = "") {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) return walk(path.join(dir, e.name), rel);
    return e.name.endsWith(".md") ? [rel.replace(/\.md$/, "")] : [];
  });
}

for (const slug of walk(root)) {
  const content = resolve(fs.readFileSync(path.join(root, `${slug}.md`), "utf8"));
  const res = spawnSync(bin, ["put", slug, "--force"], { input: content, stdio: ["pipe", "ignore", "inherit"] });
  console.log(`${res.status === 0 ? "ok  " : "fail"} ${slug}`);
}
