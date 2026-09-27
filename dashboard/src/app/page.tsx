"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, Card, EmptyState, PageHeader, StatCard } from "@/components/ui";
import type { ChatSummary } from "@/lib/ufo";

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
  const [chats, setChats] = useState<ChatSummary[]>([]);
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
      setChats(
        [...((chat.chats as ChatSummary[] | undefined) ?? [])].sort((a, b) => b.lastAt - a.lastAt).slice(0, 5)
      );
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
          hint="Web chats and your WhatsApp thread"
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

      <Card title="Recent chats">
        {chats.length === 0 ? (
          <EmptyState>No chats yet.</EmptyState>
        ) : (
          chats.map((c) => (
            <div className="list-row" key={c.id}>
              <div
                className="muted small"
                style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {c.kind === "text" ? "WhatsApp" : c.title}
              </div>
              <span className={`badge channel channel-${c.kind}`}>{c.kind === "text" ? "Text" : "Web"}</span>
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
