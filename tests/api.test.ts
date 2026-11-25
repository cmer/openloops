import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app.js";
import { openDatabase, type DB } from "../server/db.js";
import type { WebhookFetch } from "../server/webhook.js";

const TOKEN = "test-token";
const DAY = 86_400_000;

let dir = "";
let db: DB;
const okFetch: WebhookFetch = async () => new Response(null, { status: 204 });

function makeApp(fetchImpl: WebhookFetch = okFetch, apiToken = TOKEN) {
  return createApp({
    db,
    apiToken,
    webhookUrl: "http://hooks.example/hook",
    webhookKey: "wk",
    fetchImpl,
    access: { remoteAddress: () => "127.0.0.1", log: () => {} },
  });
}

async function authed(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${TOKEN}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return makeApp().request(path, { ...init, headers });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "whq-"));
  db = openDatabase(join(dir, "test.db"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("auth", () => {
  it("serves healthz and the board without a token, and locks /api", async () => {
    const app = makeApp();
    expect((await app.request("/healthz")).status).toBe(200);
    expect(await (await app.request("/healthz")).json()).toEqual({ ok: true });
    const board = await app.request("http://localhost/hq/board");
    expect(board.status).toBe(200);
    expect(((await board.json()) as { assistant_name: string }).assistant_name).toBe("Assistant");

    expect((await app.request("/api/items")).status).toBe(401);
    expect((await app.request("/api/items", { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
    expect((await app.request("/api/outbox", { headers: { authorization: "Token test-token" } })).status).toBe(401);

    const ok = await app.request("/api/items", { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(ok.status).toBe(200);

    const unlocked = createApp({ db, apiToken: "", fetchImpl: okFetch });
    const rejected = await unlocked.request("/api/items", { headers: { authorization: "Bearer " } });
    expect(rejected.status).toBe(401);
  });
});

describe("upsert", () => {
  it("is idempotent on external_key for one item or an array", async () => {
    const first = await authed("/api/items/upsert", {
      method: "POST",
      body: JSON.stringify({
        external_key: "loop-1",
        section: "action",
        title: "First title",
        source: "chat",
      }),
    });
    expect(first.status).toBe(200);
    const created = (await first.json()) as { ids: number[]; items: { id: number; created: boolean }[] };
    expect(created.ids).toEqual([1]);
    expect(created.items[0]?.created).toBe(true);

    const second = await authed("/api/items/upsert", {
      method: "POST",
      body: JSON.stringify([
        { external_key: "loop-1", section: "action", title: "Second title", source: "chat" },
        {
          external_key: "loop-2",
          section: "decision",
          title: "Pick a color",
          options: [{ label: "Green", value: "green" }],
        },
      ]),
    });
    expect(second.status).toBe(200);
    const both = (await second.json()) as { ids: number[]; items: { id: number; created: boolean; external_key: string }[] };
    expect(both.items[0]).toMatchObject({ id: 1, created: false, external_key: "loop-1" });
    expect(both.items[1]?.created).toBe(true);

    const again = await authed("/api/items/upsert", {
      method: "POST",
      body: JSON.stringify({ external_key: "loop-1", section: "action", title: "Second title", source: "chat" }),
    });
    const same = (await again.json()) as { ids: number[] };
    expect(same.ids).toEqual([1]);

    const listed = (await (await authed("/api/items")).json()) as { items: { external_key: string; title: string }[] };
    const matches = listed.items.filter((item) => item.external_key === "loop-1");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.title).toBe("Second title");
  });

  it("rejects a bad batch without writing any of it", async () => {
    const res = await authed("/api/items/upsert", {
      method: "POST",
      body: JSON.stringify([
        { external_key: "keep-out", section: "action", title: "Should not land" },
        { external_key: "bad", section: "nope", title: "Bad" },
      ]),
    });
    expect(res.status).toBe(400);
    const listed = (await (await authed("/api/items")).json()) as { items: unknown[] };
    expect(listed.items).toHaveLength(0);
  });
});

describe("close and patch", () => {
  it("closes an item as done or dropped and updates fields", async () => {
    await authed("/api/items/upsert", {
      method: "POST",
      body: JSON.stringify({ external_key: "closeme", section: "action", title: "Close me" }),
    });

    const missing = await authed("/api/items/99/close", {
      method: "POST",
      body: JSON.stringify({ status: "done" }),
    });
    expect(missing.status).toBe(404);

    const bad = await authed("/api/items/1/close", {
      method: "POST",
      body: JSON.stringify({ status: "snoozed" }),
    });
    expect(bad.status).toBe(400);

    const closed = await authed("/api/items/1/close", {
      method: "POST",
      body: JSON.stringify({ status: "done", note: "Handled offline" }),
    });
    expect(closed.status).toBe(200);
    const done = (await closed.json()) as { item: { status: string; closed_at: string | null } };
    expect(done.item.status).toBe("done");
    expect(done.item.closed_at).toBeTruthy();

    const dropped = await authed("/api/items/1/close", {
      method: "POST",
      body: JSON.stringify({ status: "dropped" }),
    });
    expect(((await dropped.json()) as { item: { status: string } }).item.status).toBe("dropped");

    await authed("/api/items/upsert", {
      method: "POST",
      body: JSON.stringify({ external_key: "patchme", section: "action", title: "Patch me" }),
    });
    const patched = await authed("/api/items/2", {
      method: "PATCH",
      body: JSON.stringify({ who: "Northwind Supply", due_at: "2026-12-01T15:00:00.000Z", section: "waiting_on_others" }),
    });
    expect(patched.status).toBe(200);
    const body = (await patched.json()) as { item: { owner: string; due_at: string; section: string } };
    expect(body.item.owner).toBe("Northwind Supply");
    expect(body.item.due_at).toBe("2026-12-01T15:00:00.000Z");
    expect(body.item.section).toBe("waiting_on_others");
  });
});

describe("events", () => {
  it("lists the person's actions since a timestamp and leaves the assistant's out", async () => {
    const app = makeApp();
    await authed("/api/items/upsert", {
      method: "POST",
      body: JSON.stringify({
        external_key: "ask",
        section: "question_for_you",
        title: "Which code?",
      }),
    });
    await authed("/api/items/upsert", {
      method: "POST",
      body: JSON.stringify({
        external_key: "pick",
        section: "decision",
        title: "Pick one",
        options: [{ label: "Marten", value: "marten" }],
      }),
    });

    const reply = await app.request("/hq/items/1/act", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "reply", value: "Use SFO" }),
    });
    expect(reply.status).toBe(200);

    const choose = await app.request("/hq/items/2/act", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "choose", value: "marten" }),
    });
    expect(choose.status).toBe(200);
    const chosen = (await choose.json()) as { item: { status: string; choice: string } };
    expect(chosen.item.status).toBe("done");
    expect(chosen.item.choice).toBe("marten");

    await app.request("/hq/message", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Ping from the test" }),
    });

    const past = new Date(Date.now() - 60_000).toISOString();
    const all = (await (await authed(`/api/events?since=${encodeURIComponent(past)}`)).json()) as {
      events: { type: string; actor: string; item_id: number | null; payload: { value?: string }; created_at: string }[];
    };
    expect(all.events.map((event) => event.type)).toEqual(["reply", "choose", "message"]);
    expect(all.events.every((event) => event.actor === "user")).toBe(true);
    expect(all.events[0]?.payload.value).toBe("Use SFO");
    expect(all.events[2]?.item_id).toBeNull();

    const atReply = all.events[0]?.created_at ?? "";
    const afterReply = (await (await authed(`/api/events?since=${encodeURIComponent(atReply)}`)).json()) as {
      events: { type: string }[];
    };
    expect(afterReply.events.map((event) => event.type)).toEqual(["choose", "message"]);

    const future = new Date(Date.now() + 60_000).toISOString();
    const none = (await (await authed(`/api/events?since=${encodeURIComponent(future)}`)).json()) as { events: unknown[] };
    expect(none.events).toHaveLength(0);
  });
});

describe("outbox", () => {
  it("queues the webhook when delivery fails, once, and ack clears it", async () => {
    const fetchImpl = vi.fn<WebhookFetch>(async () => {
      throw new Error("connect ECONNREFUSED");
    });
    const app = makeApp(fetchImpl);
    await authed("/api/items/upsert", {
      method: "POST",
      body: JSON.stringify({ external_key: "done-me", section: "action", title: "Finish the sample" }),
    });

    const acted = await app.request("/hq/items/1/act", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "done" }),
    });
    expect(acted.status).toBe(200);
    const body = (await acted.json()) as { ok: boolean; delivered: boolean; outbox_count: number; item: { status: string } };
    expect(body.ok).toBe(true);
    expect(body.delivered).toBe(false);
    expect(body.outbox_count).toBe(1);
    expect(body.item.status).toBe("done");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("http://hooks.example/hook");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Authorization).toBe("Bearer wk");
    expect(headers["X-Automation-Key"]).toBe("wk");
    const payload = JSON.parse(String(init?.body)) as {
      type: string;
      item_id: number;
      external_key: string;
      title: string;
      value: string | null;
      at: string;
    };
    expect(payload.type).toBe("done");
    expect(payload.item_id).toBe(1);
    expect(payload.external_key).toBe("done-me");
    expect(payload.title).toBe("Finish the sample");
    expect(payload.value).toBeNull();
    expect(payload.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const queued = (await (await authed("/api/outbox")).json()) as { events: { id: number; payload: { type: string } }[] };
    expect(queued.events).toHaveLength(1);
    expect(queued.events[0]?.payload.type).toBe("done");

    const acked = await authed("/api/outbox/ack", {
      method: "POST",
      body: JSON.stringify({ ids: [queued.events[0]?.id] }),
    });
    expect(acked.status).toBe(200);
    expect(((await acked.json()) as { acked: number }).acked).toBe(1);
    const empty = (await (await authed("/api/outbox")).json()) as { events: unknown[] };
    expect(empty.events).toHaveLength(0);
  });

  it("does not queue a webhook that succeeds, and queues a non-2xx response", async () => {
    const success = makeApp(async () => new Response(null, { status: 204 }));
    await authed("/api/items/upsert", {
      method: "POST",
      body: JSON.stringify({ external_key: "ok", section: "action", title: "Ok" }),
    });
    const good = await success.request("/hq/message", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Hello there" }),
    });
    expect(((await good.json()) as { delivered: boolean }).delivered).toBe(true);
    expect(((await (await authed("/api/outbox")).json()) as { events: unknown[] }).events).toHaveLength(0);

    const failing = makeApp(async () => new Response("nope", { status: 500 }));
    const bad = await failing.request("/hq/message", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Again" }),
    });
    expect(((await bad.json()) as { delivered: boolean; outbox_count: number }).outbox_count).toBe(1);
  });
});

describe("move", () => {
  it("changes the section, keeps an explicit stall, records history, and queues a failed webhook", async () => {
    const fetchImpl = vi.fn<WebhookFetch>(async () => new Response(null, { status: 204 }));
    const app = makeApp(fetchImpl);
    await authed("/api/items/upsert", {
      method: "POST",
      body: JSON.stringify({ external_key: "movable", section: "action", title: "Move me" }),
    });

    const moved = await app.request("/hq/items/1/act", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "move", value: "waiting_on_others" }),
    });
    expect(moved.status).toBe(200);
    const body = (await moved.json()) as { delivered: boolean; item: { section: string; original_section: string | null } };
    expect(body.delivered).toBe(true);
    expect(body.item.section).toBe("waiting_on_others");
    expect(body.item.original_section).toBeNull();

    const init = fetchImpl.mock.calls[0]?.[1];
    const payload = JSON.parse(String(init?.body)) as { type: string; value: string; item_id: number; title: string };
    expect(payload).toMatchObject({ type: "move", value: "waiting_on_others", item_id: 1, title: "Move me" });

    const same = await app.request("/hq/items/1/act", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "move", value: "waiting_on_others" }),
    });
    expect(same.status).toBe(400);

    const doneColumn = await app.request("/hq/items/1/act", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "move", value: "done" }),
    });
    expect(doneColumn.status).toBe(400);

    const stalled = await app.request("/hq/items/1/act", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "move", value: "stalled" }),
    });
    expect(stalled.status).toBe(200);
    const stalledItem = (await stalled.json()) as { item: { section: string; original_section: string | null } };
    expect(stalledItem.item.section).toBe("stalled");
    expect(stalledItem.item.original_section).toBe("waiting_on_others");

    const detail = (await (await app.request("/hq/items/1")).json()) as {
      item: { id: number };
      events: { actor: string; type: string; payload: { value?: string; from?: string } | null }[];
    };
    expect(detail.item.id).toBe(1);
    expect(detail.events.map((event) => `${event.actor}:${event.type}`)).toEqual(["assistant:upsert", "user:move", "user:move"]);
    expect(detail.events[2]?.payload?.from).toBe("waiting_on_others");
    expect((await app.request("/hq/items/99")).status).toBe(404);

    await authed("/api/items/1/close", { method: "POST", body: JSON.stringify({ status: "done" }) });
    const closed = await app.request("/hq/items/1/act", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "move", value: "action" }),
    });
    expect(closed.status).toBe(400);

    const failing = makeApp(async () => {
      throw new Error("connect ECONNREFUSED");
    });
    await authed("/api/items/upsert", {
      method: "POST",
      body: JSON.stringify({ external_key: "movable-2", section: "action", title: "Move me too" }),
    });
    const queued = await failing.request("/hq/items/2/act", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "move", value: "question_for_you" }),
    });
    expect(queued.status).toBe(200);
    expect(((await queued.json()) as { delivered: boolean }).delivered).toBe(false);
    const outbox = (await (await authed("/api/outbox")).json()) as { events: { payload: { type: string; value: string } }[] };
    expect(outbox.events.at(-1)?.payload).toMatchObject({ type: "move", value: "question_for_you" });
  });
});

describe("aging and snooze", () => {
  it("stalls idle items, keeps the original section, and hides snoozes until due", async () => {
    const tenDays = new Date(Date.now() - 10 * DAY).toISOString();
    const recent = new Date(Date.now() - DAY).toISOString();
    const future = new Date(Date.now() + 3 * DAY).toISOString();
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const created = await authed("/api/items/upsert", {
      method: "POST",
      body: JSON.stringify([
        {
          external_key: "old",
          section: "action",
          title: "Old loop",
          created_at: tenDays,
          last_activity_at: tenDays,
        },
        {
          external_key: "asleep",
          section: "action",
          title: "Snoozed loop",
          status: "snoozed",
          snoozed_until: future,
          last_activity_at: recent,
        },
        {
          external_key: "woken",
          section: "question_for_you",
          title: "Due back",
          status: "snoozed",
          snoozed_until: past,
          last_activity_at: recent,
        },
      ]),
    });
    expect(created.status).toBe(200);

    const board = (await (await makeApp().request("/hq/board")).json()) as {
      items: { external_key: string; section: string; original_section: string | null; status: string; title: string }[];
    };
    const stalled = board.items.find((item) => item.external_key === "old");
    expect(stalled?.section).toBe("stalled");
    expect(stalled?.original_section).toBe("action");
    expect(board.items.find((item) => item.external_key === "asleep")).toBeUndefined();
    const woken = board.items.find((item) => item.external_key === "woken");
    expect(woken?.status).toBe("open");
    expect(woken?.section).toBe("question_for_you");

    const echo = await authed("/api/items/upsert", {
      method: "POST",
      body: JSON.stringify({ external_key: "old", section: "action", title: "Old loop" }),
    });
    expect(echo.status).toBe(200);
    const echoed = (await (await makeApp().request("/hq/board")).json()) as {
      items: { external_key: string; section: string; original_section: string | null }[];
    };
    const still = echoed.items.find((item) => item.external_key === "old");
    expect(still?.section).toBe("stalled");
    expect(still?.original_section).toBe("action");

    await authed("/api/items/upsert", {
      method: "POST",
      body: JSON.stringify({ external_key: "old", section: "action", title: "Old loop updated" }),
    });
    const moved = (await (await makeApp().request("/hq/board")).json()) as {
      items: { external_key: string; section: string; original_section: string | null; title: string }[];
    };
    const restored = moved.items.find((item) => item.external_key === "old");
    expect(restored?.title).toBe("Old loop updated");
    expect(restored?.section).toBe("action");
    expect(restored?.original_section).toBeNull();

    const stalledList = (await (await authed("/api/items?status=open&section=stalled")).json()) as { items: unknown[] };
    expect(stalledList.items).toHaveLength(0);
  });

  it("records the last sync time", async () => {
    const at = "2026-11-25T12:00:00.000Z";
    const res = await authed("/api/sync/complete", {
      method: "POST",
      body: JSON.stringify({ at }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { last_synced_at: string }).last_synced_at).toBe(at);
    const board = (await (await makeApp().request("/hq/board")).json()) as { last_synced_at: string };
    expect(board.last_synced_at).toBe(at);
  });
});
