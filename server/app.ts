import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { createAccessChecker, type AccessOptions } from "./access.js";
import { bearerToken, safeEqual } from "./auth.js";
import { assistantNameFrom } from "./names.js";
import {
  ackOutbox,
  applyUserAction,
  closeItem,
  countOutbox,
  getItem,
  getMeta,
  listBoardItems,
  listUserEvents,
  listItemEvents,
  listItems,
  listOutbox,
  patchItem,
  reconcile,
  recordUserMessage,
  setMeta,
  upsertItems,
  type DB,
} from "./db.js";
import { HttpError } from "./errors.js";
import {
  parseAck,
  parseAction,
  parseClose,
  parseId,
  parseItemChanges,
  parseListFilters,
  parseMessage,
  parseSince,
  parseSync,
  parseUpsertBody,
} from "./validate.js";
import { deliverWebhook, type WebhookFetch } from "./webhook.js";

export type AppOptions = {
  db: DB;
  apiToken: string;
  webhookUrl?: string;
  webhookKey?: string;
  fetchImpl?: WebhookFetch;
  now?: () => Date;
  staticDir?: string;
  assistantName?: string;
  access?: AccessOptions;
};

async function readBody(c: { req: { text: () => Promise<string> } }): Promise<unknown> {
  const text = await c.req.text();
  if (text.length > 1_000_000) throw new HttpError(400, "Body is too large");
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(400, "Body must be JSON");
  }
}

export function createApp(opts: AppOptions): Hono {
  const clock = opts.now ?? (() => new Date());
  const fetchImpl = opts.fetchImpl ?? fetch;
  const webhookKey = opts.webhookKey ?? "";
  const assistantName = assistantNameFrom(opts.assistantName);
  const access = createAccessChecker(opts.access);
  const app = new Hono();

  app.use("*", async (c, next) => {
    const path = c.req.path;
    if (path === "/healthz" || path === "/api" || path.startsWith("/api/")) {
      await next();
      return;
    }
    const decision = await access.check(c);
    if (!decision.allow) {
      c.header("Cache-Control", "no-store");
      return c.html(decision.html, decision.status);
    }
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: "Internal error" }, 500);
  });

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.get("/hq/board", (c) => {
    const now = clock();
    return c.json({
      generated_at: now.toISOString(),
      assistant_name: assistantName,
      last_synced_at: getMeta(opts.db, "last_synced_at"),
      outbox_count: countOutbox(opts.db),
      items: listBoardItems(opts.db, now),
    });
  });

  app.get("/hq/items/:id", (c) => {
    const now = clock();
    const id = parseId(c.req.param("id"));
    reconcile(opts.db, now);
    const item = getItem(opts.db, id);
    if (!item) throw new HttpError(404, "Item not found");
    return c.json({ item, events: listItemEvents(opts.db, id) });
  });

  app.post("/hq/items/:id/act", async (c) => {
    const now = clock();
    const { item, webhook } = applyUserAction(opts.db, parseId(c.req.param("id")), parseAction(await readBody(c), now), now);
    const delivered = await deliverWebhook(opts.db, webhook, {
      url: opts.webhookUrl,
      key: webhookKey,
      fetchImpl,
      now,
    });
    return c.json({ ok: true, delivered, outbox_count: countOutbox(opts.db), item });
  });

  app.post("/hq/message", async (c) => {
    const now = clock();
    const webhook = recordUserMessage(opts.db, parseMessage(await readBody(c)), now);
    const delivered = await deliverWebhook(opts.db, webhook, {
      url: opts.webhookUrl,
      key: webhookKey,
      fetchImpl,
      now,
    });
    return c.json({ ok: true, delivered, outbox_count: countOutbox(opts.db) });
  });

  const api = new Hono();
  api.use("*", async (c, next) => {
    if (!opts.apiToken) return c.json({ error: "Unauthorized" }, 401);
    const presented = bearerToken(c.req.header("authorization"));
    if (!presented || !safeEqual(presented, opts.apiToken)) return c.json({ error: "Unauthorized" }, 401);
    await next();
  });

  api.post("/items/upsert", async (c) => {
    const now = clock();
    const items = upsertItems(opts.db, parseUpsertBody(await readBody(c)), now);
    return c.json({ ids: items.map((item) => item.id), items });
  });

  api.patch("/items/:id", async (c) => {
    const parsed = parseItemChanges(await readBody(c));
    if (parsed.present.size === 0) throw new HttpError(400, "No fields to update");
    const item = patchItem(opts.db, parseId(c.req.param("id")), parsed.changes, parsed.present, clock());
    return c.json({ item });
  });

  api.post("/items/:id/close", async (c) => {
    const body = parseClose(await readBody(c));
    const item = closeItem(opts.db, parseId(c.req.param("id")), body.status, body.note, clock());
    return c.json({ item });
  });

  api.get("/items", (c) => {
    const items = listItems(
      opts.db,
      parseListFilters({ status: c.req.query("status"), section: c.req.query("section") }),
      clock(),
    );
    return c.json({ items });
  });

  api.get("/events", (c) => c.json({ events: listUserEvents(opts.db, parseSince(c.req.query("since"))) }));

  api.post("/sync/complete", async (c) => {
    const at = parseSync(await readBody(c), clock());
    setMeta(opts.db, "last_synced_at", at);
    return c.json({ last_synced_at: at });
  });

  api.get("/outbox", (c) => c.json({ events: listOutbox(opts.db) }));

  api.post("/outbox/ack", async (c) => {
    const acked = ackOutbox(opts.db, parseAck(await readBody(c)), clock());
    return c.json({ acked });
  });

  app.route("/api", api);

  if (opts.staticDir) {
    const files = serveStatic({ root: opts.staticDir });
    app.use("*", async (c, next) => {
      const path = c.req.path;
      if (path.startsWith("/api") || path.startsWith("/hq") || path === "/healthz") return next();
      return files(c, next);
    });
  }

  app.notFound((c) => {
    const path = c.req.path;
    if (path.startsWith("/api") || path.startsWith("/hq")) return c.json({ error: "Not found" }, 404);
    return c.text("Not found", 404);
  });

  return app;
}
