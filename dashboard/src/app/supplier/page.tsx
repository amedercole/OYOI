"use client";

import { useMemo, useState } from "react";

type Product = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  price: number;
  description: string;
};

const CATALOG: Product[] = [
  {
    id: "mozzarella",
    sku: "MOZ-20",
    name: "Mozzarella",
    unit: "lbs",
    price: 4.5,
    description: "Fresh whole-milk mozzarella — case of 20 lbs available.",
  },
  {
    id: "flour",
    sku: "FLOUR-50",
    name: "Flour",
    unit: "lbs",
    price: 0.85,
    description: "00 pizza flour, 50 lb bag.",
  },
  {
    id: "sauce",
    sku: "SAUCE-#10",
    name: "Tomato Sauce",
    unit: "cans",
    price: 6.25,
    description: "San Marzano-style #10 cans.",
  },
  {
    id: "oil",
    sku: "OIL-EVOO",
    name: "Olive Oil",
    unit: "liters",
    price: 9.5,
    description: "Extra virgin olive oil.",
  },
];

export default function SupplierPage() {
  const [qty, setQty] = useState<Record<string, number>>(
    Object.fromEntries(CATALOG.map((p) => [p.id, p.id === "mozzarella" ? 20 : 0]))
  );
  const [cart, setCart] = useState<{ id: string; quantity: number }[]>([]);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  const cartLines = useMemo(() => {
    return cart
      .map((c) => {
        const product = CATALOG.find((p) => p.id === c.id)!;
        return { ...product, quantity: c.quantity, lineTotal: product.price * c.quantity };
      })
      .filter(Boolean);
  }, [cart]);

  const total = cartLines.reduce((sum, l) => sum + l.lineTotal, 0);

  function addToCart(id: string) {
    const quantity = Math.max(1, qty[id] || 1);
    setCart((prev) => {
      const existing = prev.find((p) => p.id === id);
      if (existing) {
        return prev.map((p) => (p.id === id ? { ...p, quantity: p.quantity + quantity } : p));
      }
      return [...prev, { id, quantity }];
    });
  }

  function checkout() {
    if (cartLines.length === 0) return;
    const conf = `CB-${Date.now().toString().slice(-8)}`;
    setConfirmation(conf);
    setCart([]);
  }

  if (confirmation) {
    return (
      <div className="store">
        <div className="success-box" id="order-confirmation">
          <p className="muted">Company B — order complete</p>
          <p className="conf" id="confirmation-number">
            {confirmation}
          </p>
          <p>Thanks, Tony&apos;s Pizzeria. Delivery expected next business day.</p>
          <button className="btn btn-accent" style={{ marginTop: "1rem" }} onClick={() => setConfirmation(null)}>
            Back to catalog
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="store">
      <div className="store-hero">
        <div>
          <p className="muted" style={{ margin: 0 }}>
            Mock supplier storefront
          </p>
          <h1 className="page-title" style={{ marginBottom: 0 }}>
            Company B Wholesale
          </h1>
        </div>
        <div className="tag">Card on file ···· 4242</div>
      </div>

      <div className="store-grid">
        <div>
          {CATALOG.map((p) => (
            <div className="product" key={p.id} data-sku={p.sku} data-product={p.name}>
              <div>
                <h3 style={{ margin: "0 0 0.25rem", fontFamily: "var(--font-display)" }}>{p.name}</h3>
                <p className="muted" style={{ margin: 0 }}>
                  SKU {p.sku} · ${p.price.toFixed(2)}/{p.unit}
                </p>
                <p style={{ margin: "0.4rem 0 0" }}>{p.description}</p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", minWidth: 120 }}>
                <label className="muted" htmlFor={`qty-${p.id}`}>
                  Qty
                </label>
                <input
                  id={`qty-${p.id}`}
                  type="number"
                  min={1}
                  value={qty[p.id]}
                  onChange={(e) => setQty({ ...qty, [p.id]: Number(e.target.value) })}
                  style={{ padding: "0.4rem", borderRadius: 8, border: "1px solid var(--line)" }}
                />
                <button className="btn btn-accent" data-action="add-to-cart" onClick={() => addToCart(p.id)}>
                  Add to cart
                </button>
              </div>
            </div>
          ))}
        </div>

        <aside className="cart-box" id="cart">
          <h3 style={{ marginTop: 0, fontFamily: "var(--font-display)" }}>Cart</h3>
          {cartLines.length === 0 && <p className="muted">Cart is empty</p>}
          {cartLines.map((l) => (
            <div key={l.id} style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
              <span>
                {l.name} × {l.quantity}
              </span>
              <span>${l.lineTotal.toFixed(2)}</span>
            </div>
          ))}
          <hr style={{ border: 0, borderTop: "1px solid var(--line)" }} />
          <p style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
            <span>Total</span>
            <span id="cart-total">${total.toFixed(2)}</span>
          </p>
          <button
            id="checkout-button"
            className="btn btn-accent"
            style={{ width: "100%", marginTop: "0.5rem" }}
            onClick={checkout}
            disabled={cartLines.length === 0}
          >
            Checkout
          </button>
        </aside>
      </div>
    </div>
  );
}
