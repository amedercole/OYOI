export type ProductOption = {
  id: string;
  title: string;
  price: string;
  priceValue: number;
  source: string;
  link: string;
  imageUrl: string;
  rating?: number;
  label: string;
};

const FALLBACK_CATALOG: Array<Omit<ProductOption, "id" | "label"> & { tags: string[] }> = [
  {
    title: "OXO Good Grips Silicone Flexible Turner Spatula",
    price: "$11.99",
    priceValue: 11.99,
    source: "Target",
    link: "https://www.target.com/p/oxo-good-grips-silicone-flexible-turner/-/A-14704551",
    imageUrl: "https://target.scene7.com/is/image/Target/GUEST_0c8b0e0e-6f5e-4c8d-9c0a-6e6f0c8b0e0e",
    rating: 4.7,
    tags: ["spatula", "turner", "silicone", "oxo"],
  },
  {
    title: "Winco Stainless Steel Solid Turner Spatula 6x3",
    price: "$6.49",
    priceValue: 6.49,
    source: "WebstaurantStore",
    link: "https://www.webstaurantstore.com/winco-tn123-stainless-steel-solid-turner/777TN123.html",
    imageUrl: "https://www.webstaurantstore.com/images/products/medium/777TN123.jpg",
    rating: 4.5,
    tags: ["spatula", "turner", "metal", "stainless", "winco"],
  },
  {
    title: "Rubbermaid Commercial High Heat Spatula 13.5\"",
    price: "$14.49",
    priceValue: 14.49,
    source: "Amazon",
    link: "https://www.amazon.com/Rubbermaid-Commercial-Products-High-Heat/dp/B00004SZ6G",
    imageUrl: "https://m.media-amazon.com/images/I/71QVQZQZQZL._AC_SL1500_.jpg",
    rating: 4.6,
    tags: ["spatula", "rubbermaid", "heat"],
  },
  {
    title: "Di Oro Seamless Silicone Spatula Set 3-Piece",
    price: "$16.97",
    priceValue: 16.97,
    source: "Amazon",
    link: "https://www.amazon.com/Di-Oro-Seamless-Silicone-Spatula/dp/B01N5OKCVI",
    imageUrl: "https://m.media-amazon.com/images/I/71dioro.jpg",
    rating: 4.7,
    tags: ["spatula", "silicone", "set", "di oro"],
  },
  {
    title: "Mercer Culinary Hell's Handle High Heat Turner",
    price: "$19.80",
    priceValue: 19.8,
    source: "WebstaurantStore",
    link: "https://www.webstaurantstore.com/mercer-culinary-m18300hell-hell-s-handle-high-heat-turner/550M18300HELL.html",
    imageUrl: "https://www.webstaurantstore.com/images/products/medium/550M18300HELL.jpg",
    rating: 4.8,
    tags: ["spatula", "turner", "metal", "mercer", "heat"],
  },
  {
    title: "New Star Foodservice 33319 Cast Aluminum Pancake Turner",
    price: "$8.85",
    priceValue: 8.85,
    source: "Amazon",
    link: "https://www.amazon.com/New-Star-Foodservice-33319-Aluminum/dp/B007YNY0AC",
    imageUrl: "https://m.media-amazon.com/images/I/71newstar.jpg",
    rating: 4.4,
    tags: ["spatula", "turner", "metal", "aluminum", "pancake"],
  },
  {
    title: "GIR Ultimate Silicone Spatula Soft Mint",
    price: "$12.95",
    priceValue: 12.95,
    source: "Target",
    link: "https://www.target.com/p/gir-ultimate-spatula/-/A-79278864",
    imageUrl: "https://target.scene7.com/is/image/Target/GUEST_gir_spatula",
    rating: 4.9,
    tags: ["spatula", "silicone", "gir"],
  },
  {
    title: "OXO SoftWorks 12-Inch Tongs with Silicone Heads",
    price: "$12.99",
    priceValue: 12.99,
    source: "Target",
    link: "https://www.target.com/p/oxo-softworks-12-tongs-with-silicone-heads/-/A-11130708",
    imageUrl: "https://target.scene7.com/is/image/Target/GUEST_tongs",
    rating: 4.8,
    tags: ["tongs", "oxo", "silicone"],
  },
  {
    title: "Winco UT-12 Utility Tongs 12 Inch",
    price: "$3.89",
    priceValue: 3.89,
    source: "WebstaurantStore",
    link: "https://www.webstaurantstore.com/winco-ut-12-utility-tongs-12/129UT12.html",
    imageUrl: "https://www.webstaurantstore.com/images/products/medium/129UT12.jpg",
    rating: 4.4,
    tags: ["tongs", "winco", "metal"],
  },
  {
    title: "Cuisinart CTG-00-3TONG 3-Piece Tongs Set",
    price: "$16.99",
    priceValue: 16.99,
    source: "Amazon",
    link: "https://www.amazon.com/Cuisinart-CTG-00-3TONG-3-Piece-Tongs/dp/B004TRXD1O",
    imageUrl: "https://m.media-amazon.com/images/I/71tongs.jpg",
    rating: 4.5,
    tags: ["tongs", "cuisinart", "set"],
  },
  {
    title: "OXO Good Grips 4-Inch Pizza Wheel",
    price: "$13.99",
    priceValue: 13.99,
    source: "Target",
    link: "https://www.target.com/p/oxo-good-grips-4-pizza-wheel/-/A-11129450",
    imageUrl: "https://target.scene7.com/is/image/Target/GUEST_pizza_wheel",
    rating: 4.7,
    tags: ["pizza cutter", "pizza wheel", "oxo", "cutter"],
  },
  {
    title: "Winco PIZ-3 Stainless Steel Pizza Cutter 2.75\"",
    price: "$4.19",
    priceValue: 4.19,
    source: "WebstaurantStore",
    link: "https://www.webstaurantstore.com/winco-piz-3-stainless-steel-pizza-cutter/922PIZ3.html",
    imageUrl: "https://www.webstaurantstore.com/images/products/medium/922PIZ3.jpg",
    rating: 4.3,
    tags: ["pizza cutter", "pizza wheel", "winco", "metal"],
  },
  {
    title: "San Jamar Disposable Poly Gloves Medium 100ct",
    price: "$5.99",
    priceValue: 5.99,
    source: "WebstaurantStore",
    link: "https://www.webstaurantstore.com/san-jamar-g10-medium-disposable-poly-gloves/640G10M.html",
    imageUrl: "https://www.webstaurantstore.com/images/products/medium/640G10M.jpg",
    rating: 4.2,
    tags: ["gloves", "poly", "disposable"],
  },
  {
    title: "HandyPlus Nitrile Gloves Powder Free Medium 100ct",
    price: "$9.99",
    priceValue: 9.99,
    source: "Amazon",
    link: "https://www.amazon.com/HandyPlus-Nitrile-Gloves-Powder-Free/dp/B08EXAMPLE",
    imageUrl: "https://m.media-amazon.com/images/I/71gloves.jpg",
    rating: 4.5,
    tags: ["gloves", "nitrile", "disposable"],
  },
  {
    title: "Nordic Ware Natural Aluminum Half Sheet Pan",
    price: "$18.99",
    priceValue: 18.99,
    source: "Target",
    link: "https://www.target.com/p/nordic-ware-natural-aluminum-half-sheet/-/A-11165308",
    imageUrl: "https://target.scene7.com/is/image/Target/GUEST_sheet_pan",
    rating: 4.8,
    tags: ["sheet pan", "baking sheet", "pan", "nordic"],
  },
  {
    title: "Winco ALXP-1826 Aluminum Sheet Pan Full Size",
    price: "$12.49",
    priceValue: 12.49,
    source: "WebstaurantStore",
    link: "https://www.webstaurantstore.com/winco-alxp-1826-full-size-18-gauge-aluminum-sheet-pan/926ALXP1826.html",
    imageUrl: "https://www.webstaurantstore.com/images/products/medium/926ALXP1826.jpg",
    rating: 4.6,
    tags: ["sheet pan", "baking sheet", "pan", "winco"],
  },
];

function parsePriceValue(price?: string): number {
  if (!price) return 0;
  const m = price.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : 0;
}

/** Short tappable button label: brand + key word + price, ~28 chars. */
export function shortLabel(title: string, price: string): string {
  const stop = new Set([
    "the",
    "a",
    "an",
    "with",
    "and",
    "for",
    "of",
    "in",
    "commercial",
    "products",
    "good",
    "grips",
    "inch",
    "high",
    "heat",
    "flexible",
    "solid",
    "stainless",
    "steel",
  ]);
  const words = title
    .replace(/["']/g, "")
    .split(/[\s\-/,]+/)
    .filter((w) => w && !stop.has(w.toLowerCase()) && !/^\d/.test(w) && w.length > 1);
  // Keep multi-word brands like "Di Oro" / "New Star"
  const brand =
    words.length >= 2 && /^(di|new|san)$/i.test(words[0])
      ? `${words[0]} ${words[1]}`
      : words[0] || "Item";
  const afterBrand = brand.includes(" ") ? words.slice(2) : words.slice(1);
  // Prefer a distinctive product word (Spatula, Turner, Tongs, etc.)
  const key =
    afterBrand.find((w) => /spatula|turner|tongs|cutter|wheel|glove|pan|sheet/i.test(w)) ||
    afterBrand[0] ||
    "";
  let label = key ? `${brand} ${key}` : brand;
  const pricePart = price.replace(/\s+/g, "");
  const max = 28 - pricePart.length - 1;
  if (label.length > max) {
    // Truncate on a word boundary when possible
    label = label.slice(0, max).replace(/\s+\S*$/, "").trim() || label.slice(0, max).trim();
  }
  return `${label} ${pricePart}`.trim();
}

function toOption(
  raw: {
    title: string;
    price: string;
    priceValue?: number;
    source: string;
    link: string;
    imageUrl: string;
    rating?: number;
  },
  index: number
): ProductOption {
  const priceValue = raw.priceValue ?? parsePriceValue(raw.price);
  return {
    id: `p${index}-${Buffer.from(`${raw.source}|${raw.title}`).toString("base64url").slice(0, 12)}`,
    title: raw.title,
    price: raw.price.startsWith("$") ? raw.price : `$${raw.price}`,
    priceValue,
    source: raw.source,
    link: raw.link,
    imageUrl: raw.imageUrl,
    rating: raw.rating,
    label: shortLabel(raw.title, raw.price.startsWith("$") ? raw.price : `$${raw.price}`),
  };
}

function dedupe(options: ProductOption[]): ProductOption[] {
  const seen = new Set<string>();
  const out: ProductOption[] = [];
  for (const o of options) {
    const key = `${o.source.toLowerCase()}|${o.title.toLowerCase().slice(0, 40)}`;
    if (seen.has(key)) continue;
    // Prefer variety of stores in the top results
    const storeCount = out.filter((x) => x.source.toLowerCase() === o.source.toLowerCase()).length;
    if (storeCount >= 2 && out.length < 6) continue;
    seen.add(key);
    out.push(o);
  }
  return out;
}

function fallbackSearch(query: string): ProductOption[] {
  const q = query.toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);
  const scored = FALLBACK_CATALOG.map((item, i) => {
    const hay = `${item.title} ${item.tags.join(" ")}`.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (hay.includes(t)) score += 2;
      if (item.tags.some((tag) => tag.includes(t) || t.includes(tag))) score += 3;
    }
    if (q.includes("cheap") || q.includes("cheapest")) score += 10 - item.priceValue / 5;
    if (q.includes("metal") || q.includes("stainless")) {
      score += /metal|stainless|steel|winco/i.test(hay) ? 4 : -2;
    }
    if (q.includes("silicone")) score += /silicone/i.test(hay) ? 4 : 0;
    return { item, i, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const pool = scored.length
    ? scored.map((x) => x.item)
    : FALLBACK_CATALOG.filter((i) => i.tags.some((t) => q.includes(t.split(" ")[0])));

  return dedupe(pool.map((item, i) => toOption(item, i)));
}

async function serperSearch(query: string): Promise<ProductOption[]> {
  const key = process.env.SERPER_API_KEY;
  if (!key) return [];

  const res = await fetch("https://google.serper.dev/shopping", {
    method: "POST",
    headers: {
      "X-API-KEY": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: query, gl: "us", hl: "en", num: 12 }),
  });

  if (!res.ok) {
    console.warn("[shopping] Serper error", res.status, await res.text());
    return [];
  }

  const data = (await res.json()) as {
    shopping?: Array<{
      title?: string;
      price?: string;
      source?: string;
      link?: string;
      imageUrl?: string;
      image?: string;
      rating?: number;
    }>;
  };

  const mapped = (data.shopping || [])
    .filter((s) => s.title && s.link)
    .map((s, i) =>
      toOption(
        {
          title: s.title!,
          price: s.price || "$0",
          source: s.source || "Store",
          link: s.link!,
          imageUrl: s.imageUrl || s.image || "",
          rating: s.rating,
        },
        i
      )
    );

  return dedupe(mapped);
}

export async function searchProducts(
  query: string,
  opts?: { limit?: number; offset?: number }
): Promise<{ options: ProductOption[]; total: number; mocked: boolean }> {
  const limit = opts?.limit ?? 3;
  const offset = opts?.offset ?? 0;

  let all = await serperSearch(query);
  let mocked = false;
  if (all.length === 0) {
    all = fallbackSearch(query);
    mocked = true;
    console.log("[shopping:mock] using curated catalog for", query);
  }

  // Prefer guest-cart-friendly stores a bit for the demo
  const preferred = ["webstaurantstore", "target", "amazon", "walmart"];
  all = [...all].sort((a, b) => {
    const ai = preferred.findIndex((p) => a.source.toLowerCase().includes(p));
    const bi = preferred.findIndex((p) => b.source.toLowerCase().includes(p));
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  // Ensure unique labels among the page we're returning
  const page = all.slice(offset, offset + limit).map((o, i) => {
    const others = all.slice(offset, offset + limit).filter((_, j) => j !== i);
    let label = o.label;
    if (others.some((x) => x.label === label)) {
      label = shortLabel(`${o.source} ${o.title}`, o.price);
    }
    return { ...o, label };
  });

  return { options: page, total: all.length, mocked };
}

export function slugifyItem(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "item";
}

export function matchProductChoice(
  text: string,
  options: ProductOption[]
): ProductOption | "show_more" | "cancel" | "refine" | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, " ");
  const bare = t.replace(/[.!?,]+$/g, "");

  if (/^(show more|more|next|other options|see more)$/.test(bare)) return "show_more";
  if (/^(n|no|nope|nah|none|cancel|never ?mind|nvm|skip|forget it)$/.test(bare)) return "cancel";

  const ordinals: Record<string, number> = {
    "1": 0,
    "1st": 0,
    first: 0,
    one: 0,
    "2": 1,
    "2nd": 1,
    second: 1,
    two: 1,
    "3": 2,
    "3rd": 2,
    third: 2,
    three: 2,
  };
  for (const [k, idx] of Object.entries(ordinals)) {
    if (bare === k || bare === `the ${k}` || bare === `option ${k}` || bare === `#${k}` || bare === `number ${k}`) {
      return options[idx] ?? null;
    }
  }
  const numMatch = bare.match(/^(?:the\s+)?(?:option\s+|number\s+|#)?([123])$/);
  if (numMatch) return options[Number(numMatch[1]) - 1] ?? null;

  if (/cheap|cheapest|least expensive|lowest/.test(t)) {
    return [...options].sort((a, b) => a.priceValue - b.priceValue)[0] ?? null;
  }
  if (/best rated|highest rated|top rated/.test(t)) {
    return [...options].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0] ?? null;
  }

  // Exact / partial button label or brand / store match
  for (const o of options) {
    if (bare === o.label.toLowerCase()) return o;
    if (bare.includes(o.label.toLowerCase())) return o;
  }
  for (const o of options) {
    const brand = o.title.split(/\s+/)[0]?.toLowerCase();
    const store = o.source.toLowerCase();
    if (brand && (bare.includes(brand) || bare === `the ${brand}` || bare === `${brand} one`)) return o;
    if (bare.includes(store) || bare === `${store} one` || bare === `the ${store} one`) return o;
  }

  // Refinement signals
  if (
    /\b(instead|metal|silicone|cheaper|more expensive|different|plastic|wood|smaller|larger|bigger)\b/.test(t) ||
    /\b(show|find|look for|search)\b/.test(t)
  ) {
    return "refine";
  }

  return null;
}
