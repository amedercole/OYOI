import cron from "node-cron";
import { runMorningCheckin } from "./agent";

type GlobalSched = { __oyoiSchedulerStarted?: boolean };

export function startScheduler() {
  const g = globalThis as unknown as GlobalSched;
  if (g.__oyoiSchedulerStarted) return;
  g.__oyoiSchedulerStarted = true;

  // 8:00 AM local time daily
  cron.schedule("0 8 * * *", async () => {
    try {
      console.log("[scheduler] morning check-in");
      await runMorningCheckin();
    } catch (err) {
      console.error("[scheduler] check-in failed", err);
    }
  });

  console.log("[scheduler] morning check-in cron registered (0 8 * * *)");
}
