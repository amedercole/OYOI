"use client";

import { useEffect, useState } from "react";

type Action = {
  id: string;
  kind: string;
  status: string;
  summary: string;
  payload: string;
  result: string | null;
  browser_live_url: string | null;
  created_at: string;
  updated_at: string;
};

export default function ActionsPage() {
  const [actions, setActions] = useState<Action[]>([]);

  useEffect(() => {
    async function load() {
      const res = await fetch("/api/actions");
      const data = await res.json();
      setActions(data.actions || []);
    }
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, []);

  return (
    <div>
      <h1 className="page-title">Finished & live actions</h1>
      <p className="page-sub">
        Proposed plans, email previews, browser orders, and confirmation status.
      </p>
      <div style={{ display: "grid", gap: "0.85rem" }}>
        {actions.length === 0 && <p className="muted">No actions yet.</p>}
        {actions.map((a) => {
          let result: { results?: string[]; email?: { preview?: { to: string; subject: string; body: string } }; order?: { confirmationNumber?: string; liveUrl?: string } } | null =
            null;
          try {
            result = a.result ? JSON.parse(a.result) : null;
          } catch {
            result = null;
          }
          return (
            <div className="panel" key={a.id}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}>
                <h3 style={{ margin: 0 }}>{a.summary}</h3>
                <span className={`status ${a.status}`}>{a.status.replaceAll("_", " ")}</span>
              </div>
              <p className="muted" style={{ marginTop: "0.4rem" }}>
                {new Date(a.created_at).toLocaleString()} · {a.kind}
              </p>
              {result?.email?.preview && (
                <div style={{ marginTop: "0.75rem" }}>
                  <strong>Email preview</strong>
                  <pre className="mono">
                    To: {result.email.preview.to}
                    {"\n"}Subject: {result.email.preview.subject}
                    {"\n\n"}
                    {result.email.preview.body}
                  </pre>
                </div>
              )}
              {result?.order?.confirmationNumber && (
                <p style={{ marginTop: "0.5rem" }}>
                  Order confirmation: <strong>{result.order.confirmationNumber}</strong>
                </p>
              )}
              {(a.browser_live_url || result?.order?.liveUrl) && (
                <p>
                  <a
                    href={a.browser_live_url || result?.order?.liveUrl || "#"}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "var(--accent)", fontWeight: 700 }}
                  >
                    Open browser live view →
                  </a>
                </p>
              )}
              {result?.results && (
                <ul>
                  {result.results.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
