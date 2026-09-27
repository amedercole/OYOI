"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, Card, EmptyState, PageHeader, StatCard } from "@/components/ui";

type Item = {
  slug: string;
  name: string;
  unit: string;
  estimate: number;
  daily_use: number;
  next_checkup: string;
  checkup_reason: string | null;
  due: boolean;
  low: boolean;
};

type Action = {
  id: string;
  kind: string;
  status: string;
  summary: string;
  created_at: string;
};

type Message = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  channel: "sms" | "web";
  created_at: string;
};

function amount(n: number) {
  return n >= 10 ? String(Math.round(n)) : String(Math.round(n * 2) / 2);
}

function dayLabel(today: string, iso: string) {
  const DAY = 86_400_000;
  const d = Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d < 0) return `${-d}d ago`;
  const date = new Date(`${iso}T12:00:00Z`);
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

export default function OverviewPage() {
  const [inventory, setInventory] = useState<Item[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [today, setToday] = useState("");

  useEffect(() => {
    async function load() {
      const [inv, act, chat] = await Promise.all([
        fetch("/api/inventory").then((r) => r.json()),
        fetch("/api/actions").then((r) => r.json()),
        fetch("/api/chat").then((r) => r.json()),
      ]);
      setInventory(inv.inventory || []);
      setToday(inv.clock?.today || "");
      setActions(act.actions || []);
      setMessages(chat.messages || []);
    }
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  const attention = inventory.filter((i) => i.due || i.low);
  const upcoming = [...inventory]
    .filter((i) => i.next_checkup)
    .sort((a, b) => a.next_checkup.localeCompare(b.next_checkup))
    .slice(0, 5);

  const waiting = actions.filter((a) =>
    ["awaiting_confirmation", "awaiting_change_details", "awaiting_product_choice"].includes(a.status)
  );

  const weekOrders = actions.filter((a) => {
    if (a.status !== "done") return false;
    if (!/order/i.test(a.summary) && a.kind !== "bundle" && a.kind !== "checkup") return false;
    return true;
  }).slice(0, 20);

  const next = upcoming[0];
  const lastMsgs = messages.slice(-4);

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle="What's due, what's waiting on Tony, and the latest from the shared SMS / web conversation."
      />

      <div className="stat-grid">
        <StatCard
          label="Needs attention"
          value={attention.length}
          hint={attention.length ? attention.map((i) => i.name).join(", ") : "All clear"}
        />
        <StatCard
          label="Next check-up"
          value={next && today ? dayLabel(today, next.next_checkup) : "—"}
          hint={next ? `${next.name} · ${next.checkup_reason?.replaceAll("_", " ") || ""}` : "Nothing scheduled"}
        />
        <StatCard
          label="Orders this week"
          value={weekOrders.length}
          hint="Completed reorder actions"
        />
        <StatCard
          label="Waiting on Tony"
          value={waiting.length}
          hint={waiting[0]?.summary || "No open questions"}
        />
      </div>

      <div className="grid-2">
        <Card title="Needs attention">
          {attention.length === 0 ? (
            <EmptyState>Nothing low or due right now.</EmptyState>
          ) : (
            attention.map((i) => (
              <div className="list-row" key={i.slug}>
                <div>
                  <strong>{i.name}</strong>
                  <div className="muted small">
                    ~{amount(i.estimate)} {i.unit} · ~{i.daily_use}/{i.unit === "lbs" ? "day" : "day"}
                  </div>
                </div>
                <Badge tone={i.due ? "due" : "low"}>{i.due ? "Check-up due" : "Probably low"}</Badge>
              </div>
            ))
          )}
        </Card>

        <Card title="Upcoming check-ups">
          {upcoming.length === 0 ? (
            <EmptyState>No check-ups scheduled.</EmptyState>
          ) : (
            upcoming.map((i) => (
              <div className="list-row" key={i.slug}>
                <div>
                  <strong>{i.name}</strong>
                  <div className="muted small">{i.checkup_reason?.replaceAll("_", " ")}</div>
                </div>
                <span className="muted small">{today ? dayLabel(today, i.next_checkup) : i.next_checkup}</span>
              </div>
            ))
          )}
        </Card>
      </div>

      <div className="grid-2">
        <Card title="Recent activity">
          {actions.length === 0 ? (
            <EmptyState>No actions yet. Fast-forward a day from Demo to start.</EmptyState>
          ) : (
            actions.slice(0, 6).map((a) => (
              <div className="list-row" key={a.id}>
                <div>
                  <strong>{a.summary}</strong>
                  <div className="muted small">{new Date(a.created_at).toLocaleString()}</div>
                </div>
                <Badge tone={a.status}>{a.status.replaceAll("_", " ")}</Badge>
              </div>
            ))
          )}
          <div style={{ marginTop: "0.75rem" }}>
            <Link href="/activity" className="muted small" style={{ color: "var(--accent)", fontWeight: 600 }}>
              View all activity →
            </Link>
          </div>
        </Card>

        <Card title="Latest conversation">
          {lastMsgs.length === 0 ? (
            <EmptyState>No messages yet.</EmptyState>
          ) : (
            lastMsgs.map((m) => (
              <div className="list-row" key={m.id}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", marginBottom: "0.2rem" }}>
                    <strong style={{ fontSize: "0.82rem" }}>{m.direction === "inbound" ? "Tony" : "OYI"}</strong>
                    <span className={`badge channel channel-${m.channel}`}>
                      {m.channel === "sms" ? "Text" : "Web"}
                    </span>
                  </div>
                  <div className="muted small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {m.body}
                  </div>
                </div>
              </div>
            ))
          )}
          <div style={{ marginTop: "0.75rem" }}>
            <Link href="/chat" className="btn btn-accent" style={{ display: "inline-block" }}>
              Open chat
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
