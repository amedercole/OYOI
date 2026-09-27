"use client";

import { useEffect, useState } from "react";
import { Badge, EmptyState, PageHeader } from "@/components/ui";

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

type Filter = "all" | "waiting" | "done";

const WAITING = new Set([
  "awaiting_confirmation",
  "awaiting_change_details",
  "awaiting_product_choice",
]);

export default function ActivityPage() {
  const [actions, setActions] = useState<Action[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

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

  const filtered = actions.filter((a) => {
    if (filter === "waiting") return WAITING.has(a.status);
    if (filter === "done") return a.status === "done";
    return true;
  });

  return (
    <div>
      <PageHeader
        title="Activity"
        subtitle="Proposed plans, product picks, email previews, and live browser sessions while shopping."
      />

      <div className="filter-tabs">
        {(
          [
            ["all", "All"],
            ["waiting", "Waiting on Tony"],
            ["done", "Done"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            className={filter === id ? "filter-tab active" : "filter-tab"}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState>No actions in this view yet.</EmptyState>
      ) : (
        filtered.map((a) => {
          let result: ParsedResult | null = null;
          try {
            result = a.result ? JSON.parse(a.result) : null;
          } catch {
            result = null;
          }
          let payload: { chosen?: { title?: string; price?: string; source?: string }; query?: string } = {};
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
          const isOpen = expanded[a.id] !== undefined ? expanded[a.id] : WAITING.has(a.status) || a.status === "running";

          return (
            <div className="action-card" key={a.id}>
              <div className="action-head">
                <div>
                  <h3>{a.summary}</h3>
                  <p className="muted small" style={{ margin: "0.35rem 0 0" }}>
                    {new Date(a.created_at).toLocaleString()} · {a.kind}
                  </p>
                </div>
                <Badge tone={a.status}>{a.status.replaceAll("_", " ")}</Badge>
              </div>

              <button
                className="btn btn-ghost"
                style={{ marginTop: "0.5rem", padding: "0.25rem 0", color: "var(--accent)" }}
                onClick={() => setExpanded((e) => ({ ...e, [a.id]: !isOpen }))}
              >
                {isOpen ? "Hide details" : "Show details"}
              </button>

              {isOpen && (
                <div style={{ marginTop: "0.65rem" }}>
                  {isShop && product?.title && (
                    <div style={{ marginBottom: "0.75rem" }}>
                      <strong style={{ fontSize: "0.85rem" }}>Chosen product</strong>
                      <p style={{ margin: "0.25rem 0 0" }}>
                        {product.title}
                        {product.price ? ` — ${product.price}` : ""}
                        {product.source ? ` @ ${product.source}` : ""}
                      </p>
                      {cartUrl && (
                        <p style={{ margin: "0.35rem 0 0" }}>
                          <a
                            href={cartUrl}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: "var(--accent)", fontWeight: 650 }}
                          >
                            Open cart / product →
                          </a>
                        </p>
                      )}
                    </div>
                  )}

                  {result?.email?.preview && (
                    <div style={{ marginBottom: "0.75rem" }}>
                      <strong style={{ fontSize: "0.85rem" }}>Email preview</strong>
                      <pre className="mono">
                        To: {result.email.preview.to}
                        {"\n"}Subject: {result.email.preview.subject}
                        {"\n\n"}
                        {result.email.preview.body}
                      </pre>
                    </div>
                  )}

                  {result?.order?.confirmationNumber && (
                    <p style={{ margin: "0.5rem 0" }}>
                      Order confirmation: <strong>{result.order.confirmationNumber}</strong>
                    </p>
                  )}

                  {liveUrl && (
                    <div className="live-browser" style={{ marginTop: "0.65rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.4rem" }}>
                        <strong>Virtual browser</strong>
                        <a
                          href={liveUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: "#9fd4bb", fontWeight: 650 }}
                        >
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
                        <p className="muted" style={{ margin: 0, color: "#9bb0a5" }}>
                          Session finished. Use the link above if a recording is still available.
                        </p>
                      )}
                    </div>
                  )}

                  {result?.results && (
                    <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.1rem" }}>
                      {result.results.map((r, i) => (
                        <li key={i} style={{ marginBottom: "0.25rem" }}>
                          {r}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
