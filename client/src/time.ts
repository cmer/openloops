import type { Item } from "../../shared/types";

const DAY = 86_400_000;
const WEEK = 7 * DAY;

export function ageDays(iso: string, now: number): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return 0;
  return Math.floor((now - ms) / DAY);
}

export function ageLabel(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatSynced(iso: string | null, now: number, assistantName: string): string {
  if (!iso) return `${assistantName} hasn't synced yet`;
  const delta = now - Date.parse(iso);
  if (Number.isNaN(delta)) return `${assistantName} hasn't synced yet`;
  const minutes = Math.round(delta / 60_000);
  if (minutes < 1) return `Last synced from ${assistantName} · just now`;
  if (minutes < 60) return `Last synced from ${assistantName} · ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `Last synced from ${assistantName} · ${hours}h ago`;
  const days = Math.round(hours / 24);
  return `Last synced from ${assistantName} · ${days}d ago`;
}

export function isVisible(item: Pick<Item, "status" | "closed_at">, now: number): boolean {
  if (item.status === "open") return true;
  if (item.status === "done" && item.closed_at) return now - Date.parse(item.closed_at) <= WEEK;
  return false;
}

function atNine(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(9, 0, 0, 0);
  return copy;
}

export function snoozeChoices(now = new Date()): { id: string; label: string; detail: string; at: string }[] {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const friday = new Date(now);
  friday.setDate(friday.getDate() + 1);
  while (friday.getDay() !== 5) friday.setDate(friday.getDate() + 1);
  const nextWeek = new Date(now);
  nextWeek.setDate(nextWeek.getDate() + 7);
  const detail = (date: Date) =>
    date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const choices = [
    { id: "tomorrow", label: "Tomorrow", date: atNine(tomorrow) },
    { id: "friday", label: "Friday", date: atNine(friday) },
    { id: "next-week", label: "Next week", date: atNine(nextWeek) },
  ];
  return choices.map((choice) => ({
    id: choice.id,
    label: choice.label,
    detail: detail(choice.date),
    at: choice.date.toISOString(),
  }));
}

export function tomorrowInputValue(now = new Date()): string {
  const date = new Date(now);
  date.setDate(date.getDate() + 1);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function customSnooze(dateValue: string, now = Date.now()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return null;
  const [year, month, day] = dateValue.split("-").map(Number);
  const local = new Date(year, (month ?? 1) - 1, day, 9, 0, 0, 0);
  if (Number.isNaN(local.getTime()) || local.getTime() <= now) return null;
  return local.toISOString();
}

export function compareOpen(a: Item, b: Item, now: number): number {
  const rank = (item: Item) => {
    if (!item.due_at) return Number.POSITIVE_INFINITY;
    return Date.parse(item.due_at);
  };
  const aDue = rank(a);
  const bDue = rank(b);
  const aOver = aDue < now ? 0 : 1;
  const bOver = bDue < now ? 0 : 1;
  if (aOver !== bOver) return aOver - bOver;
  if (aDue !== bDue) return aDue - bDue;
  const activity = Date.parse(a.last_activity_at) - Date.parse(b.last_activity_at);
  if (activity !== 0) return activity;
  return a.id - b.id;
}
