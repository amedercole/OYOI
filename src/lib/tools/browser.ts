const API = "https://api.browser-use.com/api/v2";
const TIMEOUT_MS = 3 * 60 * 1000;
const POLL_MS = 3000;

export type BrowserTaskResult = {
  ok: boolean;
  mocked?: boolean;
  taskId?: string;
  sessionId?: string;
  liveUrl?: string | null;
  output?: string;
  confirmationNumber?: string;
  cartUrl?: string | null;
  error?: string;
  steps?: string[];
};

type RunOptions = {
  task: string;
  startUrl?: string;
  maxSteps?: number;
  onLiveUrl?: (url: string) => void;
  structuredHint?: string;
};

function apiKey() {
  return process.env.BROWSER_USE_API_KEY || "";
}

function headers(key: string) {
  return {
    "X-Browser-Use-API-Key": key,
    "Content-Type": "application/json",
  };
}

async function getLiveUrl(key: string, sessionId: string): Promise<string | null> {
  try {
    const res = await fetch(`${API}/sessions/${sessionId}`, { headers: headers(key) });
    if (!res.ok) return null;
    const data = (await res.json()) as { liveUrl?: string | null };
    return data.liveUrl || null;
  } catch {
    return null;
  }
}

async function getTask(key: string, taskId: string) {
  const res = await fetch(`${API}/tasks/${taskId}`, { headers: headers(key) });
  if (!res.ok) return null;
  return (await res.json()) as {
    status?: string;
    output?: string;
    isSuccess?: boolean;
    error?: string;
  };
}

/**
 * Shared Browser Use Cloud v2 runner. Captures liveUrl early so the dashboard
 * can show the virtual browser while the task is still running.
 */
export async function runBrowserTask(opts: RunOptions): Promise<BrowserTaskResult> {
  const key = apiKey();
  if (!key) {
    return { ok: false, mocked: true, error: "BROWSER_USE_API_KEY not set", liveUrl: null };
  }

  try {
    const createRes = await fetch(`${API}/tasks`, {
      method: "POST",
      headers: headers(key),
      body: JSON.stringify({
        task: opts.task,
        startUrl: opts.startUrl,
        maxSteps: opts.maxSteps ?? 25,
        flashMode: true,
      }),
    });

    if (!createRes.ok) {
      const text = await createRes.text();
      return { ok: false, error: `Browser Use error ${createRes.status}: ${text}` };
    }

    const created = (await createRes.json()) as { id?: string; sessionId?: string };
    const taskId = created.id;
    const sessionId = created.sessionId;
    if (!taskId) return { ok: false, error: "No task id returned" };

    let liveUrl: string | null = null;
    const started = Date.now();

    while (Date.now() - started < TIMEOUT_MS) {
      if (sessionId && !liveUrl) {
        liveUrl = await getLiveUrl(key, sessionId);
        if (liveUrl) opts.onLiveUrl?.(liveUrl);
      }

      const status = await getTask(key, taskId);
      if (!status) break;

      const s = (status.status || "").toLowerCase();
      if (s === "finished" || s === "stopped" || s === "completed") {
        return {
          ok: status.isSuccess !== false,
          taskId,
          sessionId,
          liveUrl,
          output: status.output || "",
          steps: [status.output || "Browser task completed"],
          error: status.isSuccess === false ? status.error || status.output : undefined,
        };
      }
      if (s === "failed") {
        return {
          ok: false,
          taskId,
          sessionId,
          liveUrl,
          error: status.error || status.output || "Task failed",
        };
      }

      await new Promise((r) => setTimeout(r, POLL_MS));
    }

    return {
      ok: false,
      taskId,
      sessionId,
      liveUrl,
      error: "Browser task timed out after 3 minutes",
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export type ProductForCart = {
  title: string;
  price: string;
  source: string;
  link: string;
};

/**
 * Opens a real product page in a virtual browser, adds to cart, and stops before payment.
 */
export async function addToCart(
  product: ProductForCart,
  quantity = 1,
  onLiveUrl?: (url: string) => void
): Promise<BrowserTaskResult> {
  const task = [
    `You are shopping for a restaurant. Open this product page: ${product.link}`,
    `Product: "${product.title}" from ${product.source} (${product.price}).`,
    `Set quantity to ${quantity} if there is a quantity selector.`,
    `Add the item to the cart / bag.`,
    `Do NOT checkout. Do NOT enter payment, shipping, or account credentials.`,
    `If a login wall or captcha blocks you, stop and report that.`,
    `When the item is in the cart, return JSON only:`,
    `{"ok":true,"cartUrl":"<cart page url>","item":"${product.title}","price":"${product.price}","merchant":"${product.source}"}`,
    `If you cannot add it, return {"ok":false,"error":"<reason>","productUrl":"${product.link}"}`,
  ].join(" ");

  if (!apiKey()) {
    console.log("[browser:mock] add to cart", product.title);
    return {
      ok: true,
      mocked: true,
      taskId: `mock_cart_${Date.now()}`,
      liveUrl: null,
      cartUrl: product.link,
      output: JSON.stringify({
        ok: true,
        cartUrl: product.link,
        item: product.title,
        price: product.price,
        merchant: product.source,
        mocked: true,
      }),
      steps: [`Opened ${product.link}`, `Added ${product.title} x${quantity} to cart (mocked)`],
    };
  }

  const result = await runBrowserTask({
    task,
    startUrl: product.link,
    maxSteps: 30,
    onLiveUrl,
  });

  let cartUrl: string | null = product.link;
  try {
    const jsonMatch = (result.output || "").match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as {
        ok?: boolean;
        cartUrl?: string;
        error?: string;
        productUrl?: string;
      };
      if (parsed.ok === false) {
        return {
          ...result,
          ok: false,
          cartUrl: parsed.productUrl || product.link,
          error: parsed.error || result.error || "Could not add to cart",
        };
      }
      cartUrl = parsed.cartUrl || product.link;
    }
  } catch {
    /* keep product link as fallback */
  }

  if (!result.ok) {
    return { ...result, cartUrl: product.link };
  }

  return { ...result, cartUrl };
}
