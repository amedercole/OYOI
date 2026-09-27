"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type Message = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  quick_replies: string[] | null;
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
  const threadRef = useRef<HTMLDivElement>(null);

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
    const first = setTimeout(refresh, 0);
    const t = setInterval(refresh, 2000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [refresh]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await fetch("/api/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      setDraft("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function runCheckin() {
    setBusy(true);
    try {
      await fetch("/api/checkin", { method: "POST" });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function resetDemo() {
    setBusy(true);
    try {
      await fetch("/api/demo/reset", { method: "POST" });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const last = messages[messages.length - 1];
  const buttons = last?.direction === "outbound" ? last.quick_replies ?? [] : [];

  return (
    <div className="app-shell">
      <aside className="side-nav">
        <div className="brand">
          <span className="brand-mark">OYOI</span>
          <span className="brand-sub">Restaurant SMS Ops</span>
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
        <div className="side-note">
          <p>Demo restaurant: Tony&apos;s Pizzeria</p>
          <button className="link-btn" onClick={resetDemo} disabled={busy}>
            Reset demo
          </button>
        </div>
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
        <div className="thread" ref={threadRef}>
          {messages.length === 0 && (
            <p className="muted empty">No messages yet. Run a check-in or text the agent.</p>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={m.direction === "inbound" ? "bubble inbound" : "bubble outbound"}
            >
              <div className="bubble-body">{m.body}</div>
              <time>{new Date(m.created_at).toLocaleTimeString()}</time>
            </div>
          ))}
          {buttons.length > 0 && (
            <div className="quick-replies">
              {buttons.map((label) => (
                <button
                  key={label}
                  className="quick-reply"
                  onClick={() => send(label)}
                  disabled={busy}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {busy && <div className="typing">OYOI is typing…</div>}
        </div>
        <div className="composer">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send(draft)}
            placeholder="Text OYOI…"
          />
          <button className="btn" onClick={() => send(draft)} disabled={busy}>
            Send
          </button>
        </div>
      </aside>
    </div>
  );
}
