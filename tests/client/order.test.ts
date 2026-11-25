import { describe, expect, it } from "vitest";
import type { Item } from "../../shared/types";
import { applyOptimistic, boardOrder, groupBoard, nextOpenId } from "../../client/src/order";

const NOW = Date.parse("2026-11-25T15:00:00Z");
const day = (offset: number) => new Date(NOW + offset * 86_400_000).toISOString();

function item(id: number, patch: Partial<Item> = {}): Item {
  return {
    id,
    external_key: null,
    section: "action",
    original_section: null,
    title: `Item ${id}`,
    body: null,
    source: null,
    link: null,
    owner: null,
    options: null,
    choice: null,
    last_reply: null,
    due_at: null,
    snoozed_until: null,
    created_at: day(-3),
    updated_at: day(-3),
    last_activity_at: day(-3),
    closed_at: null,
    status: "open",
    ...patch,
  };
}

describe("groupBoard", () => {
  it("sorts open items overdue first, then soonest due, then undated", () => {
    const groups = groupBoard(
      [item(1), item(2, { due_at: day(3) }), item(3, { due_at: day(-1) }), item(4, { due_at: day(1) })],
      NOW,
    );
    expect(groups.action.map((entry) => entry.id)).toEqual([3, 4, 2, 1]);
  });

  it("breaks ties by last activity, then id", () => {
    const groups = groupBoard(
      [item(5, { last_activity_at: day(-1) }), item(6, { last_activity_at: day(-2) }), item(2, { last_activity_at: day(-1) })],
      NOW,
    );
    expect(groups.action.map((entry) => entry.id)).toEqual([6, 2, 5]);
  });

  it("puts done items in Recently done, newest closed first, and drops other statuses", () => {
    const groups = groupBoard(
      [
        item(1, { status: "done", closed_at: day(-2) }),
        item(2, { status: "done", closed_at: day(-1) }),
        item(3, { status: "snoozed" }),
        item(4, { status: "dropped" }),
      ],
      NOW,
    );
    expect(groups.done.map((entry) => entry.id)).toEqual([2, 1]);
    expect(groups.action).toEqual([]);
  });
});

describe("boardOrder", () => {
  const groups = groupBoard(
    [item(1, { section: "decision" }), item(2), item(3, { section: "stalled" }), item(4, { status: "done", closed_at: day(-1) })],
    NOW,
  );

  it("walks every section in fixed order for Everything", () => {
    expect(boardOrder(groups).map((entry) => entry.id)).toEqual([1, 2, 3, 4]);
  });

  it("narrows to the filtered section", () => {
    expect(boardOrder(groups, "stalled").map((entry) => entry.id)).toEqual([3]);
  });
});

describe("nextOpenId", () => {
  const order = [item(1), item(2), item(3)];

  it("moves to the next open card and wraps", () => {
    const after = [item(1), item(2), { ...item(3), status: "done" as const }];
    expect(nextOpenId(order, 2, after)).toBe(1);
    expect(nextOpenId(order, 1, after)).toBe(2);
  });

  it("returns null when nothing in the order is still open", () => {
    const filtered = [item(7, { section: "stalled" })];
    const after = [{ ...filtered[0]!, status: "done" as const }, item(1)];
    expect(nextOpenId(filtered, 7, after)).toBeNull();
  });

  it("starts from the top when the card has left the order", () => {
    expect(nextOpenId(order, 99, order)).toBe(1);
  });
});

describe("applyOptimistic", () => {
  it("restores the original section on a reply to a stalled item", () => {
    const stalled = item(1, { section: "stalled", original_section: "decision" });
    const [next] = applyOptimistic([stalled], stalled, "reply", "On it", day(0), NOW);
    expect(next?.section).toBe("decision");
    expect(next?.original_section).toBeNull();
    expect(next?.status).toBe("open");
  });

  it("keeps original_section when moving into Stalled and clears it otherwise", () => {
    const open = item(1, { section: "action" });
    const [stalled] = applyOptimistic([open], open, "move", "stalled", day(0), NOW);
    expect(stalled?.original_section).toBe("action");
    const [moved] = applyOptimistic([stalled!], stalled!, "move", "decision", day(0), NOW);
    expect(moved?.original_section).toBeNull();
  });

  it("hides snoozed and dropped items, and marks choose as done", () => {
    const open = item(1, { options: [{ label: "Yes", value: "yes" }] });
    expect(applyOptimistic([open], open, "snooze", day(1), day(0), NOW)).toEqual([]);
    expect(applyOptimistic([open], open, "drop", undefined, day(0), NOW)).toEqual([]);
    const [chosen] = applyOptimistic([open], open, "choose", "yes", day(0), NOW);
    expect(chosen).toMatchObject({ status: "done", choice: "yes" });
  });
});
