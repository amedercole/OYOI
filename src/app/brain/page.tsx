"use client";

import { useEffect, useState } from "react";

type Diff = {
  slug: string;
  stamp: string;
  before: string;
  after: string;
};

type PageMeta = {
  slug: string;
  title: string;
  mtime: string;
  preview: string;
};

export default function BrainPage() {
  const [pages, setPages] = useState<PageMeta[]>([]);
  const [diffs, setDiffs] = useState<Diff[]>([]);

  useEffect(() => {
    async function load() {
      const res = await fetch("/api/brain");
      const data = await res.json();
      setPages(data.pages || []);
      setDiffs(data.diffs || []);
    }
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  return (
    <div>
      <h1 className="page-title">Brain</h1>
      <p className="page-sub">
        GBrain-backed company memory — inventory pages, workflows, and diffs of what the agent
        learned.
      </p>

      <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.4rem" }}>Recent diffs</h2>
      <div style={{ display: "grid", gap: "0.85rem", marginBottom: "2rem" }}>
        {diffs.length === 0 && (
          <p className="muted">No changes yet. Ask the agent to remember something or complete an order.</p>
        )}
        {diffs.map((d) => (
          <div className="panel" key={`${d.slug}-${d.stamp}`}>
            <h3 style={{ marginBottom: "0.25rem" }}>{d.slug}</h3>
            <p className="muted">{d.stamp}</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <div>
                <strong>Before</strong>
                <pre className="mono">{d.before.slice(0, 500)}</pre>
              </div>
              <div>
                <strong>After</strong>
                <pre className="mono">{d.after.slice(0, 500)}</pre>
              </div>
            </div>
          </div>
        ))}
      </div>

      <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.4rem" }}>All pages</h2>
      <div className="grid-cards">
        {pages.map((p) => (
          <div className="panel" key={p.slug}>
            <h3>{p.title}</h3>
            <p className="muted mono">{p.slug}</p>
            <p style={{ marginTop: "0.5rem", fontSize: "0.9rem" }}>{p.preview}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
