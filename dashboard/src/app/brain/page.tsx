"use client";

import { useEffect, useState } from "react";
import { EmptyState, PageHeader } from "@/components/ui";

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
  const [behavior, setBehavior] = useState<string[]>([]);

  useEffect(() => {
    async function load() {
      const res = await fetch("/api/brain");
      const data = await res.json();
      setPages(data.pages || []);
      setDiffs(data.diffs || []);
      setBehavior(data.behavior || []);
    }
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  return (
    <div>
      <PageHeader
        title="Brain"
        subtitle="Backend memory layer (GBrain). Hidden from the main nav — opened from Demo → View brain."
      />

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <div className="card-title">What I&apos;ve learned about how Tony works</div>
        {behavior.length === 0 ? (
          <EmptyState>Nothing learned yet.</EmptyState>
        ) : (
          <ul className="timeline">
            {behavior.map((entry, i) => (
              <li key={i}>{entry}</li>
            ))}
          </ul>
        )}
      </div>

      <h2 style={{ fontSize: "1.15rem", fontWeight: 650, margin: "0 0 0.85rem" }}>Recent diffs</h2>
      <div style={{ display: "grid", gap: "0.85rem", marginBottom: "2rem" }}>
        {diffs.length === 0 && (
          <EmptyState>No changes yet. Ask the agent to remember something or complete an order.</EmptyState>
        )}
        {diffs.map((d) => (
          <div className="card" key={`${d.slug}-${d.stamp}`}>
            <h3 style={{ margin: "0 0 0.25rem", fontSize: "1rem" }}>{d.slug}</h3>
            <p className="muted small">{d.stamp}</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginTop: "0.65rem" }}>
              <div>
                <strong className="small">Before</strong>
                <pre className="mono">{d.before.slice(0, 500)}</pre>
              </div>
              <div>
                <strong className="small">After</strong>
                <pre className="mono">{d.after.slice(0, 500)}</pre>
              </div>
            </div>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: "1.15rem", fontWeight: 650, margin: "0 0 0.85rem" }}>All pages</h2>
      <div className="grid-cards">
        {pages.map((p) => (
          <div className="card" key={p.slug}>
            <h3 style={{ margin: "0 0 0.35rem", fontSize: "1rem" }}>{p.title}</h3>
            <p className="muted small mono" style={{ padding: 0, border: "none", background: "transparent" }}>
              {p.slug}
            </p>
            <p style={{ marginTop: "0.5rem", fontSize: "0.9rem", color: "var(--ink-soft)" }}>{p.preview}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
