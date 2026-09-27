import { randomUUID } from "crypto";
import { generateText, tool, type LanguageModel } from "ai";
import { z } from "zod";
import {
  appendActionMemory,
  appendTimeline,
  editPage,
  getBehaviorLog,
  getPage,
  listInventory,
  listWorkflows,
  type Workflow,
} from "./brain";
import {
  cancelPendingActions,
  createActionRun,
  getPendingAction,
  updateActionRun,
  type ActionRunRow,
} from "./db";
import { sendEmail } from "./tools/email";
import { placeOrderViaBrowser } from "./tools/browser";
import { getOwnerPhone, sendSms } from "./sms";

export type Reply = { body: string; quickReplies?: string[] };
export type AgentResult = { replies: Reply[]; actions: string[] };

const CONFIRM_BUTTONS = ["Yes", "Change"];
const ROUTINE_BUTTONS = ["Make it the default", "Just this once"];
const BEHAVIOR_SLUG = "preferences/owner-behavior";
const PEPSI_WORKFLOW = "workflows/pepsi-delivery-change";

type Step = {
  type: "order" | "email" | "remember";
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

type Payload = { steps: Step[]; said?: string; deviation?: Deviation };
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
  return `remember that ${s.fact}`;
}

function describeSteps(steps: Step[]) {
  const parts = steps.map(describeStep);
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
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

// ---------- heuristic understanding (used when no LLM key is set) ----------

function parseQuantity(text: string): number | null {
  const m =
    text.match(/\b(\d+(?:\.\d+)?)\s*(?:lbs?|pounds?)\b/i) ||
    text.match(/\b(?:make it|get|order|need|want|bump (?:it )?(?:up )?to|up to|go with)\s+(\d+(?:\.\d+)?)\b/i);
  return m ? Number(m[1]) : null;
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
  return steps;
}

async function heuristicRevise(steps: Step[], text: string): Promise<Step[]> {
  let next = steps.map((s) => ({ ...s }));

  if (negatesCheese(text)) {
    next = next.filter((s) => s.type !== "order");
  } else {
    const qty = parseQuantity(text);
    if (qty) {
      const order = next.find((s) => s.type === "order");
      if (order) order.quantity = qty;
      else {
        const wf = await cheeseWorkflow();
        if (wf) next.push(orderStepFromWorkflow(wf, qty));
      }
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

  const changeSignal =
    /\b(change|instead|actually|different|make it|switch|also|but|only|except|rather|swap|more|less|fewer|bump|add|drop|remove)\b/.test(t) ||
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

// ---------- LLM understanding (when ANTHROPIC_API_KEY or OPENAI_API_KEY is set) ----------

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

const SYSTEM = `You are OYOI, the ops assistant for Tony's Pizzeria, working over SMS.
Always follow Tony's enshrined workflows and learned preferences from the brain context.
Only use these step types:
- order: a website order that follows an order workflow (give the workflow slug and quantity)
- email: the Pepsi delivery change email to Bob (give the new day of month)
- remember: a fact Tony wants kept in memory
Never invent suppliers or contacts.`;

const rawStepSchema = z.object({
  type: z.enum(["order", "email", "remember"]),
  workflow: z.string().optional().describe("Workflow slug for order steps, e.g. workflows/reorder-mozzarella"),
  quantity: z.number().optional(),
  day: z.number().optional().describe("New Pepsi delivery day of the month, for email steps"),
  fact: z.string().optional(),
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
    }
  }
  return steps;
}

function toRaw(steps: Step[]): RawStep[] {
  return steps.map((s) => ({ type: s.type, workflow: s.workflow, quantity: s.quantity, day: s.day, fact: s.fact }));
}

async function buildContext() {
  const [inventory, workflows, behavior] = await Promise.all([
    listInventory(),
    listWorkflows(),
    getBehaviorLog(),
  ]);
  return [
    "INVENTORY:",
    ...inventory.map((i) => `- ${i.name}: ${i.qty} ${i.unit} (par ${i.par})${i.low ? " LOW" : ""}`),
    "WORKFLOWS:",
    ...workflows.map(
      (w) =>
        `- ${w.slug}: when ${w.trigger}, ${w.action} via ${w.channel}` +
        (w.fm.default_qty ? ` (usual ${w.fm.default_qty} ${w.fm.unit})` : "")
    ),
    "TONY'S LEARNED PREFERENCES:",
    ...behavior.slice(0, 8).map((b) => `- ${b}`),
  ].join("\n");
}

async function llmIntent(text: string, pending: ActionRunRow): Promise<Intent | null> {
  const question =
    pending.kind === "workflow_update"
      ? `You asked Tony whether a change should become his new default routine: "${pending.summary}". yes = make it the default, no = just this once.`
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
    oneOffs >= 2 ? ` That's ${oneOffs} times now, so I'll bring it up again if it keeps happening.` : " I noted it in case it becomes a pattern.";
  return `Got it, keeping ${dev.from} ${dev.unit} as your usual.${pattern}`;
}

// ---------- doing the work ----------

async function executeSteps(action: ActionRunRow, payload: Payload): Promise<string[]> {
  updateActionRun(action.id, { status: "running" });
  const results: string[] = [];
  const detail: Record<string, unknown> = {};
  const baseUrl = process.env.PUBLIC_BASE_URL || "http://localhost:3000";

  for (const s of payload.steps) {
    if (s.type === "order") {
      const order = await placeOrderViaBrowser({
        storeUrl: `${baseUrl}/supplier`,
        productName: s.product || "Mozzarella",
        quantity: s.quantity || 0,
        sku: s.sku,
      });
      detail.order = order;
      if (order.liveUrl) updateActionRun(action.id, { browser_live_url: order.liveUrl });
      if (order.ok && s.inventory) {
        const inv = await getPage(s.inventory);
        const qty = Number(inv?.frontmatter.qty ?? 0) + (s.quantity ?? 0);
        await editPage(s.inventory, {
          patch: { qty },
          timeline: `Ordered ${s.quantity} ${s.unit} from ${supplierName(s.supplier)} (confirmation ${order.confirmationNumber})`,
        });
      }
      results.push(
        order.ok
          ? `Ordered ${s.quantity} ${s.unit} of ${s.product?.toLowerCase()} from ${supplierName(s.supplier)} (confirmation ${order.confirmationNumber})`
          : `Couldn't place the ${s.product?.toLowerCase()} order: ${order.error}`
      );
    } else if (s.type === "email") {
      const email = await sendEmail({ to: s.to || "", subject: s.subject || "", body: s.body || "" });
      detail.email = email;
      if (email.ok && s.day) {
        await appendTimeline("contacts/bob-pepsi", `Emailed Bob asking to move the Pepsi delivery to the ${ordinal(s.day)}`);
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

function propose(steps: Step[], said: string, phrase: (plan: string) => string): AgentResult {
  cancelPendingActions();
  const id = randomUUID();
  createActionRun({
    id,
    kind: "bundle",
    status: "awaiting_confirmation",
    summary: capitalize(describeSteps(steps)),
    payload: { steps, said } satisfies Payload,
  });
  return {
    replies: [{ body: phrase(describeSteps(steps)), quickReplies: CONFIRM_BUTTONS }],
    actions: [id],
  };
}

async function approve(pending: ActionRunRow, payload: Payload): Promise<AgentResult> {
  const results = await executeSteps(pending, payload);
  const replies: Reply[] = [{ body: `Done.\n${results.map((r) => `- ${r}`).join("\n")}` }];
  const actions = [pending.id];

  const dev = await findDeviation(payload.steps, payload.said ?? "");
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
  const steps = (await llmRevise(payload.steps, change)) ?? (await heuristicRevise(payload.steps, change));

  if (JSON.stringify(steps) === JSON.stringify(payload.steps)) {
    updateActionRun(pending.id, { status: "awaiting_change_details" });
    return {
      replies: [{ body: `I didn't quite catch what to change. Try something like "make it 30 lbs" or "skip the email".` }],
      actions: [pending.id],
    };
  }
  if (steps.length === 0) {
    updateActionRun(pending.id, { status: "cancelled" });
    return { replies: [{ body: "Okay, dropping all of it. Nothing was ordered or sent." }], actions: [pending.id] };
  }

  updateActionRun(pending.id, {
    status: "awaiting_confirmation",
    summary: capitalize(describeSteps(steps)),
    payload: JSON.stringify({ steps, said: change } satisfies Payload),
  });
  return {
    replies: [{ body: `Got it. I'll ${describeSteps(steps)}. Good to go?`, quickReplies: CONFIRM_BUTTONS }],
    actions: [pending.id],
  };
}

async function handlePendingReply(pending: ActionRunRow, text: string): Promise<AgentResult | null> {
  const payload = JSON.parse(pending.payload || "{}") as Payload;
  let intent = heuristicIntent(text, pending.kind);

  if (pending.status === "awaiting_change_details") {
    if (intent?.intent === "no") {
      updateActionRun(pending.id, { status: "awaiting_confirmation" });
      return {
        replies: [{ body: `No worries, the plan stays as is: ${describeSteps(payload.steps)}. Good to go?`, quickReplies: CONFIRM_BUTTONS }],
        actions: [pending.id],
      };
    }
    if (intent?.intent !== "yes") intent = { intent: "change", details: text };
  }
  intent = intent ?? (await llmIntent(text, pending)) ?? { intent: "other" };

  if (pending.kind === "workflow_update") {
    const dev = payload.deviation;
    if (!dev || (intent.intent !== "yes" && intent.intent !== "no")) return null;
    updateActionRun(pending.id, { status: "done", result: JSON.stringify({ results: [intent.intent === "yes" ? "Made default" : "Kept as one-off"] }) });
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

/** Offers the usual reorder for every low item that has an order workflow. */
async function lowStockOffer(phrase: (status: string, plan: string) => string): Promise<AgentResult | null> {
  const [inventory, workflows] = await Promise.all([listInventory(), listWorkflows()]);
  const low = inventory.filter((i) => i.low);
  const steps: Step[] = [];
  for (const item of low) {
    const wf = workflows.find((w) => w.fm.inventory === item.slug && w.action === "order");
    if (wf) steps.push(orderStepFromWorkflow(wf));
  }
  if (steps.length === 0) return null;
  const status = low.map((i) => `${i.name} is down to ${i.qty} ${i.unit} (par ${i.par})`).join(". ");
  return propose(steps, "", (plan) => phrase(status, plan));
}

async function handleNewRequest(text: string): Promise<AgentResult> {
  const llm = await llmPlan(text);
  const steps = llm ? llm.steps : await heuristicPlan(text);

  if (steps.length === 0) {
    if (llm?.answer) return { replies: [{ body: llm.answer }], actions: [] };
    const offer = await lowStockOffer((status, plan) => `${status}. Want me to ${plan}?`);
    return (
      offer ?? {
        replies: [{ body: "Everything's at or above par right now. Anything you want me to take care of?" }],
        actions: [],
      }
    );
  }

  // Remembering something is harmless, so do it right away instead of asking.
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
      replies: [{ body: `Noted. I'll remember that ${steps.map((s) => s.fact).join(", and ")}.` }],
      actions: [id],
    };
  }

  return propose(steps, text, (plan) => `On it. I can ${plan}. Good to go?`);
}

export async function handleInboundSms(_from: string, body: string): Promise<AgentResult> {
  const text = body.trim();
  const pending = getPendingAction();
  if (pending) {
    const handled = await handlePendingReply(pending, text);
    if (handled) return handled;
    updateActionRun(pending.id, { status: "cancelled" });
  }
  return handleNewRequest(text);
}

export async function runMorningCheckin(): Promise<{ text: string }> {
  const owner = getOwnerPhone();
  const offer = await lowStockOffer((status, plan) => `Morning Tony! ${status}. Want me to ${plan}?`);
  const reply = offer?.replies[0] ?? { body: "Morning Tony! Everything's at or above par today." };
  await sendSms(owner, reply.body, reply.quickReplies);
  return { text: reply.body };
}
