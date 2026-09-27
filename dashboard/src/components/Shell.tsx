"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ChatSummary } from "@/lib/ufo";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/inventory", label: "Inventory" },
  { href: "/chat", label: "Chat" },
];

const TITLES: Record<string, string> = {
  "/": "Overview",
  "/inventory": "Inventory",
  "/chat": "Chat",
};

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [chatUnread, setChatUnread] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const lastSeen = useRef<number | null>(null);
  const debugBase = (process.env.NEXT_PUBLIC_UFO_BASE_URL || "http://127.0.0.1:8710").replace(
    /\/$/,
    ""
  );
  const debugUrl = `${debugBase}/surface/debug`;

  const pollChat = useCallback(async () => {
    try {
      const res = await fetch("/api/chat");
      const data = (await res.json()) as { chats?: ChatSummary[] };
      const latest = Math.max(0, ...(data.chats ?? []).map((c) => c.lastAt));
      if (pathname === "/chat" || lastSeen.current === null) {
        lastSeen.current = latest;
        setChatUnread(false);
      } else if (latest > lastSeen.current) {
        setChatUnread(true);
      }
    } catch {
      /* ignore */
    }
  }, [pathname]);

  useEffect(() => {
    const first = setTimeout(() => {
      void pollChat();
    }, 0);
    const t = setInterval(() => {
      void pollChat();
    }, 4000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [pollChat]);

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

  async function runCheckups() {
    setBusy(true);
    setMenuOpen(false);
    try {
      const res = await fetch("/api/checkup", { method: "POST" });
      const data = (await res.json()) as { text?: string; error?: string };
      setToast(data.error || data.text || "Check-up requested.");
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
          <span className="brand-sub">Own your inventory</span>
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
            <div className="demo-menu" ref={menuRef}>
              <button className="btn" onClick={() => setMenuOpen((o) => !o)} disabled={busy}>
                Demo
              </button>
              {menuOpen && (
                <div className="demo-menu-panel">
                  <button onClick={() => void runCheckups()} disabled={busy}>
                    Run check-ups now
                  </button>
                  <a href={debugUrl} target="_blank" rel="noreferrer" onClick={() => setMenuOpen(false)}>
                    Open ufo debugger
                  </a>
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
