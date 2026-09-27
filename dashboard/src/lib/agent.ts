import { randomUUID } from "crypto";
import { generateText, tool, type LanguageModel } from "ai";
import { z } from "zod";
import {
  appendActionMemory,
  appendTimeline,
  editPage,
  formatAmount,
  getBehaviorLog,
  getPage,
  listInventory,
  listPages,
  listWorkflows,
  putPage,
  type InventoryItem,
  type Workflow,
} from "./brain";
import { addDays, daysBetween, describeDay, todayISO } from "./clock";
import {
  cancelPendingActions,
  createActionRun,
  getPendingAction,
  recordCheckup,
  updateActionRun,
  wasCheckedOn,
  type ActionRunRow,
  type ProductCard,
} from "./db";
import { sendEmail } from "./tools/email";
import { addToCart } from "./tools/browser";
import { placeSupplierOrder } from "./tools/orders";
import {
  matchProductChoice,
  searchProducts,
  slugifyItem,
  type ProductOption,
} from "./tools/shopping";
import { getOwnerPhone, sendToOwner } from "./sms";

export type Reply = { body: string; quickReplies?: string[]; cards?: ProductCard[] };
export type AgentResult = { replies: Reply[]; actions: string[] };

const CONFIRM_BUTTONS = ["Yes", "Change"];
const ROUTINE_BUTTONS = ["Make it the default", "Just this once"];
const SAME_BUTTONS = ["Same as last time", "Show me options"];
const CHECKUP_BUTTONS = ["Yes", "Change", "Still have some"];
const RECHECK_AFTER_DAYS = 2;
const BEHAVIOR_SLUG = "preferences/owner-behavior";
const PEPSI_WORKFLOW = "workflows/pepsi-delivery-change";

type Step = {
  type: "order" | "email" | "remember" | "shop";
  workflow?: string;
  product?: string;
  quantity?: number;
  usual_qty?: number;
  unit?: string;
  unit_price?: number;
  sku?: string;
  inventory?: string;
  supplier?: string;
  to?: string;
  subject?: string;
  body?: string;
  day?: number;
  fact?: string;
  query?: string;
};

type Deviation = {
  workflow: string;
  label: string;
  unit: string;
  from: number;
  to: number;
  said: string;
  inventory?: string;
};

type ShopPayload = {
  /** Current search string (may include refinements like "metal"). */
  query: string;
  /** Original item name used for purchase memory, e.g. "spatula". */
  baseQuery: string;
  quantity: number;
  options: ProductOption[];
  offset: number;
  total?: number;
  slug?: string;
  prior?: {
    product: string;
    price: string;
    merchant: string;
    link: string;
  };
};

type Payload = {
  steps?: Step[];
  said?: string;
  deviation?: Deviation;
  /** Inventory slugs this check-up asked about, so "still have some" knows what it refers to. */
  checkup?: string[];
} & Partial<ShopPayload>;

type Intent = { intent: "yes" | "no" | "change" | "other"; details?: string };

// ---------- wording ----------

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

function supplierName(slug?: string) {
  return slug === "company-b" ? "Company B" : slug || "the supplier";
}

function describeStep(s: Step): string {
  if (s.type === "order") {
    const cost = s.unit_price ? ` (~$${Math.round(s.unit_price * (s.quantity ?? 0))})` : "";
    const usual = s.quantity === s.usual_qty ? "the usual " : "";
    return `order ${usual}${s.quantity} ${s.unit} of ${s.product?.toLowerCase()} from ${supplierName(s.supplier)}${cost}`;
  }
  if (s.type === "email") {
    return s.day ? `email Bob to move the Pepsi delivery to the ${ordinal(s.day)}` : `email ${s.to}`;
  }
  if (s.type === "shop") {
    return `shop for ${s.query}${s.quantity && s.quantity > 1 ? ` (x${s.quantity})` : ""}`;
  }
  return `remember that ${s.fact}`;
}

function joinList(parts: string[]) {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function describeSteps(steps: Step[]) {
  const parts: string[] = [];
  const orders = steps.filter((s) => s.type === "order");
  const bySupplier = new Map<string, Step[]>();
  for (const s of orders) bySupplier.set(s.supplier ?? "", [...(bySupplier.get(s.supplier ?? "") ?? []), s]);
  for (const [supplier, group] of bySupplier) {
    if (group.length === 1) {
      parts.push(describeStep(group[0]));
      continue;
    }
    const allUsual = group.every((s) => s.quantity === s.usual_qty);
    const cost = Math.round(group.reduce((sum, s) => sum + (s.unit_price ?? 0) * (s.quantity ?? 0), 0));
    const items = joinList(group.map((s) => `${s.quantity} ${s.unit} of ${s.product?.toLowerCase()}`));
    parts.push(`order ${allUsual ? "the usual " : ""}${items} from ${supplierName(supplier)}${cost ? ` (~$${cost} total)` : ""}`);
  }
  parts.push(...steps.filter((s) => s.type !== "order").map(describeStep));
  return joinList(parts);
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function pluralize(query: string) {
  if (query.endsWith("s")) return query;
  if (query.endsWith("y")) return `${query.slice(0, -1)}ies`;
  return `${query}s`;
}

function toCards(options: ProductOption[]): ProductCard[] {
  return options.map((o) => ({
    title: o.title,
    price: o.price,
    source: o.source,
    link: o.link,
    imageUrl: o.imageUrl,
    label: o.label,
  }));
}

function choiceButtons(options: ProductOption[], hasMore: boolean) {
  const buttons = options.map((o) => o.label);
  if (hasMore) buttons.push("Show more");
  return buttons;
}

// ---------- building steps from GBrain workflows ----------

function orderStepFromWorkflow(wf: Workflow, quantity?: number): Step {
  const fm = wf.fm;
  const usual = Number(fm.default_qty ?? 0);
  return {
    type: "order",
    workflow: wf.slug,
    product: String(fm.product ?? wf.title),
    quantity: quantity ?? usual,
    usual_qty: usual,
    unit: String(fm.unit ?? ""),
    unit_price: Number(fm.unit_price ?? 0),
    sku: fm.sku ? String(fm.sku) : undefined,
    inventory: fm.inventory ? String(fm.inventory) : undefined,
    supplier: String(fm.supplier ?? ""),
  };
}

async function pepsiEmailStep(day: number): Promise<Step> {
  const contact = await getPage("contacts/bob-pepsi");
  const current = Number(contact?.frontmatter.delivery_day ?? 15);
  const to =
    process.env.DEMO_EMAIL_TO || String(contact?.frontmatter.email ?? "bob.pepsi.rep@example.com");
  return {
    type: "email",
    workflow: PEPSI_WORKFLOW,
    to,
    day,
    subject: `Tony's Pizzeria: move Pepsi delivery to the ${ordinal(day)}`,
    body: `Hi Bob,\n\nCould you move our standing Pepsi syrup delivery from the ${ordinal(current)} to the ${ordinal(day)} of each month?\n\nThanks,\nTony's Pizzeria`,
  };
}

async function cheeseWorkflow() {
  const workflows = await listWorkflows();
  return workflows.find((w) => w.fm.inventory === "inventory/mozzarella");
}

// ---------- heuristic understanding ----------

function parseQuantity(text: string): number | null {
  const patterns = [
    new RegExp(String.raw`\b(\d+(?:\.\d+)?)\s*(?:lbs?|pounds?)\b`, "i"),
    new RegExp(String.raw`\b(\d+)\s+(?:x\s+)?[a-z]{2,}\b`, "i"),
    new RegExp(
      String.raw`\b(?:make it|get|order|need|want|bump (?:it )?(?:up )?to|up to|go with)\s+(\d+(?:\.\d+)?)\b`,
      "i"
    ),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return Number(m[1]);
  }
  return null;
}

function parseDay(text: string): number | null {
  const m =
    text.match(/\b(?:to|on|for|until)\s+the\s+(\d{1,2})(?:st|nd|rd|th)\b/i) ||
    text.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+instead\b/i) ||
    text.match(/\b(\d{1,2})(?:st|nd|rd|th)\b/i);
  return m ? Number(m[1]) : null;
}

const NEGATE = String.raw`(?:don'?t|do not|skip|no|without|hold off on|cancel|forget)`;
const mentionsPepsi = (t: string) => /pepsi|bob|soda/i.test(t);
const mentionsCheese = (t: string) => /cheese|mozz/i.test(t);
const negatesPepsi = (t: string) =>
  new RegExp(`${NEGATE}\\s+(?:the\\s+)?(?:\\w+\\s+){0,2}?(?:email|bob|pepsi)`, "i").test(t);
const negatesCheese = (t: string) =>
  new RegExp(`${NEGATE}\\s+(?:the\\s+)?(?:\\w+\\s+){0,2}?(?:cheese|mozzarella|order)`, "i").test(t);

function parseRemember(text: string): string | null {
  const m = text.match(/remember\s+(?:that\s+)?(.+)/i);
  return m ? m[1].trim().replace(/[.!]+$/, "") : null;
}

/** Extract a shoppable item that isn't covered by an inventory workflow. */
function parseShopQuery(text: string): { query: string; quantity: number } | null {
  const t = text.trim();
  if (mentionsCheese(t) || mentionsPepsi(t)) return null;

  const patterns = [
    /\b(?:i\s+)?(?:want|wanna|need|gotta)\s+(?:to\s+)?(?:order|buy|get|find|pick up)\s+(?:an?\s+|some\s+|the\s+)?(.+?)(?:\s+please)?[.!?]*$/i,
    /\b(?:order|buy|get|find|purchase|grab)\s+(?:me\s+)?(?:an?\s+|some\s+|the\s+)?(.+?)(?:\s+please)?[.!?]*$/i,
    /\b(?:can you|could you|please)\s+(?:order|buy|get|find)\s+(?:me\s+)?(?:an?\s+|some\s+|the\s+)?(.+?)[.!?]*$/i,
    /\blooking for\s+(?:an?\s+|some\s+)?(.+?)[.!?]*$/i,
  ];

  for (const re of patterns) {
    const m = t.match(re);
    if (!m?.[1]) continue;
    let item = m[1]
      .replace(/\b(for\s+the\s+(kitchen|restaurant|shop)|online|asap|today|please)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!item || item.length < 2 || item.length > 60) continue;
    if (/^(yes|no|change|it|that|this|them)\b/i.test(item)) continue;

    let quantity = 1;
    const qtyMatch = item.match(/^(\d+)\s+(.+)/);
    if (qtyMatch) {
      quantity = Number(qtyMatch[1]);
      item = qtyMatch[2];
    }
    // Singularize simple plurals for the search query
    let query = item.trim();
    if (/ies$/i.test(query)) query = query.replace(/ies$/i, "y");
    else if (/ses$/i.test(query)) query = query.replace(/es$/i, "");
    else if (/[^s]s$/i.test(query)) query = query.slice(0, -1);
    return { query, quantity };
  }
  return null;
}

async function heuristicPlan(text: string): Promise<Step[]> {
  const steps: Step[] = [];
  const wf = await cheeseWorkflow();
  if (wf && mentionsCheese(text) && !negatesCheese(text)) {
    steps.push(orderStepFromWorkflow(wf, parseQuantity(text) ?? undefined));
  }
  const day = parseDay(text);
  if (mentionsPepsi(text) && day && !negatesPepsi(text)) steps.push(await pepsiEmailStep(day));
  const fact = parseRemember(text);
  if (fact) steps.push({ type: "remember", fact });

  if (steps.length === 0) {
    const shop = parseShopQuery(text);
    if (shop) steps.push({ type: "shop", query: shop.query, quantity: shop.quantity });
  }
  return steps;
}

function orderAliases(s: Step): string[] {
  return [(s.product ?? "").toLowerCase(), ...(ITEM_ALIASES[s.inventory ?? ""] ?? [])].filter(Boolean);
}

async function heuristicRevise(steps: Step[], text: string): Promise<Step[]> {
  let next = steps.map((s) => ({ ...s }));
  const t = text.toLowerCase();
  const orders = next.filter((s) => s.type === "order");
  const named = orders.filter((s) => orderAliases(s).some((a) => t.includes(a)));
  const dropped = orders.filter((s) =>
    orderAliases(s).some((a) => new RegExp(`${NEGATE}\\s+(?:the\\s+)?(?:\\w+\\s+){0,2}?${a}`, "i").test(t))
  );

  if (dropped.length) {
    next = next.filter((s) => !dropped.includes(s));
  } else if (negatesCheese(text) && orders.length <= 1) {
    next = next.filter((s) => s.type !== "order");
  }
  const qty = parseQuantity(text);
  if (qty) {
    const kept = orders.filter((s) => next.includes(s));
    const order = named.find((s) => kept.includes(s)) ?? (kept.length === 1 ? kept[0] : undefined);
    if (order) order.quantity = qty;
    else if (orders.length === 0) {
      const wf = await cheeseWorkflow();
      if (wf) next.push(orderStepFromWorkflow(wf, qty));
    }
  }

  const day = parseDay(text);
  const hasEmail = next.some((s) => s.type === "email");
  if (negatesPepsi(text)) {
    next = next.filter((s) => s.type !== "email");
  } else if (day && (mentionsPepsi(text) || hasEmail)) {
    next = next.filter((s) => s.type !== "email");
    next.push(await pepsiEmailStep(day));
  }

  const fact = parseRemember(text);
  if (fact) next.push({ type: "remember", fact });
  return next;
}

function heuristicIntent(text: string, kind: string): Intent | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, " ");
  const bare = t.replace(/[.!?,\s]+$/, "");

  if (/^(change|change it|edit|modify|tweak|adjust|something else|not quite|make a change)$/.test(bare)) {
    return { intent: "change" };
  }

  if (kind === "workflow_update") {
    if (/(just this (once|time)|one[- ]?(off|time)|only this (once|time)|not always|keep (it|the usual|as is)|\bno\b|\bnah\b|\bnope\b)/.test(t)) {
      return { intent: "no" };
    }
    if (/(default|always|from now on|every ?time|the norm|new normal|going forward|\byes\b|\byeah\b|\byep\b|\bsure\b|\bok(ay)?\b|sounds good|do it|please)/.test(t) || /👍|✅/u.test(t)) {
      return { intent: "yes" };
    }
    return null;
  }

  if (kind === "same_purchase") {
    if (/show me options|show options|other options|different|search|look|new/.test(t)) {
      return { intent: "change", details: "show options" };
    }
    if (/same|usual|last time|that one|yep|yes|yeah|sure|ok|okay|go ahead|do it/.test(t) || /👍|✅/u.test(t)) {
      return { intent: "yes" };
    }
    if (/^(n|no|nope|nah|cancel)/.test(t)) return { intent: "no" };
    return null;
  }

  const changeSignal =
    /\b(change|instead|actually|different|make it|switch|also|but|only|except|rather|swap|more|less|fewer|bump|add|drop|remove)\b/.test(t) ||
    /\b(?:skip|hold off on|without)\s+(?:the\s+)?(?!it\b)\w+/.test(t) ||
    negatesPepsi(t) ||
    negatesCheese(t) ||
    parseQuantity(t) !== null ||
    parseDay(t) !== null ||
    /remember/.test(t);

  if (!changeSignal && /^(n|no|nope|nah|cancel|stop|hold off|not now|not yet|wait|never ?mind|nvm|skip it|forget it|don'?t)\b/.test(t)) {
    return { intent: "no" };
  }
  if (
    !changeSignal &&
    (/^(y|ya|yes|yea|yeah|yep|yup|sure|ok|okay|k|kk|sounds (good|great)|go for it|go ahead|do it|send it|ship it|perfect|great|cool|confirm(ed)?|approved?|absolutely|definitely|let'?s do it|let'?s go|that works|works for me|please( do)?|all good|looks good|lgtm|bet)\b/.test(t) ||
      /^(👍|✅|👌|🙏|💯)/u.test(t))
  ) {
    return { intent: "yes" };
  }
  if (changeSignal) return { intent: "change", details: text.trim() };
  return null;
}

// ---------- LLM ----------

async function getModel(): Promise<LanguageModel | null> {
  if (process.env.ANTHROPIC_API_KEY) {
    const { createAnthropic } = await import("@ai-sdk/anthropic");
    return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(
      process.env.AGENT_MODEL || "claude-sonnet-4-20250514"
    );
  }
  if (process.env.OPENAI_API_KEY) {
    const { createOpenAI } = await import("@ai-sdk/openai");
    return createOpenAI({ apiKey: process.env.OPENAI_API_KEY })(process.env.AGENT_MODEL || "gpt-4o-mini");
  }
  return null;
}

async function llmStructured<S extends z.ZodType>(
  schema: S,
  system: string,
  prompt: string
): Promise<z.infer<S> | null> {
  const model = await getModel();
  if (!model) return null;
  try {
    const respond = tool({
      description: "Return your structured answer",
      inputSchema: schema,
      execute: async (input) => input,
    });
    const result = await generateText({
      model,
      tools: { respond },
      toolChoice: "required",
      system,
      prompt,
    });
    const call = result.toolCalls?.[0];
    return call && "input" in call ? (call.input as z.infer<S>) : null;
  } catch (err) {
    console.warn("[agent] LLM call failed, falling back to heuristics", err);
    return null;
  }
}

const SYSTEM = `You are OYI, the ops assistant for Tony's Pizzeria, working over SMS and the web dashboard.
Always follow Tony's enshrined workflows and learned preferences from the brain context.
Only use these step types:
- order: a website order that follows an order workflow (give the workflow slug and quantity)
- email: the Pepsi delivery change email to Bob (give the new day of month)
- shop: buy a new item online that is NOT covered by an inventory workflow (query + optional quantity). Use for spatulas, tongs, tools, equipment, etc.
- remember: a fact Tony wants kept in memory
Never invent suppliers or contacts. Prefer shop over inventing a workflow.`;

const rawStepSchema = z.object({
  type: z.enum(["order", "email", "remember", "shop"]),
  workflow: z.string().optional().describe("Workflow slug for order steps, e.g. workflows/reorder-mozzarella"),
  quantity: z.number().optional(),
  day: z.number().optional().describe("New Pepsi delivery day of the month, for email steps"),
  fact: z.string().optional(),
  query: z.string().optional().describe("Product search query for shop steps, e.g. spatula"),
});
type RawStep = z.infer<typeof rawStepSchema>;

async function normalizeSteps(raw: RawStep[]): Promise<Step[]> {
  const workflows = await listWorkflows();
  const steps: Step[] = [];
  for (const r of raw) {
    if (r.type === "order") {
      const wf = workflows.find((w) => w.slug === r.workflow) ?? workflows.find((w) => w.action === "order");
      if (wf) steps.push(orderStepFromWorkflow(wf, r.quantity));
    } else if (r.type === "email" && r.day) {
      steps.push(await pepsiEmailStep(r.day));
    } else if (r.type === "remember" && r.fact) {
      steps.push({ type: "remember", fact: r.fact });
    } else if (r.type === "shop" && r.query) {
      steps.push({ type: "shop", query: r.query, quantity: r.quantity ?? 1 });
    }
  }
  return steps;
}

function toRaw(steps: Step[]): RawStep[] {
  return steps.map((s) => ({
    type: s.type,
    workflow: s.workflow,
    quantity: s.quantity,
    day: s.day,
    fact: s.fact,
    query: s.query,
  }));
}

async function buildContext() {
  const [inventory, workflows, behavior, purchases] = await Promise.all([
    listInventory(),
    listWorkflows(),
    getBehaviorLog(),
    listPages("purchases/"),
  ]);
  return [
    `INVENTORY (estimated, no scale or POS; today is ${todayISO()}):`,
    ...inventory.map(
      (i) =>
        `- ${i.name}: ~${formatAmount(i.estimate)} ${i.unit} (low point ${i.par}, uses ~${i.daily_use}/day, next check-up ${i.next_checkup})${i.low ? " PROBABLY LOW" : ""}`
    ),
    "WORKFLOWS:",
    ...workflows.map(
      (w) =>
        `- ${w.slug}: when ${w.trigger}, ${w.action} via ${w.channel}` +
        (w.fm.default_qty ? ` (usual ${w.fm.default_qty} ${w.fm.unit})` : "")
    ),
    "PRIOR PURCHASES:",
    ...purchases.map(
      (p) =>
        `- ${p.slug}: ${p.frontmatter.product || p.title} (${p.frontmatter.price} @ ${p.frontmatter.merchant})`
    ),
    "TONY'S LEARNED PREFERENCES:",
    ...behavior.slice(0, 8).map((b) => `- ${b}`),
  ].join("\n");
}

async function llmIntent(text: string, pending: ActionRunRow): Promise<Intent | null> {
  const question =
    pending.kind === "workflow_update"
      ? `You asked Tony whether a change should become his new default routine: "${pending.summary}". yes = make it the default, no = just this once.`
      : pending.kind === "same_purchase"
        ? `You asked if Tony wants the same product as last time: "${pending.summary}". yes = same, change = show new options, no = cancel.`
        : `You proposed: "${pending.summary}" and asked if it's good to go.`;
  return llmStructured(
    z.object({
      intent: z.enum(["yes", "no", "change", "other"]),
      details: z.string().optional().describe("For change: what Tony wants different, if he said"),
    }),
    SYSTEM,
    `${question}\nTony replied: """${text}"""\nClassify: yes (approves, in any wording), no (declines), change (wants something different), other (unrelated new request).`
  );
}

async function llmPlan(text: string): Promise<{ steps: Step[]; answer?: string } | null> {
  const out = await llmStructured(
    z.object({
      steps: z.array(rawStepSchema),
      answer: z.string().optional().describe("Short SMS answer if Tony asked a question and no steps are needed"),
    }),
    SYSTEM,
    `Brain context:\n${await buildContext()}\n\nTony texted: """${text}"""\nReturn the steps he wants done (empty if none).`
  );
  if (!out) return null;
  return { steps: await normalizeSteps(out.steps), answer: out.answer };
}

async function llmRevise(steps: Step[], change: string): Promise<Step[] | null> {
  const out = await llmStructured(
    z.object({ steps: z.array(rawStepSchema) }),
    SYSTEM,
    `Brain context:\n${await buildContext()}\n\nCurrent plan: ${JSON.stringify(toRaw(steps))}\nTony wants this changed: """${change}"""\nReturn the full revised plan.`
  );
  return out ? normalizeSteps(out.steps) : null;
}

async function llmPickProduct(
  text: string,
  options: ProductOption[]
): Promise<ProductOption | "show_more" | "cancel" | "refine" | null> {
  const out = await llmStructured(
    z.object({
      choice: z.enum(["pick", "show_more", "cancel", "refine", "unclear"]),
      index: z.number().optional().describe("0-based index into options when choice is pick"),
      refineQuery: z.string().optional(),
    }),
    "Match Tony's SMS reply to one of the product options, or classify show_more / cancel / refine.",
    `Options:\n${options.map((o, i) => `${i}) ${o.title} | ${o.price} | ${o.source} | label=${o.label}`).join("\n")}\n\nTony said: """${text}"""`
  );
  if (!out) return null;
  if (out.choice === "pick" && out.index !== undefined && options[out.index]) return options[out.index];
  if (out.choice === "show_more" || out.choice === "cancel" || out.choice === "refine") return out.choice;
  return null;
}

// ---------- routine changes ----------

async function findDeviation(steps: Step[], said: string): Promise<Deviation | undefined> {
  const workflows = await listWorkflows();
  for (const s of steps) {
    if (s.type !== "order" || !s.workflow) continue;
    const wf = workflows.find((w) => w.slug === s.workflow);
    const usual = Number(wf?.fm.default_qty ?? 0);
    if (wf && usual && s.quantity && s.quantity !== usual) {
      return {
        workflow: wf.slug,
        label: `${s.product?.toLowerCase()} order`,
        unit: s.unit ?? "",
        from: usual,
        to: s.quantity,
        said,
        inventory: s.inventory,
      };
    }
  }
}

async function applyRoutineChange(dev: Deviation): Promise<string> {
  const swap: [string, string] = [`${dev.from} ${dev.unit}`, `${dev.to} ${dev.unit}`];
  const reason = dev.said ? ` Tony said: "${dev.said}"` : "";
  await editPage(dev.workflow, {
    patch: { default_qty: dev.to },
    replace: [swap],
    timeline: `Tony made ${dev.to} ${dev.unit} the new default (was ${dev.from}).${reason}`,
  });
  if (dev.inventory) {
    await editPage(dev.inventory, { patch: { reorder_qty: dev.to }, replace: [swap] });
  }
  await appendTimeline(
    BEHAVIOR_SLUG,
    `Routine change: ${dev.label} is now ${dev.to} ${dev.unit} by default (was ${dev.from}).${reason}`
  );
  return `Done. Your ${dev.label} is now ${dev.to} ${dev.unit} by default. I'll use that from now on.`;
}

async function recordOneOff(dev: Deviation): Promise<string> {
  const reason = dev.said ? ` Tony said: "${dev.said}"` : "";
  const wf = await editPage(dev.workflow, {
    timeline: `One-off: ordered ${dev.to} ${dev.unit} instead of the usual ${dev.from}.${reason}`,
  });
  await appendTimeline(
    BEHAVIOR_SLUG,
    `One-off: ${dev.label} bumped from ${dev.from} to ${dev.to} ${dev.unit}; routine unchanged.${reason}`
  );
  const oneOffs = wf.content.split("\n").filter((l) => l.includes("One-off:")).length;
  const pattern =
    oneOffs >= 2
      ? ` That's ${oneOffs} times now, so I'll bring it up again if it keeps happening.`
      : " I noted it in case it becomes a pattern.";
  return `Got it, keeping ${dev.from} ${dev.unit} as your usual.${pattern}`;
}

// ---------- shopping / purchases ----------

async function getPriorPurchase(query: string) {
  const slug = `purchases/${slugifyItem(query)}`;
  const page = await getPage(slug);
  if (!page) {
    // fuzzy: match any purchase whose query/title contains the item
    const all = await listPages("purchases/");
    const q = query.toLowerCase();
    const hit = all.find(
      (p) =>
        String(p.frontmatter.query || "").toLowerCase().includes(q) ||
        p.title.toLowerCase().includes(q) ||
        String(p.frontmatter.product || "")
          .toLowerCase()
          .includes(q)
    );
    if (!hit) return null;
    return { slug: hit.slug, page: hit };
  }
  return { slug, page };
}

async function recordPurchase(
  query: string,
  product: ProductOption,
  quantity: number,
  alternatives: ProductOption[]
) {
  const slug = `purchases/${slugifyItem(query)}`;
  const existing = await getPage(slug);
  const times = Number(existing?.frontmatter.times_ordered ?? 0) + 1;
  const date = todayISO();
  const oldTimeline =
    existing?.content
      .split("## Timeline\n")[1]
      ?.split("\n")
      .filter((l) => l.startsWith("- "))
      .slice(0, 8)
      .join("\n") || "";
  const content = `---
product: ${product.title}
price: ${product.price}
price_value: ${product.priceValue}
merchant: ${product.source}
link: ${product.link}
query: ${query}
last_ordered: ${date}
times_ordered: ${times}
---

# Purchase: ${capitalize(query)}

## Compiled Truth
Tony's pick for ${query}: ${product.title} at ${product.source} for ${product.price}.
Ordered ${times} time${times === 1 ? "" : "s"}.

## Timeline
- ${date}: Added ${quantity > 1 ? `${quantity}× ` : ""}${product.title} (${product.price}, ${product.source}) to cart
${oldTimeline}
`.trim();

  await putPage(slug, `${content}\n`);

  const cheaper = alternatives.filter((a) => a.priceValue > 0 && a.priceValue < product.priceValue);
  const note = cheaper.length
    ? `Picked ${product.title} (${product.price}, ${product.source}) over cheaper options for ${query}`
    : `Picked ${product.title} (${product.price}, ${product.source}) for ${query}`;
  await appendTimeline(BEHAVIOR_SLUG, note);
}

async function presentOptions(
  actionId: string,
  query: string,
  quantity: number,
  offset: number,
  to: string,
  previous?: ShopPayload
) {
  const baseQuery = previous?.baseQuery || query;
  const { options, total } = await searchProducts(query, { limit: 3, offset });

  if (options.length === 0) {
    // Keep the prior choice alive so "metal instead" / picks still work
    if (previous?.options?.length) {
      updateActionRun(actionId, {
        status: "awaiting_product_choice",
        summary: `Pick a ${previous.baseQuery}`,
        payload: JSON.stringify(previous),
      });
      await sendToOwner(
        to,
        `That's all I found for ${query}. Pick one of the options above, or describe what you want differently.`,
        {
          quickReplies: choiceButtons(previous.options, false),
          cards: toCards(previous.options),
        }
      );
      return;
    }
    updateActionRun(actionId, {
      status: "failed",
      result: JSON.stringify({ error: "No results" }),
    });
    await sendToOwner(to, `Couldn't find ${pluralize(baseQuery)} online. Want to try a different name?`);
    return;
  }

  const hasMore = offset + options.length < total;
  const payload: ShopPayload = {
    query,
    baseQuery,
    quantity,
    options,
    offset,
    total,
    slug: slugifyItem(baseQuery),
  };
  updateActionRun(actionId, {
    status: "awaiting_product_choice",
    summary: `Pick a ${baseQuery}`,
    payload: JSON.stringify(payload),
  });

  const label = baseQuery === query ? query : baseQuery;
  const body =
    offset > 0
      ? `Here are ${options.length} more. Which one do you like?`
      : `Here are ${options.length} ${options.length === 1 ? "option" : "options"} for ${label}. Which one do you like?`;
  await sendToOwner(to, body, {
    quickReplies: choiceButtons(options, hasMore),
    cards: toCards(options),
  });
}

async function startShopFlow(from: string, query: string, quantity: number): Promise<AgentResult> {
  cancelPendingActions();
  const prior = await getPriorPurchase(query);

  if (prior) {
    const id = randomUUID();
    const product = String(prior.page.frontmatter.product || prior.page.title);
    const price = String(prior.page.frontmatter.price || "");
    const merchant = String(prior.page.frontmatter.merchant || "");
    const link = String(prior.page.frontmatter.link || "");
    createActionRun({
      id,
      kind: "same_purchase",
      status: "awaiting_confirmation",
      summary: `Same ${query}? ${product}`,
      payload: {
        query,
        baseQuery: query,
        quantity,
        options: [],
        offset: 0,
        slug: prior.slug.replace(/^purchases\//, ""),
        prior: { product, price, merchant, link },
      } satisfies ShopPayload,
    });
    return {
      replies: [
        {
          body: `Same as last time? ${product}${price ? `, ${price}` : ""}${merchant ? ` at ${merchant}` : ""}.`,
          quickReplies: SAME_BUTTONS,
          cards: link
            ? [{ title: product, price, source: merchant, link, label: "Same as last time" }]
            : undefined,
        },
      ],
      actions: [id],
    };
  }

  const id = randomUUID();
  createActionRun({
    id,
    kind: "product_choice",
    status: "running",
    summary: `Searching ${pluralize(query)}`,
    payload: {
      query,
      baseQuery: query,
      quantity,
      options: [],
      offset: 0,
    } satisfies ShopPayload,
  });

  setImmediate(() => {
    void presentOptions(id, query, quantity, 0, from, {
      query,
      baseQuery: query,
      quantity,
      options: [],
      offset: 0,
    });
  });

  return {
    replies: [{ body: `Looking up ${pluralize(query)} for you…` }],
    actions: [id],
  };
}

async function runAddToCart(
  actionId: string,
  from: string,
  query: string,
  quantity: number,
  product: ProductOption,
  alternatives: ProductOption[]
) {
  updateActionRun(actionId, {
    status: "running",
    summary: `Add ${product.title} to cart`,
    payload: JSON.stringify({
      query,
      quantity,
      options: [product],
      offset: 0,
      chosen: product,
    }),
  });

  await sendToOwner(
    from,
    `Adding the ${product.title} (${product.price}, ${product.source}) to the cart now. I'll stop before payment.`
  );

  const result = await addToCart(product, quantity, (liveUrl) => {
    updateActionRun(actionId, { browser_live_url: liveUrl });
  });

  if (result.liveUrl) updateActionRun(actionId, { browser_live_url: result.liveUrl });

  if (!result.ok && !result.mocked) {
    updateActionRun(actionId, {
      status: "failed",
      result: JSON.stringify({ cart: result, product }),
    });
    await sendToOwner(
      from,
      `Couldn't finish adding it to the cart${result.error ? ` (${result.error})` : ""}. Here's the link to add it yourself:\n${product.link}`
    );
    return;
  }

  await recordPurchase(query, product, quantity, alternatives);
  await appendActionMemory(
    `Shopped ${query}: ${product.title} @ ${product.source} ${product.price}${result.mocked ? " (mocked browser)" : ""}`
  );

  const cartUrl = result.cartUrl || product.link;
  updateActionRun(actionId, {
    status: "done",
    result: JSON.stringify({
      results: [`Added ${product.title} to ${product.source} cart`],
      cart: result,
      product,
      cartUrl,
    }),
  });

  const mockNote = result.mocked ? " (demo mode — open the link to finish)" : "";
  await sendToOwner(
    from,
    `Added to your ${product.source} cart${mockNote}. Finish checkout here:\n${cartUrl}`
  );
}

async function handleProductChoice(pending: ActionRunRow, text: string, from: string): Promise<AgentResult> {
  const payload = JSON.parse(pending.payload || "{}") as ShopPayload;
  const options = payload.options || [];

  let match = matchProductChoice(text, options);
  if (!match) match = (await llmPickProduct(text, options)) ?? null;

  if (match === "cancel") {
    updateActionRun(pending.id, { status: "cancelled" });
    return {
      replies: [{ body: "No problem — I won't order anything. Text me if you want to look again." }],
      actions: [pending.id],
    };
  }

  if (match === "show_more") {
    const nextOffset = (payload.offset || 0) + options.length;
    updateActionRun(pending.id, { status: "running", summary: `More ${payload.query} options` });
    setImmediate(() => {
      void presentOptions(
        pending.id,
        payload.query,
        payload.quantity || 1,
        nextOffset,
        from,
        payload
      );
    });
    return {
      replies: [{ body: `Pulling up a few more ${pluralize(payload.query)}…` }],
      actions: [pending.id],
    };
  }

  if (match === "refine") {
    let nextQuery = payload.query;
    const t = text.toLowerCase();
    if (/\bmetal|stainless|steel\b/.test(t)) nextQuery = `${payload.query} stainless steel metal`;
    else if (/\bsilicone\b/.test(t)) nextQuery = `${payload.query} silicone`;
    else if (/\bcheap|cheaper|budget\b/.test(t)) nextQuery = `cheap ${payload.query}`;
    else if (/\bwood|wooden\b/.test(t)) nextQuery = `${payload.query} wood`;
    else {
      const cleaned = text
        .replace(/^(how about|maybe|try|look for|find|show me|i want|instead)\s+/i, "")
        .replace(/\binstead\b/gi, "")
        .trim();
      if (cleaned.length > 1) nextQuery = cleaned.includes(payload.query)
        ? cleaned
        : `${cleaned} ${payload.query}`;
    }
    updateActionRun(pending.id, {
      status: "running",
      summary: `Searching ${nextQuery}`,
    });
    setImmediate(() => {
      void presentOptions(
        pending.id,
        nextQuery,
        payload.quantity || 1,
        0,
        from,
        payload
      );
    });
    return {
      replies: [{ body: `Got it — searching ${nextQuery}…` }],
      actions: [pending.id],
    };
  }

  if (match && typeof match === "object") {
    const memoryQuery = payload.baseQuery || payload.query;
    setImmediate(() => {
      void runAddToCart(
        pending.id,
        from,
        memoryQuery,
        payload.quantity || 1,
        match as ProductOption,
        options
      );
    });
    return {
      replies: [],
      actions: [pending.id],
    };
  }

  return {
    replies: [
      {
        body: "I wasn't sure which one you meant. Tap a product, reply 1/2/3, or say something like \"the cheap one\" or \"metal instead\".",
        quickReplies: choiceButtons(options, (payload.offset || 0) + options.length < (payload.total || 0)),
        cards: toCards(options),
      },
    ],
    actions: [pending.id],
  };
}

async function handleSamePurchase(
  pending: ActionRunRow,
  text: string,
  from: string
): Promise<AgentResult | null> {
  const payload = JSON.parse(pending.payload || "{}") as ShopPayload;
  let intent = heuristicIntent(text, "same_purchase");
  intent = intent ?? (await llmIntent(text, pending)) ?? { intent: "other" };

  if (intent.intent === "yes" && payload.prior) {
    const product: ProductOption = {
      id: "prior",
      title: payload.prior.product,
      price: payload.prior.price,
      priceValue: Number(String(payload.prior.price).replace(/[^0-9.]/g, "")) || 0,
      source: payload.prior.merchant,
      link: payload.prior.link,
      imageUrl: "",
      label: "Same as last time",
    };
    const memoryQuery = payload.baseQuery || payload.query;
    setImmediate(() => {
      void runAddToCart(pending.id, from, memoryQuery, payload.quantity || 1, product, []);
    });
    return { replies: [], actions: [pending.id] };
  }

  if (intent.intent === "change" || /show/i.test(text)) {
    updateActionRun(pending.id, { status: "cancelled" });
    const id = randomUUID();
    const q = payload.baseQuery || payload.query;
    createActionRun({
      id,
      kind: "product_choice",
      status: "running",
      summary: `Searching ${pluralize(q)}`,
      payload: { query: q, baseQuery: q, quantity: payload.quantity || 1, options: [], offset: 0 },
    });
    setImmediate(() => {
      void presentOptions(id, q, payload.quantity || 1, 0, from, {
        query: q,
        baseQuery: q,
        quantity: payload.quantity || 1,
        options: [],
        offset: 0,
      });
    });
    return {
      replies: [{ body: `Okay, looking up ${pluralize(q)}…` }],
      actions: [id],
    };
  }

  if (intent.intent === "no") {
    updateActionRun(pending.id, { status: "cancelled" });
    return {
      replies: [{ body: "Okay, I won't reorder that. Text me if you change your mind." }],
      actions: [pending.id],
    };
  }

  return null;
}

// ---------- doing the work ----------

async function executeSteps(action: ActionRunRow, payload: Payload): Promise<string[]> {
  updateActionRun(action.id, { status: "running" });
  const results: string[] = [];
  const detail: Record<string, unknown> = {};

  for (const s of payload.steps || []) {
    if (s.type === "order") {
      const order = await placeSupplierOrder({
        supplier: supplierName(s.supplier),
        productName: s.product || "Mozzarella",
        quantity: s.quantity || 0,
        unit: s.unit,
        sku: s.sku,
      });
      detail.order = order;
      if (s.inventory) {
        const item = (await listInventory()).find((i) => i.slug === s.inventory);
        const onHand = Math.round(((item?.estimate ?? 0) + (s.quantity ?? 0)) * 10) / 10;
        const today = todayISO();
        await editPage(s.inventory, {
          patch: { last_count: onHand, last_counted: today, last_ordered: today, snooze_until: "" },
          timeline: `Ordered ${s.quantity} ${s.unit} from ${supplierName(s.supplier)} (confirmation ${order.confirmationNumber}); ~${formatAmount(onHand)} ${s.unit} on hand once it lands`,
        });
      }
      results.push(
        `Ordered ${s.quantity} ${s.unit} of ${s.product?.toLowerCase()} from ${supplierName(s.supplier)} (confirmation ${order.confirmationNumber})`
      );
    } else if (s.type === "email") {
      const email = await sendEmail({ to: s.to || "", subject: s.subject || "", body: s.body || "" });
      detail.email = email;
      if (email.ok && s.day) {
        await appendTimeline(
          "contacts/bob-pepsi",
          `Emailed Bob asking to move the Pepsi delivery to the ${ordinal(s.day)}`
        );
      }
      results.push(
        email.ok
          ? s.day
            ? `Emailed Bob about moving Pepsi to the ${ordinal(s.day)}`
            : `Emailed ${s.to}`
          : `Email didn't go through: ${email.error}`
      );
    } else if (s.type === "remember" && s.fact) {
      await appendTimeline("company/tonys-pizzeria", s.fact);
      await appendTimeline(BEHAVIOR_SLUG, `Tony told me: ${s.fact}`);
      results.push(`Saved to memory: ${s.fact}`);
    }
    updateActionRun(action.id, { result: JSON.stringify({ ...detail, results }) });
  }

  await appendActionMemory(`${action.summary}\n${results.map((r) => `- ${r}`).join("\n")}`);
  updateActionRun(action.id, { status: "done", result: JSON.stringify({ ...detail, results }) });
  return results;
}

function propose(
  steps: Step[],
  said: string,
  phrase: (plan: string) => string,
  opts: { kind?: string; buttons?: string[]; extra?: Partial<Payload> } = {}
): AgentResult {
  cancelPendingActions();
  const id = randomUUID();
  createActionRun({
    id,
    kind: opts.kind ?? "bundle",
    status: "awaiting_confirmation",
    summary: capitalize(describeSteps(steps)),
    payload: { ...opts.extra, steps, said } satisfies Payload,
  });
  return {
    replies: [{ body: phrase(describeSteps(steps)), quickReplies: opts.buttons ?? CONFIRM_BUTTONS }],
    actions: [id],
  };
}

async function approve(pending: ActionRunRow, payload: Payload): Promise<AgentResult> {
  const results = await executeSteps(pending, payload);
  const ordered = new Set((payload.steps || []).map((s) => s.inventory).filter(Boolean));
  const nextChecks = (await listInventory())
    .filter((i) => ordered.has(i.slug) && i.next_checkup)
    .map((i) => `${i.name.toLowerCase()} ${describeDay(i.next_checkup)}`);
  const followUp = nextChecks.length ? `\nI'll check back on ${joinList(nextChecks)}.` : "";
  const replies: Reply[] = [{ body: `Done.\n${results.map((r) => `- ${r}`).join("\n")}${followUp}` }];
  const actions = [pending.id];

  const dev = await findDeviation(payload.steps || [], payload.said ?? "");
  if (dev) {
    const id = randomUUID();
    createActionRun({
      id,
      kind: "workflow_update",
      status: "awaiting_confirmation",
      summary: `Make ${dev.to} ${dev.unit} the default ${dev.label}?`,
      payload: { steps: [], deviation: dev } satisfies Payload,
    });
    actions.push(id);
    replies.push({
      body: `Your usual ${dev.label} is ${dev.from} ${dev.unit}. Want ${dev.to} ${dev.unit} to be the new normal?`,
      quickReplies: ROUTINE_BUTTONS,
    });
  }
  return { replies, actions };
}

async function revise(pending: ActionRunRow, payload: Payload, change: string): Promise<AgentResult> {
  const steps =
    (await llmRevise(payload.steps || [], change)) ?? (await heuristicRevise(payload.steps || [], change));

  if (JSON.stringify(steps) === JSON.stringify(payload.steps || [])) {
    updateActionRun(pending.id, { status: "awaiting_change_details" });
    return {
      replies: [
        {
          body: `I didn't quite catch what to change. Try something like "make it 30 lbs" or "skip the email".`,
        },
      ],
      actions: [pending.id],
    };
  }
  if (steps.length === 0) {
    updateActionRun(pending.id, { status: "cancelled" });
    return {
      replies: [{ body: "Okay, dropping all of it. Nothing was ordered or sent." }],
      actions: [pending.id],
    };
  }

  updateActionRun(pending.id, {
    status: "awaiting_confirmation",
    summary: capitalize(describeSteps(steps)),
    payload: JSON.stringify({ ...payload, steps, said: change } satisfies Payload),
  });
  return {
    replies: [
      { body: `Got it. I'll ${describeSteps(steps)}. Good to go?`, quickReplies: CONFIRM_BUTTONS },
    ],
    actions: [pending.id],
  };
}

async function handlePendingReply(
  pending: ActionRunRow,
  text: string,
  from: string
): Promise<AgentResult | null> {
  if (pending.kind === "product_choice" || pending.status === "awaiting_product_choice") {
    return handleProductChoice(pending, text, from);
  }
  if (pending.kind === "same_purchase") {
    return handleSamePurchase(pending, text, from);
  }
  if (pending.kind === "checkup") {
    const handled = await handleStockFeedback(pending, text);
    if (handled) return handled;
  }

  const payload = JSON.parse(pending.payload || "{}") as Payload;
  let intent = heuristicIntent(text, pending.kind);

  if (pending.status === "awaiting_change_details") {
    if (intent?.intent === "no") {
      updateActionRun(pending.id, { status: "awaiting_confirmation" });
      return {
        replies: [
          {
            body: `No worries, the plan stays as is: ${describeSteps(payload.steps || [])}. Good to go?`,
            quickReplies: CONFIRM_BUTTONS,
          },
        ],
        actions: [pending.id],
      };
    }
    if (intent?.intent !== "yes") intent = { intent: "change", details: text };
  }
  intent = intent ?? (await llmIntent(text, pending)) ?? { intent: "other" };

  if (pending.kind === "workflow_update") {
    const dev = payload.deviation;
    if (!dev || (intent.intent !== "yes" && intent.intent !== "no")) return null;
    updateActionRun(pending.id, {
      status: "done",
      result: JSON.stringify({
        results: [intent.intent === "yes" ? "Made default" : "Kept as one-off"],
      }),
    });
    const body = intent.intent === "yes" ? await applyRoutineChange(dev) : await recordOneOff(dev);
    return { replies: [{ body }], actions: [pending.id] };
  }

  switch (intent.intent) {
    case "yes":
      return approve(pending, payload);
    case "no":
      updateActionRun(pending.id, { status: "cancelled" });
      return {
        replies: [{ body: "No problem, I'll hold off. Text me whenever you want to pick it back up." }],
        actions: [pending.id],
      };
    case "change":
      if (!intent.details) {
        updateActionRun(pending.id, { status: "awaiting_change_details" });
        return { replies: [{ body: "Sure, what should be different?" }], actions: [pending.id] };
      }
      return revise(pending, payload, intent.details);
    default:
      return null;
  }
}

// ---------- estimated inventory & check-ups ----------

type StockFeedback = { kind: "count"; amount: number } | { kind: "out" } | { kind: "some" };

const ITEM_ALIASES: Record<string, string[]> = {
  "inventory/mozzarella": ["mozz", "cheese"],
  "inventory/pepsi-syrup": ["pepsi", "soda", "syrup"],
  "inventory/tomato-sauce": ["sauce", "tomato"],
  "inventory/olive-oil": ["oil", "evoo"],
};

function mentionedItems(text: string, items: InventoryItem[]): InventoryItem[] {
  const t = text.toLowerCase();
  return items.filter((i) =>
    [i.name.toLowerCase(), ...(ITEM_ALIASES[i.slug] ?? [])].some((a) => t.includes(a))
  );
}

function parseStockFeedback(text: string): StockFeedback | null {
  const t = text.toLowerCase();
  if (/\b(ran out|run out|out of|we'?re out|all out|none left|no more|all gone|nothing left)\b/.test(t)) {
    return { kind: "out" };
  }
  const amount =
    t.match(
      /(\d+(?:\.\d+)?)\s*(?:lbs?|pounds?|cans?|liters?|l|boxes?|bags?)?\s*(?:left|remaining|on hand|in the (?:back|walk-?in|fridge))/
    ) ||
    t.match(
      /\b(?:still have|still got|we have|i have|we got|i got|got|have|there'?s|counted)\s+(?:about |around |like |maybe |only |just |roughly |~)*(\d+(?:\.\d+)?)/
    );
  if (amount) return { kind: "count", amount: Number(amount[1]) };
  if (
    /\b(still have some|still got some|have some|got some|plenty|enough|not low|not out|not yet|still some|a good amount|we'?re (good|fine|ok|okay|set))\b/.test(t)
  ) {
    return { kind: "some" };
  }
  return null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Tony's correction is the only ground truth we get, so fold it into the usage estimate
 * (half old estimate, half what his count implies) and let the schedule re-derive itself.
 */
async function learnFromFeedback(item: InventoryItem, fb: StockFeedback, said: string): Promise<string> {
  const today = todayISO();
  const name = item.name.toLowerCase();
  const unit = item.unit;
  const oldUse = item.daily_use;
  const guess = `${formatAmount(item.estimate)} ${unit}`;
  const quote = said ? ` Tony said: "${said}"` : "";

  if (fb.kind === "some") {
    const newUse = Math.max(0.1, round1(oldUse * 0.85));
    const recheck = addDays(today, RECHECK_AFTER_DAYS);
    await editPage(item.slug, {
      patch: { daily_use: newUse, snooze_until: recheck },
      replace: [[`~${oldUse} ${unit}/day`, `~${newUse} ${unit}/day`]],
      timeline: `Tony still has some (I estimated ~${guess}). Usage estimate ${oldUse} → ${newUse} ${unit}/day; rechecking ${recheck}.`,
    });
    await appendTimeline(
      BEHAVIOR_SLUG,
      `Estimate correction: ${name} lasts longer than I thought. Usage ${oldUse} → ${newUse} ${unit}/day.${quote}`
    );
    return `Got it, I'll ease my ${name} estimate to ~${newUse} ${unit}/day and check back ${describeDay(recheck)}.`;
  }

  const amount = fb.kind === "out" ? 0 : fb.amount;
  const elapsed = daysBetween(item.last_counted, today);
  let newUse = oldUse;
  if (elapsed > 0) {
    const observed = Math.max(0, (item.last_count - amount) / elapsed);
    newUse = (oldUse + observed) / 2;
    // "Ran out" only tells us usage was at least this high
    if (fb.kind === "out") newUse = Math.max(newUse, oldUse * 1.15);
  }
  newUse = Math.max(0.1, round1(newUse));
  await editPage(item.slug, {
    patch: { last_count: amount, last_counted: today, daily_use: newUse, snooze_until: "" },
    replace: [[`~${oldUse} ${unit}/day`, `~${newUse} ${unit}/day`]],
    timeline: `Tony ${fb.kind === "out" ? "ran out" : `counted ${amount} ${unit}`} (I estimated ~${guess}). Usage estimate ${oldUse} → ${newUse} ${unit}/day.`,
  });
  if (newUse !== oldUse) {
    await appendTimeline(
      BEHAVIOR_SLUG,
      `Estimate correction: ${name} usage ${oldUse} → ${newUse} ${unit}/day after a real count (${amount} ${unit}, I guessed ~${guess}).${quote}`
    );
  }

  const logged = fb.kind === "out" ? `Noted you're out of ${name}` : `Thanks, logging ${formatAmount(amount)} ${unit} of ${name}`;
  if (newUse === oldUse) return `${logged}.`;
  const direction = newUse > oldUse ? "faster" : "slower";
  return `${logged}. You're going through it ${direction} than I thought (~${newUse} ${unit}/day, not ${oldUse}), so I've adjusted the schedule.`;
}

function estimateText(item: InventoryItem) {
  return item.estimate < 0.5 ? "probably out" : `~${formatAmount(item.estimate)} ${item.unit}`;
}

function checkupLines(items: InventoryItem[]): string[] {
  const lines: string[] = [];
  const low = items.filter((i) => i.low || i.checkup_reason === "projected_low");
  const rest = items.filter((i) => !low.includes(i));

  if (low.length === 1) {
    const i = low[0];
    const name = i.name.toLowerCase();
    const subject = /\s|s$/.test(name) ? `${capitalize(name)} is` : `${capitalize(name)}'s`;
    lines.push(
      i.estimate < 0.5 ? `${subject} probably out by now` : `${subject} probably low (${estimateText(i)} by my math)`
    );
  } else if (low.length > 1) {
    lines.push(
      `By my math you're getting low on ${joinList(low.map((i) => `${i.name.toLowerCase()} (${estimateText(i)})`))}`
    );
  }
  for (const i of rest) {
    const name = i.name.toLowerCase();
    lines.push(
      i.checkup_reason === "order_day"
        ? `It's about your usual ${name} order day, and by my math you've got ${estimateText(i)} left`
        : `Checking back on ${name} like I said (${estimateText(i)} by my math now)`
    );
  }
  return lines;
}

function nextUpSummary(inventory: InventoryItem[]): string {
  const upcoming = inventory
    .filter((i) => i.next_checkup)
    .sort((a, b) => a.next_checkup.localeCompare(b.next_checkup))[0];
  if (!upcoming) return "Nothing needs a check-up today.";
  const why =
    upcoming.checkup_reason === "order_day"
      ? "usual order day"
      : upcoming.checkup_reason === "recheck"
        ? "recheck"
        : "projected to run low";
  return `Nothing needs a check-up today. Next up: ${upcoming.name.toLowerCase()} ${describeDay(upcoming.next_checkup)} (${why}).`;
}

async function checkupOffer(items: InventoryItem[], greeting: string): Promise<AgentResult | null> {
  const workflows = await listWorkflows();
  const steps: Step[] = [];
  const orderable: InventoryItem[] = [];
  const headsUp: string[] = [];
  for (const item of items) {
    const wf = workflows.find((w) => w.fm.inventory === item.slug && w.action === "order");
    if (wf) {
      steps.push(orderStepFromWorkflow(wf));
      orderable.push(item);
    } else {
      headsUp.push(`Heads up: ${item.name.toLowerCase()} is getting low (${estimateText(item)})`);
    }
  }
  const lines = checkupLines(orderable);
  const asked = orderable.map((i) => i.slug);
  const lead = greeting ? `${greeting} ` : "";
  if (steps.length === 0) {
    return headsUp.length ? { replies: [{ body: `${lead}${headsUp.join(". ")}.` }], actions: [] } : null;
  }
  const tail = headsUp.length ? ` (${headsUp.join(". ")}.)` : "";
  return propose(steps, "", (plan) => `${lead}${lines.join(". ")}. Want me to ${plan}?${tail}`, {
    kind: "checkup",
    buttons: CHECKUP_BUTTONS,
    extra: { checkup: asked },
  });
}

async function handleStockFeedback(pending: ActionRunRow, text: string): Promise<AgentResult | null> {
  const fb = parseStockFeedback(text);
  if (!fb) return null;
  const payload = JSON.parse(pending.payload || "{}") as Payload;
  const inventory = await listInventory();
  const asked = inventory.filter((i) => payload.checkup?.includes(i.slug));
  const mentioned = mentionedItems(text, inventory);
  const named = mentioned.filter((i) => asked.includes(i));

  if (mentioned.length && named.length === 0) {
    const notes: string[] = [];
    for (const item of mentioned) notes.push(await learnFromFeedback(item, fb, text));
    return {
      replies: [
        {
          body: `${notes.join(" ")} Still want me to ${describeSteps(payload.steps || [])}?`,
          quickReplies: CHECKUP_BUTTONS,
        },
      ],
      actions: [pending.id],
    };
  }

  const targets = named.length ? named : asked;
  if (targets.length === 0) return null;

  const notes: string[] = [];
  for (const item of targets) notes.push(await learnFromFeedback(item, fb, text));

  const refreshed = await listInventory();
  const stillLow = new Set(
    refreshed.filter((i) => targets.some((t) => t.slug === i.slug) && i.low).map((i) => i.slug)
  );
  const steps = (payload.steps || []).filter(
    (s) => !s.inventory || !targets.some((t) => t.slug === s.inventory) || stillLow.has(s.inventory)
  );
  const remaining = (payload.checkup || []).filter(
    (slug) => !targets.some((t) => t.slug === slug) || stillLow.has(slug)
  );

  if (steps.length === 0) {
    updateActionRun(pending.id, {
      status: "done",
      summary: `Updated ${targets.map((t) => t.name.toLowerCase()).join(" & ")} estimate`,
      result: JSON.stringify({ results: notes }),
    });
    return { replies: [{ body: notes.join(" ") }], actions: [pending.id] };
  }

  updateActionRun(pending.id, {
    status: "awaiting_confirmation",
    summary: capitalize(describeSteps(steps)),
    payload: JSON.stringify({ ...payload, steps, checkup: remaining } satisfies Payload),
  });
  const underPar = targets.filter((t) => stillLow.has(t.slug));
  const why = underPar.length
    ? ` That's still at or under the low point for ${underPar.map((t) => t.name.toLowerCase()).join(" & ")}.`
    : "";
  return {
    replies: [
      {
        body: `${notes.join(" ")}${why} Want me to ${describeSteps(steps)}?`,
        quickReplies: underPar.length ? CONFIRM_BUTTONS : CHECKUP_BUTTONS,
      },
    ],
    actions: [pending.id],
  };
}

/** Unprompted "we've got 10 lbs of mozz left" outside of a check-up. */
async function handleUnpromptedCount(text: string): Promise<AgentResult | null> {
  const fb = parseStockFeedback(text);
  if (!fb) return null;
  const inventory = await listInventory();
  const items = mentionedItems(text, inventory);
  if (items.length !== 1) return null;
  const note = await learnFromFeedback(items[0], fb, text);
  const item = (await listInventory()).find((i) => i.slug === items[0].slug)!;
  const wf = item.low
    ? (await listWorkflows()).find((w) => w.fm.inventory === item.slug && w.action === "order")
    : undefined;
  if (wf) {
    return propose([orderStepFromWorkflow(wf)], text, (plan) => `${note} Want me to ${plan}?`, {
      kind: "checkup",
      extra: { checkup: [item.slug] },
    });
  }
  return {
    replies: [{ body: `${note} Next check-up on ${item.name.toLowerCase()}: ${describeDay(item.next_checkup)}.` }],
    actions: [],
  };
}

async function handleNewRequest(text: string, from: string): Promise<AgentResult> {
  const counted = await handleUnpromptedCount(text);
  if (counted) return counted;

  const llm = await llmPlan(text);
  const steps = llm ? llm.steps : await heuristicPlan(text);

  const shopStep = steps.find((s) => s.type === "shop");
  if (shopStep?.query && steps.every((s) => s.type === "shop" || s.type === "remember")) {
    // Handle remember alongside shop if present
    for (const s of steps.filter((x) => x.type === "remember")) {
      if (s.fact) {
        await appendTimeline("company/tonys-pizzeria", s.fact);
        await appendTimeline(BEHAVIOR_SLUG, `Tony told me: ${s.fact}`);
      }
    }
    return startShopFlow(from, shopStep.query, shopStep.quantity || 1);
  }

  if (steps.length === 0) {
    if (llm?.answer) return { replies: [{ body: llm.answer }], actions: [] };
    const inventory = await listInventory();
    const offer = await checkupOffer(
      inventory.filter((i) => i.due || i.low),
      ""
    );
    return (
      offer ?? {
        replies: [
          {
            body: `${nextUpSummary(inventory)} You can also text me things like "order a spatula" or "we've got 10 lbs of mozz left".`,
          },
        ],
        actions: [],
      }
    );
  }

  if (steps.every((s) => s.type === "remember")) {
    cancelPendingActions();
    const id = randomUUID();
    const action = createActionRun({
      id,
      kind: "remember",
      status: "running",
      summary: capitalize(describeSteps(steps)),
      payload: { steps, said: text } satisfies Payload,
    });
    await executeSteps(action, { steps, said: text });
    return {
      replies: [
        { body: `Noted. I'll remember that ${steps.map((s) => s.fact).join(", and ")}.` },
      ],
      actions: [id],
    };
  }

  // Mixed shop + workflow: do workflow confirm first; shop alone is preferred path above
  const nonShop = steps.filter((s) => s.type !== "shop");
  if (nonShop.length && shopStep) {
    return propose(nonShop, text, (plan) => `On it. I can ${plan}. (I'll handle the ${shopStep.query} search after.) Good to go?`);
  }

  return propose(steps, text, (plan) => `On it. I can ${plan}. Good to go?`);
}

export async function handleInboundSms(from: string, body: string): Promise<AgentResult> {
  const text = body.trim();
  const pending = getPendingAction();
  if (pending) {
    // Don't steal replies while a search/cart job is mid-flight
    if (pending.status === "running" && (pending.kind === "product_choice" || pending.kind === "same_purchase")) {
      return {
        replies: [{ body: "Still working on that — give me a few seconds." }],
        actions: [pending.id],
      };
    }
    const handled = await handlePendingReply(pending, text, from);
    if (handled) return handled;
    updateActionRun(pending.id, { status: "cancelled" });
  }
  return handleNewRequest(text, from);
}

/**
 * Texts Tony about every item whose check-up is due today (projected low or usual order day),
 * at most once per item per day. Quiet days don't send anything.
 */
export async function runDueCheckups(): Promise<{ text: string; sent: boolean; items: string[] }> {
  const today = todayISO();
  const inventory = await listInventory();
  const due = inventory.filter((i) => i.due && !wasCheckedOn(i.slug, today));
  if (due.length === 0) return { text: nextUpSummary(inventory), sent: false, items: [] };

  const offer = await checkupOffer(due, "Morning Tony!");
  for (const item of due) recordCheckup(item.slug, today, offer?.actions[0] ?? null);
  const reply = offer?.replies[0];
  if (!reply) return { text: nextUpSummary(inventory), sent: false, items: [] };

  await sendToOwner(getOwnerPhone(), reply.body, {
    quickReplies: reply.quickReplies,
    channel: "sms",
  });
  return { text: reply.body, sent: true, items: due.map((i) => i.name) };
}
