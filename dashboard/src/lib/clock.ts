import fs from "fs";
import path from "path";

const CLOCK_FILE = path.join(process.cwd(), "data", "clock.json");
const DAY_MS = 86_400_000;

function readOffset(): number {
  try {
    return Number(JSON.parse(fs.readFileSync(CLOCK_FILE, "utf8")).offsetDays) || 0;
  } catch {
    return 0;
  }
}

function writeOffset(offsetDays: number) {
  fs.mkdirSync(path.dirname(CLOCK_FILE), { recursive: true });
  fs.writeFileSync(CLOCK_FILE, JSON.stringify({ offsetDays }));
}

function toUtcDays(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

function fromUtcDays(days: number): string {
  return new Date(days * DAY_MS).toISOString().slice(0, 10);
}

function realToday(): string {
  const now = new Date();
  return fromUtcDays(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY_MS);
}

/** Demo-aware "today" as YYYY-MM-DD. Fast-forwarding shifts this without touching the system clock. */
export function todayISO(): string {
  return addDays(realToday(), readOffset());
}

export function addDays(iso: string, days: number): string {
  return fromUtcDays(toUtcDays(iso) + days);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return toUtcDays(toIso) - toUtcDays(fromIso);
}

export function getClock() {
  return { today: todayISO(), offsetDays: readOffset() };
}

export function advanceClock(days = 1) {
  writeOffset(readOffset() + days);
  return getClock();
}

export function resetClock() {
  fs.rmSync(CLOCK_FILE, { force: true });
}

/** "today", "tomorrow", or a weekday like "Thursday" (with the date if it's over a week out). */
export function describeDay(iso: string): string {
  const diff = daysBetween(todayISO(), iso);
  if (diff <= 0) return "today";
  if (diff === 1) return "tomorrow";
  const date = new Date(`${iso}T12:00:00Z`);
  const weekday = date.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  if (diff < 7) return weekday;
  return `${weekday} ${date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
}
