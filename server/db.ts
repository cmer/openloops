import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { Item, ItemStatus, Section } from "../shared/types.js";
import type { Bot } from "./bots.js";
import { HttpError } from "./errors.js";
import type { ItemChanges, ParsedAction } from "./validate.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type DB = Database.Database;

type ItemRow = {
  id: number;
  external_key: string | null;
  section: string;
  original_section: string | null;
  title: string;
  body: string | null;
  source: string | null;
  link: string | null;
  owner: string | null;
  options_json: string | null;
  choice: string | null;
  last_reply: string | null;
  due_at: string | null;
  snoozed_until: string | null;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
  closed_at: string | null;
  status: string;
};

export type WebhookBody = {
  type: "done" | "snooze" | "drop" | "reply" | "choose" | "move" | "message";
  item_id: number | null;
  external_key: string | null;
  title: string | null;
  value: string | null;
  at: string;
  /** Message webhooks to another bot: its handle and name. Absent for messages to the assistant. */
  to?: string;
  to_name?: string;
};

export type StoredEvent = {
  id: number;
  item_id: number | null;
  actor: string;
  type: string;
  payload: Record<string, unknown> | null;
  created_at: string;
};

export type OutboxRow = {
  id: number;
  created_at: string;
  payload: WebhookBody;
};

export function openDatabase(path: string): DB {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      external_key TEXT UNIQUE,
      section TEXT NOT NULL,
      original_section TEXT,
      title TEXT NOT NULL,
      body TEXT,
      source TEXT,
      link TEXT,
      owner TEXT,
      options_json TEXT,
      choice TEXT,
      last_reply TEXT,
      due_at TEXT,
      snoozed_until TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_activity_at TEXT NOT NULL,
      closed_at TEXT,
      status TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER,
      actor TEXT NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (item_id) REFERENCES items(id)
    );
    CREATE TABLE IF NOT EXISTS outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      acked_at TEXT
    );
    CREATE TABLE IF NOT EXISTS bots (
      handle TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      position INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
    CREATE INDEX IF NOT EXISTS idx_events_actor_created ON events(actor, created_at);
    CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox(acked_at);
  `);
  return db;
}

function mapItem(row: ItemRow): Item {
  let options: Item["options"] = null;
  if (row.options_json) {
    try {
      const parsed: unknown = JSON.parse(row.options_json);
      options = Array.isArray(parsed) ? (parsed as Item["options"]) : null;
    } catch {
      options = null;
    }
  }
  return {
    id: row.id,
    external_key: row.external_key,
    section: row.section as Section,
    original_section: (row.original_section as Section | null) ?? null,
    title: row.title,
    body: row.body,
    source: row.source,
    link: row.link,
    owner: row.owner,
    options,
    choice: row.choice,
    last_reply: row.last_reply,
    due_at: row.due_at,
    snoozed_until: row.snoozed_until,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_activity_at: row.last_activity_at,
    closed_at: row.closed_at,
    status: row.status as ItemStatus,
  };
}

function snapshot(item: Item): string {
  return JSON.stringify({
    external_key: item.external_key,
    section: item.section,
    original_section: item.original_section,
    title: item.title,
    body: item.body,
    source: item.source,
    link: item.link,
    owner: item.owner,
    options: item.options,
    choice: item.choice,
    last_reply: item.last_reply,
    due_at: item.due_at,
    snoozed_until: item.snoozed_until,
    status: item.status,
    closed_at: item.closed_at,
  });
}

export function getItem(db: DB, id: number): Item | null {
  const row = db.prepare(`SELECT * FROM items WHERE id = ?`).get(id) as ItemRow | undefined;
  return row ? mapItem(row) : null;
}

let lastEventMs = 0;

function uniqueTimestamp(iso: string): string {
  let ms = Date.parse(iso);
  if (Number.isNaN(ms)) ms = Date.now();
  if (ms <= lastEventMs) ms = lastEventMs + 1;
  lastEventMs = ms;
  return new Date(ms).toISOString();
}

function insertEvent(
  db: DB,
  event: {
    item_id: number | null;
    actor: string;
    type: string;
    payload: unknown;
    created_at: string;
  },
): void {
  db.prepare(
    `INSERT INTO events (item_id, actor, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(
    event.item_id,
    event.actor,
    event.type,
    event.payload == null ? null : JSON.stringify(event.payload),
    uniqueTimestamp(event.created_at),
  );
}

function writeUpdate(db: DB, item: Item): void {
  db.prepare(
    `UPDATE items SET
      external_key = ?, section = ?, original_section = ?, title = ?, body = ?, source = ?, link = ?, owner = ?,
      options_json = ?, choice = ?, last_reply = ?, due_at = ?, snoozed_until = ?,
      created_at = ?, updated_at = ?, last_activity_at = ?, closed_at = ?, status = ?
     WHERE id = ?`,
  ).run(
    item.external_key,
    item.section,
    item.original_section,
    item.title,
    item.body,
    item.source,
    item.link,
    item.owner,
    item.options ? JSON.stringify(item.options) : null,
    item.choice,
    item.last_reply,
    item.due_at,
    item.snoozed_until,
    item.created_at,
    item.updated_at,
    item.last_activity_at,
    item.closed_at,
    item.status,
    item.id,
  );
}

function materialize(
  base: Item,
  changes: ItemChanges,
  present: Set<string>,
  nowIso: string,
  isCreate: boolean,
  ignoreEchoedSection: boolean,
): Item {
  const keys = new Set(present);
  if (
    ignoreEchoedSection &&
    base.section === "stalled" &&
    base.original_section &&
    keys.has("section") &&
    changes.section === base.original_section
  ) {
    // A sync often re-sends the pre-stall section on an idempotent upsert.
    keys.delete("section");
  }

  const next: Item = { ...base };
  if (keys.has("external_key")) next.external_key = changes.external_key ?? null;
  if (keys.has("section") && changes.section) next.section = changes.section;
  if (keys.has("original_section")) next.original_section = changes.original_section ?? null;
  if (keys.has("title") && changes.title) next.title = changes.title;
  if (keys.has("body")) next.body = changes.body ?? null;
  if (keys.has("source")) next.source = changes.source ?? null;
  if (keys.has("link")) next.link = changes.link ?? null;
  if (keys.has("owner")) next.owner = changes.owner ?? null;
  if (keys.has("options")) next.options = changes.options ?? null;
  if (keys.has("choice")) next.choice = changes.choice ?? null;
  if (keys.has("last_reply")) next.last_reply = changes.last_reply ?? null;
  if (keys.has("due_at")) next.due_at = changes.due_at ?? null;
  if (keys.has("snoozed_until")) next.snoozed_until = changes.snoozed_until ?? null;
  if (keys.has("status") && changes.status) next.status = changes.status;
  if (keys.has("closed_at")) next.closed_at = changes.closed_at ?? null;
  if (keys.has("created_at") && changes.created_at) next.created_at = changes.created_at;

  if (keys.has("section") && !keys.has("original_section") && next.section !== "stalled") {
    next.original_section = null;
  }

  if (!keys.has("status") && isCreate) {
    next.status = next.section === "done" ? "done" : "open";
  }

  if ((next.status === "done" || next.status === "dropped") && !keys.has("closed_at") && !next.closed_at) {
    next.closed_at = nowIso;
  }
  if ((next.status === "open" || next.status === "snoozed") && keys.has("status") && !keys.has("closed_at")) {
    next.closed_at = null;
  }
  if (next.status === "snoozed" && !next.snoozed_until) {
    throw new HttpError(400, "snoozed_until is required when status is snoozed");
  }
  if (!next.title.trim()) throw new HttpError(400, "title is required");
  if (!next.section) throw new HttpError(400, "section is required");

  const contentChanged = snapshot(next) !== snapshot(base);
  if (keys.has("last_activity_at") && changes.last_activity_at) {
    next.last_activity_at = changes.last_activity_at;
  } else if (contentChanged) {
    next.last_activity_at = nowIso;
  }

  if (keys.has("updated_at") && changes.updated_at) {
    next.updated_at = changes.updated_at;
  } else if (isCreate || contentChanged || next.last_activity_at !== base.last_activity_at) {
    next.updated_at = nowIso;
  }

  return next;
}

function isUniqueError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "SQLITE_CONSTRAINT_UNIQUE";
}

function persistUpdate(
  db: DB,
  existing: Item,
  changes: ItemChanges,
  present: Set<string>,
  now: Date,
  eventType: string,
  ignoreEchoedSection: boolean,
): Item {
  const nowIso = now.toISOString();
  const next = materialize(existing, changes, present, nowIso, false, ignoreEchoedSection);
  const unchanged =
    snapshot(next) === snapshot(existing) &&
    next.last_activity_at === existing.last_activity_at &&
    next.created_at === existing.created_at &&
    next.updated_at === existing.updated_at;
  if (unchanged) return existing;
  try {
    writeUpdate(db, next);
  } catch (err) {
    if (isUniqueError(err)) throw new HttpError(409, "external_key already exists");
    throw err;
  }
  if (snapshot(next) !== snapshot(existing)) {
    insertEvent(db, {
      item_id: existing.id,
      actor: "assistant",
      type: eventType,
      payload: {
        title: next.title,
        section: next.section,
        status: next.status,
        external_key: next.external_key,
      },
      created_at: nowIso,
    });
  }
  return next;
}

export function upsertItems(
  db: DB,
  inputs: { changes: ItemChanges; present: Set<string> }[],
  now: Date,
): { id: number; external_key: string | null; created: boolean }[] {
  const results: { id: number; external_key: string | null; created: boolean }[] = [];
  const insert = db.prepare(
    `INSERT INTO items (
      external_key, section, original_section, title, body, source, link, owner,
      options_json, choice, last_reply, due_at, snoozed_until,
      created_at, updated_at, last_activity_at, closed_at, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const find = db.prepare(`SELECT * FROM items WHERE external_key = ?`);

  const tx = db.transaction(() => {
    for (const input of inputs) {
      const key = input.present.has("external_key") ? (input.changes.external_key ?? null) : undefined;
      const existingRow = key ? (find.get(key) as ItemRow | undefined) : undefined;
      if (existingRow) {
        const saved = persistUpdate(db, mapItem(existingRow), input.changes, input.present, now, "upsert", true);
        results.push({ id: saved.id, external_key: saved.external_key, created: false });
        continue;
      }
      if (!input.present.has("section")) throw new HttpError(400, "section is required");
      if (!input.present.has("title")) throw new HttpError(400, "title is required");
      const nowIso = now.toISOString();
      const blank: Item = {
        id: 0,
        external_key: null,
        section: "action",
        original_section: null,
        title: "",
        body: null,
        source: null,
        link: null,
        owner: null,
        options: null,
        choice: null,
        last_reply: null,
        due_at: null,
        snoozed_until: null,
        created_at: nowIso,
        updated_at: nowIso,
        last_activity_at: nowIso,
        closed_at: null,
        status: "open",
      };
      const next = materialize(blank, input.changes, input.present, nowIso, true, false);
      let id: number;
      try {
        const info = insert.run(
          next.external_key,
          next.section,
          next.original_section,
          next.title,
          next.body,
          next.source,
          next.link,
          next.owner,
          next.options ? JSON.stringify(next.options) : null,
          next.choice,
          next.last_reply,
          next.due_at,
          next.snoozed_until,
          next.created_at,
          next.updated_at,
          next.last_activity_at,
          next.closed_at,
          next.status,
        );
        id = Number(info.lastInsertRowid);
      } catch (err) {
        if (isUniqueError(err)) throw new HttpError(409, "external_key already exists");
        throw err;
      }
      insertEvent(db, {
        item_id: id,
        actor: "assistant",
        type: "upsert",
        payload: { created: true, title: next.title, section: next.section, external_key: next.external_key },
        created_at: nowIso,
      });
      results.push({ id, external_key: next.external_key, created: true });
    }
    reconcile(db, now);
  });
  tx();
  return results;
}

export function patchItem(db: DB, id: number, changes: ItemChanges, present: Set<string>, now: Date): Item {
  const existing = getItem(db, id);
  if (!existing) throw new HttpError(404, "Item not found");
  const tx = db.transaction(() => {
    persistUpdate(db, existing, changes, present, now, "patch", false);
    reconcile(db, now);
  });
  tx();
  const updated = getItem(db, id);
  if (!updated) throw new HttpError(404, "Item not found");
  return updated;
}

export function closeItem(db: DB, id: number, status: "done" | "dropped", note: string | null, now: Date): Item {
  const existing = getItem(db, id);
  if (!existing) throw new HttpError(404, "Item not found");
  const iso = now.toISOString();
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE items SET status = ?, closed_at = COALESCE(closed_at, ?), updated_at = ?, last_activity_at = ? WHERE id = ?`,
    ).run(status, iso, iso, iso, id);
    insertEvent(db, {
      item_id: id,
      actor: "assistant",
      type: "close",
      payload: { status, note, title: existing.title, external_key: existing.external_key },
      created_at: iso,
    });
    reconcile(db, now);
  });
  tx();
  const updated = getItem(db, id);
  if (!updated) throw new HttpError(404, "Item not found");
  return updated;
}

export function applyUserAction(db: DB, id: number, action: ParsedAction, now: Date): { item: Item; webhook: WebhookBody } {
  const existing = getItem(db, id);
  if (!existing) throw new HttpError(404, "Item not found");
  if (existing.status === "done" || existing.status === "dropped") {
    throw new HttpError(400, "Item is closed");
  }
  const iso = now.toISOString();
  let value: string | null = null;
  const tx = db.transaction(() => {
    if (action.type === "done" || action.type === "drop") {
      const status = action.type === "done" ? "done" : "dropped";
      db.prepare(
        `UPDATE items SET status = ?, closed_at = ?, updated_at = ?, last_activity_at = ? WHERE id = ?`,
      ).run(status, iso, iso, iso, id);
    } else if (action.type === "snooze") {
      value = action.until;
      db.prepare(
        `UPDATE items SET status = 'snoozed', snoozed_until = ?, updated_at = ?, last_activity_at = ? WHERE id = ?`,
      ).run(action.until, iso, iso, id);
    } else if (action.type === "reply") {
      value = action.text;
      db.prepare(
        `UPDATE items SET last_reply = ?, updated_at = ?, last_activity_at = ? WHERE id = ?`,
      ).run(action.text, iso, iso, id);
    } else if (action.type === "move") {
      if (action.section === existing.section) throw new HttpError(400, "Already in that section");
      value = action.section;
      const original =
        action.section === "stalled"
          ? existing.section === "stalled"
            ? existing.original_section
            : existing.section
          : null;
      db.prepare(
        `UPDATE items SET section = ?, original_section = ?, updated_at = ?, last_activity_at = ? WHERE id = ?`,
      ).run(action.section, original, iso, iso, id);
    } else {
      const match = existing.options?.find((option) => option.value === action.value);
      if (!match) throw new HttpError(400, "Unknown option");
      value = action.value;
      db.prepare(
        `UPDATE items SET choice = ?, status = 'done', closed_at = ?, updated_at = ?, last_activity_at = ? WHERE id = ?`,
      ).run(action.value, iso, iso, iso, id);
    }
    insertEvent(db, {
      item_id: id,
      actor: "user",
      type: action.type,
      payload: {
        value,
        title: existing.title,
        external_key: existing.external_key,
        label: action.type === "choose" ? existing.options?.find((option) => option.value === action.value)?.label ?? null : undefined,
        from: action.type === "move" ? existing.section : undefined,
      },
      created_at: iso,
    });
    reconcile(db, now);
  });
  tx();
  const item = getItem(db, id);
  if (!item) throw new HttpError(404, "Item not found");
  return {
    item,
    webhook: {
      type: action.type,
      item_id: item.id,
      external_key: item.external_key,
      title: item.title,
      value,
      at: iso,
    },
  };
}

export function recordUserMessage(db: DB, text: string, now: Date, to?: { handle: string; name: string }): WebhookBody {
  const iso = now.toISOString();
  insertEvent(db, {
    item_id: null,
    actor: "user",
    type: "message",
    payload: to ? { value: text, to: to.handle } : { value: text },
    created_at: iso,
  });
  return {
    type: "message",
    item_id: null,
    external_key: null,
    title: null,
    value: text,
    at: iso,
    ...(to ? { to: to.handle, to_name: to.name } : {}),
  };
}

/** The bots the assistant published, in its order. */
export function listBots(db: DB): Bot[] {
  const rows = db.prepare(`SELECT handle, name, description FROM bots ORDER BY position ASC`).all() as {
    handle: string;
    name: string;
    description: string | null;
  }[];
  return rows.map((row) => ({ ...row, primary: false }));
}

/** Replaces the whole list. */
export function replaceBots(db: DB, bots: Bot[]): void {
  const insert = db.prepare(`INSERT INTO bots (handle, name, description, position) VALUES (?, ?, ?, ?)`);
  db.transaction(() => {
    db.prepare(`DELETE FROM bots`).run();
    bots.forEach((bot, index) => insert.run(bot.handle, bot.name, bot.description, index));
  })();
}

export function reconcile(db: DB, now = new Date()): void {
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const apply = () => {
    const snoozed = db
      .prepare(`SELECT id, snoozed_until FROM items WHERE status = 'snoozed'`)
      .all() as { id: number; snoozed_until: string | null }[];
    const wake = db.prepare(`UPDATE items SET status = 'open', updated_at = ? WHERE id = ?`);
    for (const row of snoozed) {
      if (!row.snoozed_until) continue;
      const until = Date.parse(row.snoozed_until);
      if (!Number.isNaN(until) && until <= nowMs) wake.run(nowIso, row.id);
    }

    const open = db
      .prepare(`SELECT id, section, original_section, last_activity_at FROM items WHERE status = 'open'`)
      .all() as {
      id: number;
      section: string;
      original_section: string | null;
      last_activity_at: string;
    }[];
    const stall = db.prepare(
      `UPDATE items SET section = 'stalled', original_section = ?, updated_at = ? WHERE id = ?`,
    );
    const restore = db.prepare(
      `UPDATE items SET section = ?, original_section = NULL, updated_at = ? WHERE id = ?`,
    );
    const explicitStall = explicitStallIds(db);
    for (const row of open) {
      const activity = Date.parse(row.last_activity_at);
      if (Number.isNaN(activity)) continue;
      const idle = nowMs - activity;
      if (row.section === "stalled" && row.original_section && idle < WEEK_MS && !explicitStall.has(row.id)) {
        restore.run(row.original_section, nowIso, row.id);
      } else if (row.section !== "stalled" && idle >= WEEK_MS) {
        stall.run(row.section, nowIso, row.id);
      }
    }
  };
  if (db.inTransaction) apply();
  else db.transaction(apply)();
}

export function listItems(db: DB, filters: { status?: ItemStatus; section?: Section }, now = new Date()): Item[] {
  reconcile(db, now);
  const clauses: string[] = [];
  const params: string[] = [];
  if (filters.status) {
    clauses.push("status = ?");
    params.push(filters.status);
  }
  if (filters.section) {
    clauses.push("section = ?");
    params.push(filters.section);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(`SELECT * FROM items ${where} ORDER BY id ASC`).all(...params) as ItemRow[];
  return rows.map(mapItem);
}

export function listBoardItems(db: DB, now = new Date()): Item[] {
  reconcile(db, now);
  const cutoff = new Date(now.getTime() - WEEK_MS).toISOString();
  const rows = db
    .prepare(
      `SELECT * FROM items
       WHERE status = 'open'
          OR (status = 'done' AND closed_at IS NOT NULL AND closed_at >= ?)
       ORDER BY id ASC`,
    )
    .all(cutoff) as ItemRow[];
  return rows.map(mapItem);
}

function explicitStallIds(db: DB): Set<number> {
  const rows = db
    .prepare(
      `SELECT e.item_id AS item_id, e.type AS type, e.payload_json AS payload_json
       FROM events e
       JOIN (
         SELECT item_id, MAX(id) AS max_id
         FROM events
         WHERE item_id IS NOT NULL
         GROUP BY item_id
       ) latest ON e.id = latest.max_id`,
    )
    .all() as { item_id: number; type: string; payload_json: string | null }[];
  const ids = new Set<number>();
  for (const row of rows) {
    if (row.type !== "move" || !row.payload_json) continue;
    try {
      const payload = JSON.parse(row.payload_json) as { value?: unknown };
      if (payload.value === "stalled") ids.add(row.item_id);
    } catch {
      /* ignore malformed history */
    }
  }
  return ids;
}

function mapEvent(row: {
  id: number;
  item_id: number | null;
  actor: string;
  type: string;
  payload_json: string | null;
  created_at: string;
}): StoredEvent {
  return {
    id: row.id,
    item_id: row.item_id,
    actor: row.actor,
    type: row.type,
    payload: row.payload_json ? (JSON.parse(row.payload_json) as Record<string, unknown>) : null,
    created_at: row.created_at,
  };
}

export function listItemEvents(db: DB, itemId: number): StoredEvent[] {
  const rows = db
    .prepare(
      `SELECT id, item_id, actor, type, payload_json, created_at
       FROM events
       WHERE item_id = ?
       ORDER BY created_at ASC, id ASC
       LIMIT 200`,
    )
    .all(itemId) as {
    id: number;
    item_id: number | null;
    actor: string;
    type: string;
    payload_json: string | null;
    created_at: string;
  }[];
  return rows.map(mapEvent);
}

export function listUserEvents(db: DB, since: string | null): StoredEvent[] {
  const rows = db
    .prepare(
      `SELECT id, item_id, actor, type, payload_json, created_at
       FROM events
       WHERE actor = 'user' AND created_at > ?
       ORDER BY created_at ASC, id ASC
       LIMIT 500`,
    )
    .all(since ?? "") as {
    id: number;
    item_id: number | null;
    actor: string;
    type: string;
    payload_json: string | null;
    created_at: string;
  }[];
  return rows.map(mapEvent);
}

export function enqueueOutbox(db: DB, payload: WebhookBody, now = new Date()): number {
  const info = db
    .prepare(`INSERT INTO outbox (payload_json, created_at) VALUES (?, ?)`)
    .run(JSON.stringify(payload), now.toISOString());
  return Number(info.lastInsertRowid);
}

export function listOutbox(db: DB): OutboxRow[] {
  const rows = db
    .prepare(
      `SELECT id, payload_json, created_at FROM outbox WHERE acked_at IS NULL ORDER BY id ASC LIMIT 500`,
    )
    .all() as { id: number; payload_json: string; created_at: string }[];
  return rows.map((row) => ({
    id: row.id,
    created_at: row.created_at,
    payload: JSON.parse(row.payload_json) as WebhookBody,
  }));
}

export function countOutbox(db: DB): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM outbox WHERE acked_at IS NULL`).get() as { n: number };
  return row.n;
}

export function ackOutbox(db: DB, ids: number[], now = new Date()): number {
  const iso = now.toISOString();
  const stmt = db.prepare(`UPDATE outbox SET acked_at = ? WHERE id = ? AND acked_at IS NULL`);
  let acked = 0;
  const tx = db.transaction(() => {
    for (const id of ids) {
      const info = stmt.run(iso, id);
      acked += info.changes;
    }
  });
  tx();
  return acked;
}

export function getMeta(db: DB, key: string): string | null {
  const row = db.prepare(`SELECT value FROM meta WHERE key = ?`).get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(db: DB, key: string, value: string): void {
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}
