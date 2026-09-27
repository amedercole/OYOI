import cron from "node-cron";
import { runDueCheckups } from "./agent";

type GlobalSched = { __oyoiSchedulerStarted?: boolean };

export function startScheduler() {
  const g = globalThis as unknown as GlobalSched;
  if (g.__oyoiSchedulerStarted) return;
  g.__oyoiSchedulerStarted = true;

  // 8:00 AM local time daily: text Tony about any items whose check-up is due
  cron.schedule("0 8 * * *", async () => {
    try {
      const result = await runDueCheckups();
      console.log(`[scheduler] check-ups: ${result.sent ? result.items.join(", ") : "none due"}`);
    } catch (err) {
      console.error("[scheduler] check-ups failed", err);
    }
  });

  console.log("[scheduler] daily inventory check-up cron registered (0 8 * * *)");
}
