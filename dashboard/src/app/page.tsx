"use client";

import { useEffect, useState } from "react";

type Item = {
  slug: string;
  name: string;
  unit: string;
  par: number;
  supplier: string;
  estimate: number;
  daily_use: number;
  last_count: number;
  last_counted: string;
  days_left: number | null;
  next_checkup: string;
  checkup_reason: "projected_low" | "order_day" | "recheck" | null;
  due: boolean;
  low: boolean;
};

type Appliance = {
  slug: string;
  name: string;
  status: string;
  last_service: string;
  next_service: string;
};

const DAY_MS = 86_400_000;

function dayDiff(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

function relDay(today: string, iso: string) {
  const d = dayDiff(today, iso);
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d === -1) return "yesterday";
  if (d < 0) return `${-d} days ago`;
  const date = new Date(`${iso}T12:00:00Z`);
  const weekday = date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  return d < 7 ? weekday : `${weekday} ${date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
}

function amount(n: number) {
  return n >= 10 ? String(Math.round(n)) : String(Math.round(n * 2) / 2);
}

const REASON: Record<string, string> = {
  projected_low: "projected low",
  order_day: "usual order day",
  recheck: "recheck",
};

export default function InventoryPage() {
  const [inventory, setInventory] = useState<Item[]>([]);
  const [appliances, setAppliances] = useState<Appliance[]>([]);
  const [today, setToday] = useState("");

  useEffect(() => {
    async function load() {
      const res = await fetch("/api/inventory");
      const data = await res.json();
      setInventory(data.inventory || []);
      setAppliances(data.appliances || []);
      setToday(data.clock?.today || "");
    }
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  return (
    <div>
      <h1 className="page-title">Inventory</h1>
      <p className="page-sub">
        Tony doesn&apos;t weigh anything, so these are estimates from his last count and typical usage. Each item
        gets a check-up text when it&apos;s projected to run low or on its usual order day, whichever comes first.
        His corrections tune the usage numbers.
      </p>

      <table className="table">
        <thead>
          <tr>
            <th>Ingredient</th>
            <th>Est. on hand</th>
            <th>Low point</th>
            <th>Usage</th>
            <th>Next check-up</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {inventory.map((item) => {
            const pct = item.last_count > 0 ? Math.min(100, (item.estimate / item.last_count) * 100) : 0;
            return (
              <tr key={item.slug} className={item.low || item.due ? "row-low" : undefined}>
                <td>
                  <strong>{item.name}</strong>
                </td>
                <td>
                  <div>
                    ~{amount(item.estimate)} {item.unit}
                  </div>
                  <div className="gauge" aria-hidden>
                    <span style={{ width: `${pct}%` }} className={item.low ? "gauge-low" : undefined} />
                  </div>
                  {today && (
                    <div className="muted small">
                      counted {amount(item.last_count)} {item.unit} {relDay(today, item.last_counted)}
                    </div>
                  )}
                </td>
                <td>
                  {item.par} {item.unit}
                </td>
                <td>
                  ~{item.daily_use} {item.unit}/day
                  {item.days_left !== null && (
                    <div className="muted small">~{Math.floor(item.days_left)} days left</div>
                  )}
                </td>
                <td>
                  {item.next_checkup && today ? (
                    <>
                      <div>{relDay(today, item.next_checkup)}</div>
                      <div className="muted small">{REASON[item.checkup_reason ?? ""] ?? ""}</div>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  {item.due ? (
                    <span className="tag low">CHECK-UP DUE</span>
                  ) : item.low ? (
                    <span className="tag low">PROBABLY LOW</span>
                  ) : (
                    <span className="tag">OK</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2 className="page-title" style={{ fontSize: "1.5rem", marginTop: "2rem" }}>
        Appliances
      </h2>
      <div className="grid-cards">
        {appliances.map((a) => (
          <div className="panel" key={a.slug}>
            <h3>{a.name}</h3>
            <p className="muted">Status: {a.status}</p>
            <p className="muted">Last service: {a.last_service || "—"}</p>
            <p className="muted">Next service: {a.next_service || "—"}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
