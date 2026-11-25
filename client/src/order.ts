import type { Item, Section } from "../../shared/types";
import type { ActionType } from "./api";
import { BOARD_SECTIONS, type SectionFilter } from "./sections";
import { compareOpen, isVisible } from "./time";

export type Groups = Record<Section, Item[]>;

/** Items in one section, in display order. Done is newest-closed first. */
export function itemsFor(items: Item[], section: Section, now: number): Item[] {
  if (section === "done") {
    return items
      .filter((item) => item.status === "done")
      .sort((a, b) => Date.parse(b.closed_at ?? "") - Date.parse(a.closed_at ?? ""));
  }
  return items.filter((item) => item.status === "open" && item.section === section).sort((a, b) => compareOpen(a, b, now));
}

export function groupBoard(items: Item[], now: number): Groups {
  return Object.fromEntries(BOARD_SECTIONS.map((section) => [section.id, itemsFor(items, section.id, now)])) as Groups;
}

/** The order Prev/Next, j/k and auto-advance walk. A section filter narrows it to that section. */
export function boardOrder(groups: Groups, filter: SectionFilter = "all"): Item[] {
  return BOARD_SECTIONS.filter((section) => filter === "all" || section.id === filter).flatMap((section) => groups[section.id]);
}

/** Next still-open card after `currentId` in `order`, wrapping. Null when none is left. */
export function nextOpenId(order: Item[], currentId: number, items: Item[]): number | null {
  const byId = new Map(items.map((item) => [item.id, item]));
  const ids = order.map((item) => item.id);
  const start = ids.indexOf(currentId);
  // A card that has left the order starts the search from the top.
  const origin = start < 0 ? -1 : start;
  for (let step = 1; step <= ids.length; step += 1) {
    const id = ids[(origin + step) % ids.length];
    if (id === undefined) continue;
    const candidate = byId.get(id);
    if (candidate?.status !== "open") continue;
    if (id === currentId) return currentId;
    return id;
  }
  return null;
}

export function applyOptimistic(
  items: Item[],
  item: Item,
  type: ActionType,
  value: string | undefined,
  nowIso: string,
  now = Date.now(),
): Item[] {
  const next: Item = { ...item, updated_at: nowIso, last_activity_at: nowIso };
  if (type === "done") {
    next.status = "done";
    next.closed_at = nowIso;
  } else if (type === "drop") {
    next.status = "dropped";
    next.closed_at = nowIso;
  } else if (type === "snooze") {
    next.status = "snoozed";
    next.snoozed_until = value ?? null;
  } else if (type === "reply") {
    next.last_reply = value ?? null;
    if (next.section === "stalled" && next.original_section) {
      next.section = next.original_section;
      next.original_section = null;
    }
  } else if (type === "move" && value && value !== "done") {
    next.section = value as Section;
    next.original_section = value === "stalled" ? (item.section === "stalled" ? item.original_section : item.section) : null;
  } else {
    next.choice = value ?? null;
    next.status = "done";
    next.closed_at = nowIso;
  }
  const rest = items.filter((entry) => entry.id !== item.id);
  return isVisible(next, now) ? [...rest, next] : rest;
}
