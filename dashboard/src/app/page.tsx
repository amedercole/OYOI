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
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default function OverviewPage() {
  const [inventory, setInventory] = useState<Item[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [today, setToday] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const [inv, chat] = await Promise.all([
        fetch("/api/inventory").then((r) => r.json()),
        fetch("/api/chat").then((r) => r.json()),
      ]);
      if (inv.error || chat.error) setError(inv.error || chat.error);
      else setError(null);
      setInventory(inv.inventory || []);
      setToday(inv.clock?.today || new Date().toISOString().slice(0, 10));
      setMessages([...(chat.sms || []), ...(chat.web || [])].slice(-6));
    }
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  const attention = inventory.filter((i) => i.due || i.low);
  const upcoming = [...inventory]
    .filter((i) => i.next_checkup)
    .sort((a, b) => a.next_checkup.localeCompare(b.next_checkup))
    .slice(0, 5);
  const next = upcoming[0];

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle="Projected stock and check-ups from ufo. Chat on the web or WhatsApp."
      />
      {error && <div className="toast">{error}</div>}

      <div className="stat-grid">
        <StatCard
          label="Needs attention"
          value={attention.length}
          hint={attention.length ? attention.map((i) => i.name).join(", ") : "All clear"}
        />
        <StatCard
          label="Next check-up"
          value={next && today ? dayLabel(today, next.next_checkup) : "—"}
          hint={
            next
              ? `${next.name} · ${next.checkup_reason?.replaceAll("_", " ") || ""}`
              : "Nothing scheduled"
          }
        />
        <StatCard label="Tracked items" value={inventory.length} hint="From restaurant_inventory" />
        <StatCard
          label="Open chat"
          value="→"
          hint="Web and WhatsApp threads"
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
                    ~{amount(i.estimate)} {i.unit} · ~{i.daily_use}/day
                  </div>
                </div>
                <Badge tone={i.due ? "due" : "low"}>
                  {i.due ? "Check-up due" : "Probably low"}
                </Badge>
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
                  <div className="muted small">
                    {i.checkup_reason?.replaceAll("_", " ")}
                  </div>
                </div>
                <span className="muted small">
                  {today ? dayLabel(today, i.next_checkup) : i.next_checkup}
                </span>
              </div>
            ))
          )}
        </Card>
      </div>

      <Card title="Latest conversation">
        {messages.length === 0 ? (
          <EmptyState>No messages yet.</EmptyState>
        ) : (
          messages.map((m) => (
            <div className="list-row" key={m.id}>
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    gap: "0.4rem",
                    alignItems: "center",
                    marginBottom: "0.2rem",
                  }}
                >
                  <strong style={{ fontSize: "0.82rem" }}>
                    {m.direction === "inbound" ? "Tony" : "OYI"}
                  </strong>
                  <span className={`badge channel channel-${m.channel}`}>
                    {m.channel === "sms" ? "WhatsApp" : "Web"}
                  </span>
                </div>
                <div
                  className="muted small"
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
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
  );
}
