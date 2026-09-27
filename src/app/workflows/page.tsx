"use client";

import { useEffect, useState } from "react";

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
      <h1 className="page-title">Enshrined workflows</h1>
      <p className="page-sub">
        Tony&apos;s routines, stored in GBrain. When he changes one over text, it updates here.
      </p>
      <div className="grid-cards">
        {workflows.map((w) => (
          <div className="panel" key={w.slug}>
            <h3>{w.title.replace(/^Workflow:\s*/i, "")}</h3>
            <p>
              <span className="tag">{w.channel || w.action}</span>
            </p>
            <p style={{ marginTop: "0.75rem" }}>
              <strong>When:</strong> {w.trigger || "—"}
            </p>
            <p>
              <strong>Then:</strong> {w.action}
              {w.supplier ? ` via ${w.supplier}` : ""}
              {w.contact ? ` → ${w.contact}` : ""}
            </p>
            {w.fm.default_qty !== undefined && (
              <p>
                <strong>Usual order:</strong> {w.fm.default_qty} {w.fm.unit}
                {w.fm.unit_price ? ` at $${Number(w.fm.unit_price).toFixed(2)}/${w.fm.unit}` : ""}
              </p>
            )}
            {w.timeline.length > 0 && (
              <>
                <strong style={{ fontSize: "0.85rem" }}>History</strong>
                <ul className="timeline">
                  {w.timeline.slice(0, 4).map((entry, i) => (
                    <li key={i}>{entry}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
