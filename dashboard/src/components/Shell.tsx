"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/inventory", label: "Inventory" },
  { href: "/chat", label: "Chat" },
  { href: "/workflows", label: "Workflows" },
  { href: "/activity", label: "Activity" },
];

const TITLES: Record<string, string> = {
  "/": "Overview",
  "/inventory": "Inventory",
  "/chat": "Chat",
  "/workflows": "Workflows",
  "/activity": "Activity",
  "/brain": "Brain",
};

function formatDemoDay(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [clock, setClock] = useState<{ today: string; offsetDays: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [chatUnread, setChatUnread] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const lastSeenMsg = useRef<string | null>(null);

  const refreshClock = useCallback(async () => {
    try {
      const res = await fetch("/api/demo/clock");
      setClock(await res.json());
    } catch {
      /* ignore */
    }
  }, []);

  const pollChat = useCallback(async () => {
    try {
      const res = await fetch("/api/chat");
      const data = await res.json();
      const msgs = data.messages || [];
      const last = msgs[msgs.length - 1];
      if (!last) return;
      if (pathname === "/chat") {
        lastSeenMsg.current = last.id;
        setChatUnread(false);
      } else if (lastSeenMsg.current && last.id !== lastSeenMsg.current && last.direction === "outbound") {
        setChatUnread(true);
      } else if (!lastSeenMsg.current) {
        lastSeenMsg.current = last.id;
      }
    } catch {
      /* ignore */
    }
  }, [pathname]);

  useEffect(() => {
    const first = setTimeout(() => {
      void refreshClock();
      void pollChat();
    }, 0);
    const t = setInterval(() => {
      void refreshClock();
      void pollChat();
    }, 3000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [refreshClock, pollChat]);

  useEffect(() => {
    if (pathname === "/chat") {
      const t = setTimeout(() => setChatUnread(false), 0);
      return () => clearTimeout(t);
    }
  }, [pathname]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  async function runDemo(url: string, body?: object) {
    setBusy(true);
    setMenuOpen(false);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = (await res.json()) as { sent?: boolean; text?: string; ok?: boolean };
      if (data.text && !data.sent) setToast(data.text);
      else if (data.ok) setToast("Demo reset.");
      else if (data.sent && data.text) setToast("Check-up sent — open Chat to reply.");
      await refreshClock();
      await pollChat();
    } finally {
      setBusy(false);
    }
  }

  const title = TITLES[pathname] || "OYI";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">OYI</span>
          <span className="brand-sub">Restaurant ops</span>
        </div>
        <nav>
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={pathname === item.href ? "nav-link active" : "nav-link"}
            >
              {item.label}
              {item.href === "/chat" && chatUnread ? <span className="nav-dot" /> : null}
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="muted">Tony&apos;s Pizzeria</div>
        </div>
      </aside>

      <div className="shell-main">
        <header className="topbar">
          <h1 className="topbar-title">{title}</h1>
          <div className="topbar-actions">
            {clock && (
              <span className="demo-chip">
                Demo day <strong>{formatDemoDay(clock.today)}</strong>
                {clock.offsetDays > 0 ? ` · +${clock.offsetDays}` : ""}
              </span>
            )}
            <div className="demo-menu" ref={menuRef}>
              <button className="btn" onClick={() => setMenuOpen((o) => !o)} disabled={busy}>
                Demo
              </button>
              {menuOpen && (
                <div className="demo-menu-panel">
                  <button onClick={() => runDemo("/api/demo/advance", { days: 1 })} disabled={busy}>
                    Fast-forward a day
                  </button>
                  <button onClick={() => runDemo("/api/checkin")} disabled={busy}>
                    Run check-ups now
                  </button>
                  <Link href="/brain" onClick={() => setMenuOpen(false)}>
                    View brain (backend)
                  </Link>
                  <button className="danger" onClick={() => runDemo("/api/demo/reset")} disabled={busy}>
                    Reset demo
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className={pathname === "/chat" ? "page-body chat-body" : "page-body"}>{children}</div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
