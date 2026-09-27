"use client";

import { useEffect, useState } from "react";

type Item = {
  slug: string;
  name: string;
  qty: number;
  unit: string;
  par: number;
  supplier: string;
  low: boolean;
};

type Appliance = {
  slug: string;
  name: string;
  status: string;
  last_service: string;
  next_service: string;
};

export default function InventoryPage() {
  const [inventory, setInventory] = useState<Item[]>([]);
  const [appliances, setAppliances] = useState<Appliance[]>([]);

  useEffect(() => {
    async function load() {
      const res = await fetch("/api/inventory");
      const data = await res.json();
      setInventory(data.inventory || []);
      setAppliances(data.appliances || []);
    }
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  return (
    <div>
      <h1 className="page-title">Inventory</h1>
      <p className="page-sub">
        Live ingredient levels vs par. Low stock is highlighted for the morning check-in.
      </p>

      <table className="table">
        <thead>
          <tr>
            <th>Ingredient</th>
            <th>On hand</th>
            <th>Par</th>
            <th>Supplier</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {inventory.map((item) => (
            <tr key={item.slug} className={item.low ? "row-low" : undefined}>
              <td>
                <strong>{item.name}</strong>
              </td>
              <td>
                {item.qty} {item.unit}
              </td>
              <td>
                {item.par} {item.unit}
              </td>
              <td>{item.supplier}</td>
              <td>
                {item.low ? <span className="tag low">LOW</span> : <span className="tag">OK</span>}
              </td>
            </tr>
          ))}
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
