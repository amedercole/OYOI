"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

type Message = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  channel: "sms" | "web";
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

function Thread({
  title,
  hint,
  messages,
  empty,
  composer,
}: {
  title: string;
  hint: string;
  messages: Message[];
  empty: string;
  composer?: ReactNode;
}) {
  const threadRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  return (
    <section className="chat-pane">
      <div className="chat-header">
        <h2>{title}</h2>
        <p>{hint}</p>
      </div>
      <div className="chat-thread" ref={threadRef}>
        {messages.length === 0 && <div className="empty-state">{empty}</div>}
        {messages.map((m) => (
          <div key={m.id} className={`bubble-row ${m.direction}`}>
            <div className="bubble">{linkify(m.body)}</div>
            <div className="bubble-meta">
              <span className={`badge channel channel-${m.channel}`}>
                {m.channel === "sms" ? "WhatsApp" : "Web"}
              </span>
            </div>
          </div>
        ))}
      </div>
      {composer}
    </section>
  );
}

export default function ChatPage() {
  const [web, setWeb] = useState<Message[]>([]);
  const [sms, setSms] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/chat");
      const data = await res.json();
      if (data.error) setError(data.error);
      else setError(null);
      setWeb(data.web || []);
      setSms(data.sms || []);
    } catch {
      setError("ufo unavailable");
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const t = setInterval(refresh, 4000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [refresh]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      setDraft("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat-split">
      {error && <div className="toast">{error}</div>}
      <Thread
        title="Web"
        hint="Type here. Inventory and memory are shared with WhatsApp."
        messages={web}
        empty="No web messages yet."
        composer={
          <div className="chat-composer">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send(draft)}
              placeholder="Message OYI…"
              disabled={busy}
            />
            <button
              className="btn btn-accent"
              onClick={() => send(draft)}
              disabled={busy || !draft.trim()}
            >
              Send
            </button>
          </div>
        }
      />
      <Thread
        title="WhatsApp"
        hint="Reply on WhatsApp to continue. Check-ups arrive here."
        messages={sms}
        empty="No WhatsApp thread yet. Connect a phone in the ufo terminal."
      />
      {busy && <div className="typing">OYI is typing…</div>}
    </div>
  );
}
