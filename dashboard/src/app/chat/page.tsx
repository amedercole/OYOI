"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ChatMessage, ChatSummary } from "@/lib/ufo";

const POLL_MS = 4000;

type Selection = { kind: "chat"; id: string } | { kind: "new"; channel: string };

function newChat(): Selection {
  return { kind: "new", channel: `web-${crypto.randomUUID()}` };
}

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

function ago(now: number, seconds: number): string {
  const minutes = Math.floor((now / 1000 - seconds) / 60);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return new Date(seconds * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function KindBadge({ kind }: { kind: ChatSummary["kind"] }) {
  return <span className={`badge channel channel-${kind}`}>{kind === "text" ? "Text" : "Web"}</span>;
}

function ChatRow({
  title,
  kind,
  meta,
  active,
  onClick,
}: {
  title: string;
  kind: ChatSummary["kind"];
  meta: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className={active ? "chat-row active" : "chat-row"} onClick={onClick}>
      <span className="chat-row-title">{title}</span>
      <span className="chat-row-meta">
        <KindBadge kind={kind} />
        <span>{meta}</span>
      </span>
    </button>
  );
}

export default function ChatPage() {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<{ channel: string; text: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const threadRef = useRef<HTMLDivElement>(null);
  const shownId = useRef<string | null>(null);
  const selectionRef = useRef<Selection | null>(null);

  const loadChats = useCallback(async (): Promise<ChatSummary[]> => {
    const data = (await (await fetch("/api/chat")).json()) as { chats?: ChatSummary[]; error?: string };
    setError(data.error ?? null);
    setNow(Date.now());
    const list = data.chats ?? [];
    setChats(list);
    return list;
  }, []);

  const loadMessages = useCallback(async (id: string) => {
    const res = await fetch(`/api/chat?id=${encodeURIComponent(id)}`);
    const data = (await res.json()) as { messages?: ChatMessage[]; error?: string };
    if (data.error) return setError(data.error);
    if (shownId.current === id) setMessages(data.messages ?? []);
  }, []);

  useEffect(() => {
    async function tick() {
      try {
        const list = await loadChats();
        const latest = [...list].sort((a, b) => b.lastAt - a.lastAt)[0];
        setSelection((s) => s ?? (latest ? { kind: "chat", id: latest.id } : newChat()));
      } catch {
        setError("ufo unavailable");
      }
    }
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [loadChats]);

  const selected = selection?.kind === "chat" ? chats.find((c) => c.id === selection.id) : undefined;
  const selectedId = selection?.kind === "chat" ? selection.id : null;
  const selectedBusy = selected?.busy ?? false;
  const selectedLastAt = selected?.lastAt ?? 0;
  const channel = selection?.kind === "new" ? selection.channel : (selected?.channel ?? null);
  const kind = selected?.kind ?? "web";
  const shownPending = pending && pending.channel === channel ? pending : null;

  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  useEffect(() => {
    shownId.current = selectedId;
    if (!selectedId || selectedBusy) return;
    const t = setTimeout(() => {
      loadMessages(selectedId).catch(() => setError("ufo unavailable"));
    }, 0);
    return () => clearTimeout(t);
  }, [selectedId, selectedBusy, selectedLastAt, loadMessages]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, shownPending, selectedId]);

  function select(next: Selection) {
    shownId.current = next.kind === "chat" ? next.id : null;
    setMessages([]);
    setSelection(next);
  }

  async function send() {
    const text = draft.trim();
    if (!text || !channel || pending) return;
    setPending({ channel, text });
    setDraft("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, body: text }),
      });
      const data = (await res.json()) as { error?: string };
      if (data.error) setError(data.error);
      const chat = (await loadChats()).find((c) => c.channel === channel);
      if (chat) {
        const current = selectionRef.current;
        if (current?.kind === "new" && current.channel === channel) {
          shownId.current = chat.id;
          setSelection({ kind: "chat", id: chat.id });
        }
        if (shownId.current === chat.id) await loadMessages(chat.id);
      }
    } finally {
      setPending(null);
    }
  }

  const textChats = chats.filter((c) => c.kind === "text");
  const webChats = chats.filter((c) => c.kind === "web").sort((a, b) => b.lastAt - a.lastAt);
  const title =
    selection?.kind === "new" ? "New chat" : kind === "text" ? "WhatsApp" : (selected?.title ?? "");

  return (
    <div className="chat-layout">
      {error && <div className="toast">{error}</div>}
      <section className="chat-pane">
        <div className="chat-header">
          <div className="chat-header-title">
            <h2>{title}</h2>
            <KindBadge kind={kind} />
          </div>
          <p>
            {kind === "text"
              ? "Your phone's thread. Check-ups arrive here."
              : "Shares inventory and memory with every chat."}
          </p>
        </div>
        <div className="chat-thread" ref={threadRef}>
          {messages.length === 0 && !shownPending && (
            <div className="empty-state">
              {selection?.kind === "new" ? "Ask about stock, orders, or suppliers." : "No messages yet."}
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`bubble-row ${m.direction}`}>
              <div className="bubble">{linkify(m.body)}</div>
            </div>
          ))}
          {shownPending && (
            <div className="bubble-row inbound">
              <div className="bubble">{shownPending.text}</div>
            </div>
          )}
          {(shownPending || selectedBusy) && <div className="typing">OYI is replying…</div>}
        </div>
        {kind === "text" ? (
          <div className="chat-composer chat-composer-readonly">Reply on WhatsApp to continue this thread.</div>
        ) : (
          <div className="chat-composer">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void send()}
              placeholder="Message OYI…"
              disabled={pending !== null}
            />
            <button className="btn btn-accent" onClick={() => void send()} disabled={pending !== null || !draft.trim()}>
              Send
            </button>
          </div>
        )}
      </section>

      <aside className="chat-list">
        <button className="btn btn-accent chat-new" onClick={() => select(newChat())}>
          New chat
        </button>
        <div className="chat-list-section">Text</div>
        {textChats.length === 0 && <div className="chat-list-empty">No phone linked. Ask in a web chat to link one.</div>}
        {textChats.map((c) => (
          <ChatRow
            key={c.id}
            title="WhatsApp"
            kind="text"
            meta={ago(now, c.lastAt)}
            active={selectedId === c.id}
            onClick={() => select({ kind: "chat", id: c.id })}
          />
        ))}
        <div className="chat-list-section">Web</div>
        {selection?.kind === "new" && (
          <ChatRow title="New chat" kind="web" meta="now" active onClick={() => undefined} />
        )}
        {webChats.map((c) => (
          <ChatRow
            key={c.id}
            title={c.title}
            kind="web"
            meta={ago(now, c.lastAt)}
            active={selectedId === c.id}
            onClick={() => select({ kind: "chat", id: c.id })}
          />
        ))}
      </aside>
    </div>
  );
}
