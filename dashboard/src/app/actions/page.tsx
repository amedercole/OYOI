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

type ParsedResult = {
  results?: string[];
  email?: { preview?: { to: string; subject: string; body: string } };
  order?: { confirmationNumber?: string; liveUrl?: string };
  cart?: { cartUrl?: string | null; mocked?: boolean; liveUrl?: string | null };
  product?: { title?: string; price?: string; source?: string; link?: string };
  cartUrl?: string;
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
        Proposed plans, product picks, email previews, and the virtual browser live view.
      </p>
      <div style={{ display: "grid", gap: "0.85rem" }}>
        {actions.length === 0 && <p className="muted">No actions yet.</p>}
        {actions.map((a) => {
          let result: ParsedResult | null = null;
          try {
            result = a.result ? JSON.parse(a.result) : null;
          } catch {
            result = null;
          }
          let payload: { chosen?: { title?: string; price?: string; source?: string }; query?: string } =
            {};
          try {
            payload = JSON.parse(a.payload || "{}");
          } catch {
            payload = {};
          }

          const product = result?.product || payload.chosen;
          const liveUrl = a.browser_live_url || result?.order?.liveUrl || result?.cart?.liveUrl || null;
          const cartUrl = result?.cartUrl || result?.cart?.cartUrl || null;
          const isShop =
            a.kind === "product_choice" || a.kind === "same_purchase" || Boolean(product?.title);

          return (
            <div className="panel" key={a.id}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}>
                <h3 style={{ margin: 0 }}>{a.summary}</h3>
                <span className={`status ${a.status}`}>{a.status.replaceAll("_", " ")}</span>
              </div>
              <p className="muted" style={{ marginTop: "0.4rem" }}>
                {new Date(a.created_at).toLocaleString()} · {a.kind}
              </p>

              {isShop && product?.title && (
                <div style={{ marginTop: "0.75rem" }}>
                  <strong>Chosen product</strong>
                  <p style={{ margin: "0.25rem 0 0" }}>
                    {product.title}
                    {product.price ? ` — ${product.price}` : ""}
                    {product.source ? ` @ ${product.source}` : ""}
                  </p>
                  {cartUrl && (
                    <p style={{ margin: "0.35rem 0 0" }}>
                      <a href={cartUrl} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", fontWeight: 700 }}>
                        Open cart / product →
                      </a>
                    </p>
                  )}
                </div>
              )}

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

              {liveUrl && (
                <div className="live-browser" style={{ marginTop: "0.85rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.4rem" }}>
                    <strong>Virtual browser</strong>
                    <a href={liveUrl} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", fontWeight: 700 }}>
                      Open live view →
                    </a>
                  </div>
                  {a.status === "running" ? (
                    <iframe
                      src={liveUrl}
                      title="Browser Use live view"
                      className="live-frame"
                      sandbox="allow-scripts allow-same-origin allow-forms"
                    />
                  ) : (
                    <p className="muted" style={{ margin: 0 }}>
                      Session finished. Use the link above if a recording is still available.
                    </p>
                  )}
                </div>
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
