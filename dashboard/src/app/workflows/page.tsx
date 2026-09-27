"use client";

import { useEffect, useState } from "react";
import { Badge, EmptyState, PageHeader } from "@/components/ui";

type Workflow = {
  slug: string;
  title: string;
  trigger: string;
  action: string;
  channel: string;
  supplier?: string;
  contact?: string;
  fm: Record<string, string | number>;
  timeline: string[];
};

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    async function load() {
      const res = await fetch("/api/workflows");
      const data = await res.json();
      setWorkflows(data.workflows || []);
    }
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  return (
    <div>
      <PageHeader
        title="Workflows"
        subtitle="Tony's routines. When he changes one over text or chat, it updates here."
      />
      {workflows.length === 0 ? (
        <EmptyState>No workflows enshrined yet.</EmptyState>
      ) : (
        <div className="grid-cards">
          {workflows.map((w) => (
            <div className="card" key={w.slug}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", marginBottom: "0.65rem" }}>
                <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 650 }}>
                  {w.title.replace(/^Workflow:\s*/i, "")}
                </h3>
                <Badge>{w.channel || w.action}</Badge>
              </div>
              <p style={{ margin: "0.35rem 0", fontSize: "0.9rem" }}>
                <strong>When:</strong> {w.trigger || "—"}
              </p>
              <p style={{ margin: "0.35rem 0", fontSize: "0.9rem" }}>
                <strong>Then:</strong> {w.action}
                {w.supplier ? ` via ${w.supplier}` : ""}
                {w.contact ? ` → ${w.contact}` : ""}
              </p>
              {w.fm.default_qty !== undefined && (
                <p style={{ margin: "0.35rem 0", fontSize: "0.9rem" }}>
                  <strong>Usual order:</strong> {w.fm.default_qty} {w.fm.unit}
                  {w.fm.unit_price ? ` at $${Number(w.fm.unit_price).toFixed(2)}/${w.fm.unit}` : ""}
                </p>
              )}
              {w.timeline.length > 0 && (
                <>
                  <button
                    className="btn btn-ghost"
                    style={{ marginTop: "0.5rem", padding: "0.25rem 0", color: "var(--accent)" }}
                    onClick={() => setOpen((o) => ({ ...o, [w.slug]: !o[w.slug] }))}
                  >
                    {open[w.slug] ? "Hide history" : "Show history"}
                  </button>
                  {open[w.slug] && (
                    <ul className="timeline">
                      {w.timeline.slice(0, 6).map((entry, i) => (
                        <li key={i}>{entry}</li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
