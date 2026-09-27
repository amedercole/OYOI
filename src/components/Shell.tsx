"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type Message = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  created_at: string;
};

const NAV = [
  { href: "/", label: "Inventory" },
  { href: "/workflows", label: "Workflows" },
  { href: "/actions", label: "Actions" },
  { href: "/brain", label: "Brain" },
  { href: "/supplier", label: "Supplier" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkinMsg, setCheckinMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/messages");
      const data = await res.json();
      setMessages(data.messages || []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [refresh]);

  async function sendSimulated() {
    if (!draft.trim() || busy) return;
    setBusy(true);
    try {
      await fetch("/api/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft }),
      });
      setDraft("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function runCheckin() {
    setBusy(true);
    setCheckinMsg(null);
    try {
      const res = await fetch("/api/checkin", { method: "POST" });
      const data = await res.json();
      setCheckinMsg(data.text);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="side-nav">
        <div className="brand">
          <span className="brand-mark">OYOI</span>
          <span className="brand-sub">Ops You Only Inbox</span>
        </div>
        <nav>
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={pathname === item.href ? "nav-link active" : "nav-link"}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <p className="side-note">Demo restaurant: Tony&apos;s Pizzeria</p>
      </aside>

      <main className="main-pane">{children}</main>

      <aside className="phone-pane">
        <div className="phone-header">
          <div>
            <strong>Owner phone</strong>
            <div className="muted">SMS mirror</div>
          </div>
          <button className="btn btn-accent" onClick={runCheckin} disabled={busy}>
            Run check-in
          </button>
        </div>
        {checkinMsg && <div className="banner">{checkinMsg}</div>}
        <div className="thread">
          {messages.length === 0 && (
            <p className="muted empty">No messages yet. Run a check-in or text the agent.</p>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={m.direction === "inbound" ? "bubble inbound" : "bubble outbound"}
            >
              <div>{m.body}</div>
              <time>{new Date(m.created_at).toLocaleTimeString()}</time>
            </div>
          ))}
        </div>
        <div className="composer">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendSimulated()}
            placeholder="Simulate owner SMS…"
          />
          <button className="btn" onClick={sendSimulated} disabled={busy}>
            Send
          </button>
        </div>
      </aside>
    </div>
  );
}
