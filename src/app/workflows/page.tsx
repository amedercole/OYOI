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
  content: string;
};

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);

  useEffect(() => {
    fetch("/api/workflows")
      .then((r) => r.json())
      .then((d) => setWorkflows(d.workflows || []));
  }, []);

  return (
    <div>
      <h1 className="page-title">Enshrined workflows</h1>
      <p className="page-sub">
        Company-specific playbooks the agent recalls before acting — reorder cheese online, email
        Bob for Pepsi changes.
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
          </div>
        ))}
      </div>
    </div>
  );
}
