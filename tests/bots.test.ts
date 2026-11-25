import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { handleFrom, normalizeBots } from "../server/bots.js";
import { openDatabase, type DB } from "../server/db.js";
import type { WebhookFetch } from "../server/webhook.js";

const TOKEN = "test-token";
let dir = "";
let db: DB;
let calls: { url: string; body: Record<string, unknown> }[] = [];

function makeApp() {
  const fetchImpl: WebhookFetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    return new Response(null, { status: 204 });
  };
  return createApp({
    db,
    apiToken: TOKEN,
    webhookUrl: "http://hooks.example/walter",
    webhookKey: "wk",
    assistantName: "Walter",
    fetchImpl,
    access: { remoteAddress: () => "127.0.0.1", log: () => {} },
  });
}

const api = (app: ReturnType<typeof makeApp>, path: string, init: RequestInit = {}) =>
  app.request(path, { ...init, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" } });
const message = (app: ReturnType<typeof makeApp>, body: unknown) =>
  app.request("http://localhost/hq/message", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const publish = (app: ReturnType<typeof makeApp>, bots: unknown) => api(app, "/api/bots", { method: "PUT", body: JSON.stringify({ bots }) });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bots-"));
  db = openDatabase(join(dir, "test.db"));
  calls = [];
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("handles", () => {
  it("lowercases names and turns spaces and punctuation into underscores", () => {
    expect(handleFrom("Email Bot")).toBe("email_bot");
    expect(handleFrom("  Réna's  Helper! ")).toBe("renas_helper");
    expect(handleFrom("Bot 2.0")).toBe("bot_2_0");
    expect(handleFrom("???")).toBe("");
  });

  it("keeps handles unique and reserves the assistant's", () => {
    const { bots, skipped } = normalizeBots(
      [
        { name: "Email Bot", handle: null, description: null },
        { name: "email bot", handle: null, description: null },
        { name: "Walter", handle: null, description: null },
      ],
      "walter",
    );
    expect(bots.map((bot) => bot.handle)).toEqual(["email_bot", "email_bot_2"]);
    expect(skipped).toEqual(["Walter"]);
  });
});

describe("bots API", () => {
  it("starts with only the assistant", async () => {
    const res = await makeApp().request("http://localhost/hq/bots");
    expect(await res.json()).toEqual({ bots: [{ handle: "walter", name: "Walter", description: null, primary: true }] });
  });

  it("lets the assistant replace the whole list, and the board sees it", async () => {
    const app = makeApp();
    expect((await app.request("/api/bots", { method: "PUT", body: "{}" })).status).toBe(401);
    const first = await publish(app, [
      { name: "Email Bot", description: "Drafts replies" },
      { name: "Calendar", handle: "cal" },
    ]);
    expect(first.status).toBe(200);
    expect(((await first.json()) as { bots: { handle: string }[] }).bots.map((bot) => bot.handle)).toEqual(["walter", "email_bot", "cal"]);

    await publish(app, [{ name: "Mail Helper", handle: "email_bot" }]);
    const board = (await (await app.request("http://localhost/hq/bots")).json()) as { bots: { handle: string; name: string }[] };
    expect(board.bots).toEqual([
      { handle: "walter", name: "Walter", description: null, primary: true },
      { handle: "email_bot", name: "Mail Helper", description: null, primary: false },
    ]);
    expect(((await (await api(app, "/api/bots")).json()) as { bots: unknown[] }).bots).toHaveLength(2);
  });

  it("rejects bad lists", async () => {
    const app = makeApp();
    expect((await publish(app, "nope")).status).toBe(400);
    expect((await publish(app, [{ description: "no name" }])).status).toBe(400);
    expect((await publish(app, [{ name: "x", handle: "Bad Handle" }])).status).toBe(400);
    expect((await publish(app, [{ name: "a", handle: "dup" }, { name: "b", handle: "dup" }])).status).toBe(400);
    expect((await publish(app, [{ name: "!!!" }])).status).toBe(400);
  });
});

describe("messages", () => {
  it("sends everything to the assistant's webhook, with `to` for another bot", async () => {
    const app = makeApp();
    await publish(app, [{ name: "Email Bot" }]);
    await message(app, { text: "plain" });
    await message(app, { text: "draft it", to: "email_bot" });
    await message(app, { text: "@Email_Bot reply to Sam" });
    await message(app, { text: "@walter hi" });
    expect(calls.map((call) => [call.url, call.body.value, call.body.to ?? null, call.body.to_name ?? null])).toEqual([
      ["http://hooks.example/walter", "plain", null, null],
      ["http://hooks.example/walter", "draft it", "email_bot", "Email Bot"],
      ["http://hooks.example/walter", "reply to Sam", "email_bot", "Email Bot"],
      ["http://hooks.example/walter", "hi", null, null],
    ]);
  });

  it("leaves an untagged @word alone, and rejects an unknown `to`", async () => {
    const app = makeApp();
    await message(app, { text: "@jane is running late" });
    expect(calls[0]?.body).toMatchObject({ value: "@jane is running late" });
    expect(calls[0]?.body.to).toBeUndefined();
    const bad = await message(app, { text: "hi", to: "nobody" });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "No bot called @nobody" });
  });
});
