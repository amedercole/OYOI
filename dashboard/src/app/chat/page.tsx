"use client";

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
  channel: "sms" | "web";
  quick_replies: string[] | null;
  cards: ProductCard[] | null;
  created_at: string;
};

function linkify(text: string): ReactNode[] {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((part, i) =>
    part.startsWith("http") ? (
      <a key={i} href={part} target="_blank" rel="noreferrer" className="bubble-link">
        {part.replace(/^https?:\/\//, "").slice(0, 48)}
        {part.length > 56 ? "…" : ""}
      </a>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

function dayKey(iso: string) {
  return iso.slice(0, 10);
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [twilioPhone, setTwilioPhone] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/chat");
      const data = await res.json();
      setMessages(data.messages || []);
      setTwilioPhone(data.twilioPhone || null);
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
      await fetch("/api/chat", {
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

  const last = messages[messages.length - 1];
  const buttons = last?.direction === "outbound" ? last.quick_replies ?? [] : [];

  const dayGroups = messages.map((m, i) => {
    const day = dayKey(m.created_at);
    const prev = i > 0 ? dayKey(messages[i - 1].created_at) : null;
    return { m, showDay: day !== prev };
  });

  return (
    <>
      <div className="chat-header">
        <h2>Chat with OYI</h2>
        <p>
          Same conversation as texting{" "}
          {twilioPhone ? <strong>{twilioPhone}</strong> : "your OYI number"}. Replies go wherever you last wrote
          from.
        </p>
      </div>

      <div className="chat-thread" ref={threadRef}>
        {messages.length === 0 && (
          <div className="empty-state">No messages yet. Fast-forward a day from Demo, or say hello.</div>
        )}
        {dayGroups.map(({ m, showDay }) => (
            <div key={m.id}>
              {showDay && <div className="chat-day">{dayLabel(m.created_at)}</div>}
              <div className={`bubble-row ${m.direction}`}>
                <div className="bubble">{linkify(m.body)}</div>
                <div className="bubble-meta">
                  <span className={`badge channel channel-${m.channel}`}>
                    {m.channel === "sms" ? "Text" : "Web"}
                  </span>
                  <time>{new Date(m.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
                </div>
                {m.direction === "outbound" && m.cards && m.cards.length > 0 && (
                  <div className="product-cards">
                    {m.cards.map((c, i) => (
                      <button
                        key={`${m.id}-${i}`}
                        type="button"
                        className="product-card"
                        onClick={() => {
                          if (m.id === last?.id) void send(c.label || String(i + 1));
                        }}
                        style={{ textAlign: "left", width: "100%" }}
                      >
                        {c.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.imageUrl} alt="" className="product-card-img" />
                        ) : (
                          <div className="product-card-img placeholder">{i + 1}</div>
                        )}
                        <div>
                          <div className="product-card-title">{c.title}</div>
                          <div className="product-card-meta">
                            <strong>{c.price}</strong>
                            <span>{c.source}</span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
        ))}

        {buttons.length > 0 && (
          <div className="quick-replies" style={{ alignSelf: "flex-start" }}>
            {buttons.map((label) => (
              <button key={label} className="quick-reply" onClick={() => send(label)} disabled={busy}>
                {label}
              </button>
            ))}
          </div>
        )}
        {busy && <div className="typing">OYI is typing…</div>}
      </div>

      <div className="chat-composer">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send(draft)}
          placeholder="Message OYI…"
          disabled={busy}
        />
        <button className="btn btn-accent" onClick={() => send(draft)} disabled={busy || !draft.trim()}>
          Send
        </button>
      </div>
    </>
  );
}
