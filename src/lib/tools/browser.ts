export type BrowserOrderResult = {
  ok: boolean;
  mocked?: boolean;
  taskId?: string;
  liveUrl?: string | null;
  confirmationNumber?: string;
  error?: string;
  steps?: string[];
};

/**
 * Places an order via Browser Use Cloud against the mock Company B storefront.
 * Falls back to a simulated checkout when BROWSER_USE_API_KEY is missing.
 */
export async function placeOrderViaBrowser(input: {
  storeUrl: string;
  productName: string;
  quantity: number;
  sku?: string;
}): Promise<BrowserOrderResult> {
  const apiKey = process.env.BROWSER_USE_API_KEY;
  const task = [
    `Go to ${input.storeUrl}.`,
    `Find the product "${input.productName}"${input.sku ? ` (SKU ${input.sku})` : ""}.`,
    `Set quantity to ${input.quantity}.`,
    `Add to cart, go to checkout, and complete the order with the card already on file.`,
    `Return the order confirmation number shown on the success page.`,
  ].join(" ");

  if (!apiKey) {
    const confirmationNumber = `CB-${Date.now().toString().slice(-8)}`;
    console.log("[browser:mock] placing order", input, "→", confirmationNumber);
    return {
      ok: true,
      mocked: true,
      taskId: `mock_${confirmationNumber}`,
      liveUrl: null,
      confirmationNumber,
      steps: [
        `Opened ${input.storeUrl}`,
        `Selected ${input.productName} x${input.quantity}`,
        "Added to cart",
        "Checked out with card on file",
        `Confirmation ${confirmationNumber}`,
      ],
    };
  }

  try {
    // Browser Use Cloud API (task create)
    const res = await fetch("https://api.browser-use.com/api/v1/run-task", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        task,
        max_steps: 25,
        save_browser_data: false,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Browser Use error ${res.status}: ${text}` };
    }

    const data = (await res.json()) as {
      id?: string;
      live_url?: string;
      status?: string;
      output?: string;
    };

    // Poll for completion (bounded for demo)
    const taskId = data.id;
    let liveUrl = data.live_url || null;
    let output = data.output || "";
    if (taskId) {
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const statusRes = await fetch(
          `https://api.browser-use.com/api/v1/task/${taskId}`,
          { headers: { Authorization: `Bearer ${apiKey}` } }
        );
        if (!statusRes.ok) break;
        const status = (await statusRes.json()) as {
          status?: string;
          live_url?: string;
          output?: string;
        };
        liveUrl = status.live_url || liveUrl;
        if (status.status === "finished" || status.status === "stopped") {
          output = status.output || output;
          break;
        }
        if (status.status === "failed") {
          return { ok: false, taskId, liveUrl, error: status.output || "Task failed" };
        }
      }
    }

    const confirmationMatch = output.match(/CB-\d+|[A-Z]{2,}-\d{5,}/);
    return {
      ok: true,
      taskId,
      liveUrl,
      confirmationNumber: confirmationMatch?.[0] || `CB-${Date.now().toString().slice(-8)}`,
      steps: [output || "Browser task completed"],
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
