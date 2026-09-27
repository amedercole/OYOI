import { randomUUID } from "crypto";
import {
  appendActionMemory,
  getPage,
  listInventory,
  listWorkflows,
  searchBrain,
  updateFrontmatter,
} from "./brain";
import {
  createActionRun,
  getPendingConfirmation,
  updateActionRun,
  type ActionRunRow,
} from "./db";
import { sendEmail } from "./tools/email";
import { placeOrderViaBrowser } from "./tools/browser";
import { getOwnerPhone, sendSms } from "./sms";

type AgentResult = {
  reply: string;
  actions: string[];
};

function isYes(text: string) {
  // Only treat short confirmation replies as YES — not "Yes order cheese..."
  return /^(yes|y|yeah|yep|confirm|do it|go ahead)[.!\s]*$/i.test(text.trim());
}

async function executeConfirmedAction(action: ActionRunRow): Promise<string> {
  updateActionRun(action.id, { status: "running" });
  const payload = JSON.parse(action.payload || "{}") as {
    steps?: Array<{
      type: "email" | "order" | "inventory_update" | "remember";
      to?: string;
      subject?: string;
      body?: string;
      product?: string;
      quantity?: number;
      sku?: string;
      slug?: string;
      qty?: number;
      note?: string;
      fact?: string;
    }>;
  };

  const results: string[] = [];
  const baseUrl = process.env.PUBLIC_BASE_URL || "http://localhost:3000";

  for (const step of payload.steps || []) {
    if (step.type === "email") {
      const emailResult = await sendEmail({
        to: step.to || "bob.pepsi.rep@example.com",
        subject: step.subject || "Delivery schedule update",
        body: step.body || "",
      });
      results.push(
        emailResult.ok
          ? `Email sent to ${emailResult.preview.to}${emailResult.mocked ? " (mocked)" : ""}`
          : `Email failed: ${emailResult.error}`
      );
      updateActionRun(action.id, {
        result: JSON.stringify({ email: emailResult, results }),
      });
    } else if (step.type === "order") {
      const orderResult = await placeOrderViaBrowser({
        storeUrl: `${baseUrl}/supplier`,
        productName: step.product || "Mozzarella",
        quantity: step.quantity || 20,
        sku: step.sku,
      });
      if (orderResult.liveUrl) {
        updateActionRun(action.id, { browser_live_url: orderResult.liveUrl });
      }
      results.push(
        orderResult.ok
          ? `Ordered ${step.quantity} ${step.product} — confirmation ${orderResult.confirmationNumber}${orderResult.mocked ? " (mocked browser)" : ""}`
          : `Order failed: ${orderResult.error}`
      );
      updateActionRun(action.id, {
        result: JSON.stringify({ order: orderResult, results }),
      });
    } else if (step.type === "inventory_update" && step.slug) {
      await updateFrontmatter(
        step.slug,
        { qty: step.qty ?? 0 },
        step.note || `Inventory updated to ${step.qty}`
      );
      results.push(`Updated ${step.slug} qty → ${step.qty}`);
    } else if (step.type === "remember" && step.fact) {
      const company = await getPage("company/tonys-pizzeria");
      if (company) {
        const date = new Date().toISOString().slice(0, 10);
        const next = company.content.includes("## Timeline")
          ? company.content.replace("## Timeline", `## Timeline\n- ${date}: ${step.fact}`)
          : `${company.content.trim()}\n\n## Timeline\n- ${date}: ${step.fact}\n`;
        const { putPage } = await import("./brain");
        await putPage("company/tonys-pizzeria", next);
      }
      results.push(`Remembered: ${step.fact}`);
    }
  }

  await appendActionMemory(`${action.summary}\n${results.join("\n")}`);
  updateActionRun(action.id, {
    status: "done",
    result: JSON.stringify({ results }),
  });
  return results.join("\n");
}

function buildHeuristicPlan(text: string) {
  const lower = text.toLowerCase();
  const steps: Array<Record<string, unknown>> = [];
  const summaryParts: string[] = [];

  const wantsCheese =
    /cheese|mozzarella|order/.test(lower) && !/don't|dont|do not/.test(lower);
  const wantsPepsiChange =
    /pepsi|bob/.test(lower) && (/5th|fifth|deliver|delivery|instead/.test(lower) || /tell bob/.test(lower));
  const rememberMatch = text.match(/remember\s+(.+)/i);

  if (wantsCheese) {
    steps.push({
      type: "order",
      product: "Mozzarella",
      quantity: 20,
      sku: "MOZ-20",
    });
    steps.push({
      type: "inventory_update",
      slug: "inventory/mozzarella",
      qty: 23,
      note: "Received 20 lbs mozzarella from Company B website order",
    });
    summaryParts.push("Order 20 lbs mozzarella from Company B (~$90)");
  }

  if (wantsPepsiChange) {
    const dayMatch = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\b/i);
    const day = dayMatch?.[1] || "5";
    steps.push({
      type: "email",
      to: process.env.DEMO_EMAIL_TO || "bob.pepsi.rep@example.com",
      subject: "Tony's Pizzeria — change Pepsi delivery to the " + day + "th",
      body: `Hi Bob,\n\nPlease change our standing Pepsi BIB delivery from the 15th to the ${day}th of each month.\n\nThanks,\nTony's Pizzeria (via OYOI agent)\n`,
    });
    summaryParts.push(`Email Bob to move Pepsi delivery to the ${day}th`);
  }

  if (rememberMatch) {
    steps.push({ type: "remember", fact: rememberMatch[1].trim() });
    summaryParts.push(`Remember: ${rememberMatch[1].trim()}`);
  }

  return { steps, summary: summaryParts.join("; ") };
}

async function llmPlan(text: string, context: string): Promise<{ reply: string; steps: Array<Record<string, unknown>>; summary: string } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const { generateText, tool } = await import("ai");
    const { z } = await import("zod");

    let model;
    if (process.env.ANTHROPIC_API_KEY) {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      model = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })("claude-sonnet-4-20250514");
    } else {
      const { createOpenAI } = await import("@ai-sdk/openai");
      model = createOpenAI({ apiKey: process.env.OPENAI_API_KEY })("gpt-4o-mini");
    }

    const planTool = tool({
      description: "Propose concrete actions for the restaurant owner to confirm",
      inputSchema: z.object({
        reply: z.string(),
        summary: z.string(),
        steps: z.array(
          z.object({
            type: z.enum(["email", "order", "inventory_update", "remember"]),
            to: z.string().optional(),
            subject: z.string().optional(),
            body: z.string().optional(),
            product: z.string().optional(),
            quantity: z.number().optional(),
            sku: z.string().optional(),
            slug: z.string().optional(),
            qty: z.number().optional(),
            note: z.string().optional(),
            fact: z.string().optional(),
          })
        ),
      }),
      execute: async (input) => input,
    });

    const result = await generateText({
      model,
      tools: { propose_plan: planTool },
      toolChoice: "required",
      system: `You are OYOI, an inventory ops agent for Tony's Pizzeria.
Brain-first: use the provided company context and workflows.
When the owner wants work done, propose concrete steps (email / website order / inventory update / remember).
Keep SMS replies under 320 characters. Ask them to reply YES to confirm before acting.
Never invent suppliers — use Company B for web orders and Bob for Pepsi email.`,
      prompt: `Owner SMS: """${text}"""\n\nBrain context:\n${context}\n\nCall propose_plan.`,
    });

    const call = result.toolCalls?.[0];
    if (!call || call.toolName !== "propose_plan") return null;
    const input = ("input" in call ? call.input : undefined) as {
      reply: string;
      summary: string;
      steps: Array<Record<string, unknown>>;
    };
    return input;
  } catch (err) {
    console.warn("[agent] LLM plan failed, using heuristics", err);
    return null;
  }
}

export async function handleInboundSms(from: string, body: string): Promise<AgentResult> {
  const text = body.trim();
  const actions: string[] = [];

  // Confirmation path
  if (isYes(text)) {
    const pending = getPendingConfirmation();
    if (!pending) {
      return { reply: "Nothing pending to confirm. Text me what you need.", actions };
    }
    const resultText = await executeConfirmedAction(pending);
    actions.push(pending.id);
    return {
      reply: `Done.\n${resultText}`.slice(0, 1400),
      actions,
    };
  }

  const [inventory, workflows, companyHits] = await Promise.all([
    listInventory(),
    listWorkflows(),
    searchBrain("company tony pepsi mozzarella"),
  ]);

  const context = [
    "INVENTORY:",
    ...inventory.map((i) => `- ${i.name}: ${i.qty} ${i.unit} (par ${i.par})${i.low ? " LOW" : ""} supplier=${i.supplier}`),
    "WORKFLOWS:",
    ...workflows.map((w) => `- ${w.title}: when ${w.trigger} → ${w.action} via ${w.channel}`),
    "CONTEXT SNIPPETS:",
    ...companyHits.slice(0, 4).map((p) => `## ${p.slug}\n${p.content.slice(0, 400)}`),
  ].join("\n");

  const llm = await llmPlan(text, context);
  const plan = llm ?? (() => {
    const h = buildHeuristicPlan(text);
    return {
      reply: h.steps.length
        ? `Got it. Plan: ${h.summary}. Reply YES to confirm.`
        : `I can help with inventory, reorders, and supplier emails. Low stock: ${inventory.filter((i) => i.low).map((i) => i.name).join(", ") || "none"}.`,
      summary: h.summary,
      steps: h.steps,
    };
  })();

  if (plan.steps.length === 0) {
    return { reply: plan.reply, actions };
  }

  // Pure remember without confirmation if that's the only step
  if (plan.steps.length === 1 && plan.steps[0].type === "remember") {
    const id = randomUUID();
    createActionRun({
      id,
      kind: "remember",
      status: "awaiting_confirmation",
      summary: plan.summary,
      payload: { steps: plan.steps },
    });
    // auto-execute remembers after soft confirm in reply
    const pending = getPendingConfirmation();
    if (pending) {
      // leave awaiting — still ask YES for consistency in demo
    }
    return {
      reply: plan.reply.includes("YES") ? plan.reply : `${plan.reply} Reply YES to save it.`,
      actions: [id],
    };
  }

  const id = randomUUID();
  createActionRun({
    id,
    kind: "bundle",
    status: "awaiting_confirmation",
    summary: plan.summary || "Pending actions",
    payload: { steps: plan.steps },
  });
  actions.push(id);

  return {
    reply: plan.reply.includes("YES") ? plan.reply : `${plan.reply} Reply YES to confirm.`,
    actions,
  };
}

export async function runMorningCheckin(): Promise<{ text: string; sent: boolean }> {
  const inventory = await listInventory();
  const low = inventory.filter((i) => i.low);
  if (low.length === 0) {
    const text = "Morning check-in: all ingredients are at or above par. You're good.";
    const owner = getOwnerPhone();
    if (owner) await sendSms(owner, text);
    return { text, sent: Boolean(owner) };
  }

  const lines = low.map((i) => `${i.name} ${i.qty}/${i.par} ${i.unit}`);
  const text = `Morning check-in: low stock — ${lines.join("; ")}. Want me to reorder? Reply with what to do.`;
  const owner = getOwnerPhone();
  if (owner) await sendSms(owner, text);
  else console.log("[checkin:mock]", text);
  return { text, sent: Boolean(owner) };
}
