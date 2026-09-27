"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

type ProductCard = {
  title: string;
  price: string;
  source: string;
  link: string;
  imageUrl?: string;
  label?: string;
};

type Message = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  quick_replies: string[] | null;
  cards: ProductCard[] | null;
  created_at: string;
};

const NAV = [
  { href: "/", label: "Inventory" },
  { href: "/workflows", label: "Workflows" },
  { href: "/actions", label: "Actions" },
  { href: "/brain", label: "Brain" },
  { href: "/supplier", label: "Supplier" },
];

function linkify(text: string): ReactNode[] {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((part, i) =>
    part.startsWith("http") ? (
      <a key={i} href={part} target="_blank" rel="noreferrer" className="bubble-link">
        {part.replace(/^https?:\/\//, "").slice(0, 42)}
        {part.length > 50 ? "…" : ""}
      </a>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState<{ today: string; offsetDays: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [msgRes, clockRes] = await Promise.all([fetch("/api/messages"), fetch("/api/demo/clock")]);
      const data = await msgRes.json();
      setMessages(data.messages || []);
      setClock(await clockRes.json());
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

  const lastCardCount = messages[messages.length - 1]?.cards?.length ?? 0;
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, lastCardCount]);

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

  async function runCheckups(url: string) {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(url, { method: "POST" });
      const data = (await res.json()) as { sent?: boolean; text?: string };
      if (!data.sent && data.text) setNotice(data.text);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function resetDemo() {
    setBusy(true);
    setNotice(null);
    try {
      await fetch("/api/demo/reset", { method: "POST" });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const demoDate = clock
    ? new Date(`${clock.today}T12:00:00Z`).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : "";

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
          <button className="btn btn-accent" onClick={() => runCheckups("/api/checkin")} disabled={busy}>
            Run check-in
          </button>
        </div>
        <div className="demo-clock">
          <span>
            Demo day: <strong>{demoDate || "…"}</strong>
            {clock && clock.offsetDays > 0 ? ` (+${clock.offsetDays})` : ""}
          </span>
          <button className="btn" onClick={() => runCheckups("/api/demo/advance")} disabled={busy}>
            Fast-forward a day
          </button>
        </div>
        {notice && <div className="demo-notice">{notice}</div>}
        <div className="thread" ref={threadRef}>
          {messages.length === 0 && (
            <p className="muted empty">No messages yet. Run a check-in or text the agent.</p>
          )}
          {messages.map((m) => (
            <div key={m.id}>
              <div
                className={m.direction === "inbound" ? "bubble inbound" : "bubble outbound"}
              >
                <div className="bubble-body">{linkify(m.body)}</div>
                <time>{new Date(m.created_at).toLocaleTimeString()}</time>
              </div>
              {m.direction === "outbound" && m.cards && m.cards.length > 0 && (
                <div className="product-cards">
                  {m.cards.map((c, i) => (
                    <a
                      key={`${m.id}-${i}`}
                      className="product-card"
                      href={c.link}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => {
                        // Tapping the card in the mirror also selects that product
                        if (m.id === last?.id) {
                          e.preventDefault();
                          void send(c.label || String(i + 1));
                        }
                      }}
                    >
                      {c.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.imageUrl} alt="" className="product-card-img" />
                      ) : (
                        <div className="product-card-img placeholder">{i + 1}</div>
                      )}
                      <div className="product-card-body">
                        <div className="product-card-title">{c.title}</div>
                        <div className="product-card-meta">
                          <strong>{c.price}</strong>
                          <span>{c.source}</span>
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              )}
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
