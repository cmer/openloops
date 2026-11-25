import {
  isUserAction,
  isSection,
  isStatus,
  type ItemStatus,
  type Option,
  type Section,
} from "../shared/types.js";
import { HttpError } from "./errors.js";

export type ItemChanges = {
  external_key?: string | null;
  section?: Section;
  original_section?: Section | null;
  title?: string;
  body?: string | null;
  source?: string | null;
  link?: string | null;
  owner?: string | null;
  options?: Option[] | null;
  choice?: string | null;
  last_reply?: string | null;
  due_at?: string | null;
  snoozed_until?: string | null;
  status?: ItemStatus;
  created_at?: string;
  updated_at?: string;
  last_activity_at?: string;
  closed_at?: string | null;
};

const MUTABLE = new Set([
  "external_key",
  "section",
  "original_section",
  "title",
  "body",
  "source",
  "link",
  "owner",
  "options",
  "choice",
  "last_reply",
  "due_at",
  "snoozed_until",
  "status",
  "created_at",
  "updated_at",
  "last_activity_at",
  "closed_at",
]);

export type ParsedChanges = {
  changes: ItemChanges;
  present: Set<string>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown, field: string, max: number, required: boolean): string | null {
  if (value == null) {
    if (required) throw new HttpError(400, `${field} is required`);
    return null;
  }
  if (typeof value !== "string") throw new HttpError(400, `${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) {
    if (required) throw new HttpError(400, `${field} is required`);
    return null;
  }
  if (trimmed.length > max) throw new HttpError(400, `${field} is too long`);
  return trimmed;
}

function cleanDate(value: unknown, field: string): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new HttpError(400, `${field} must be an ISO date`);
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new HttpError(400, `${field} must be an ISO date`);
  return new Date(ms).toISOString();
}

function cleanOptions(value: unknown): Option[] | null {
  if (value == null) return null;
  if (!Array.isArray(value)) throw new HttpError(400, "options must be an array");
  if (value.length === 0) return null;
  if (value.length > 12) throw new HttpError(400, "options can have at most 12 entries");
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new HttpError(400, `options[${index}] must be an object`);
    const label = cleanText(entry.label, `options[${index}].label`, 120, true);
    const optionValue = cleanText(entry.value, `options[${index}].value`, 120, true);
    if (!label || !optionValue) throw new HttpError(400, `options[${index}] needs a label and value`);
    return { label, value: optionValue };
  });
}

function cleanLink(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new HttpError(400, "link must be a string");
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new HttpError(400, "link must be an http(s) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HttpError(400, "link must be an http(s) URL");
  }
  return url.toString();
}

export function parseItemChanges(input: unknown): ParsedChanges {
  if (!isRecord(input)) throw new HttpError(400, "Each item must be an object");
  const source: Record<string, unknown> = { ...input };
  const present = new Set(Object.keys(source));
  if (present.has("who") && !present.has("owner")) {
    source.owner = source.who;
    present.add("owner");
  }

  const changes: ItemChanges = {};
  if (present.has("external_key")) {
    changes.external_key = cleanText(source.external_key, "external_key", 200, false);
  }
  if (present.has("section")) {
    if (typeof source.section !== "string" || !isSection(source.section)) {
      throw new HttpError(400, "section is not a known list");
    }
    changes.section = source.section;
  }
  if (present.has("original_section")) {
    if (source.original_section == null || source.original_section === "") {
      changes.original_section = null;
    } else if (typeof source.original_section !== "string" || !isSection(source.original_section)) {
      throw new HttpError(400, "original_section is not a known list");
    } else {
      changes.original_section = source.original_section;
    }
  }
  if (present.has("title")) changes.title = cleanText(source.title, "title", 300, true) ?? undefined;
  if (present.has("body")) changes.body = cleanText(source.body, "body", 20_000, false);
  if (present.has("source")) changes.source = cleanText(source.source, "source", 200, false);
  if (present.has("owner")) changes.owner = cleanText(source.owner, "owner", 200, false);
  if (present.has("link")) changes.link = cleanLink(source.link);
  if (present.has("options")) changes.options = cleanOptions(source.options);
  if (present.has("choice")) changes.choice = cleanText(source.choice, "choice", 200, false);
  if (present.has("last_reply")) changes.last_reply = cleanText(source.last_reply, "last_reply", 4_000, false);
  if (present.has("due_at")) changes.due_at = cleanDate(source.due_at, "due_at");
  if (present.has("snoozed_until")) changes.snoozed_until = cleanDate(source.snoozed_until, "snoozed_until");
  if (present.has("created_at")) {
    const created = cleanDate(source.created_at, "created_at");
    if (!created) throw new HttpError(400, "created_at must be an ISO date");
    changes.created_at = created;
  }
  if (present.has("updated_at")) {
    const updated = cleanDate(source.updated_at, "updated_at");
    if (!updated) throw new HttpError(400, "updated_at must be an ISO date");
    changes.updated_at = updated;
  }
  if (present.has("last_activity_at")) {
    const activity = cleanDate(source.last_activity_at, "last_activity_at");
    if (!activity) throw new HttpError(400, "last_activity_at must be an ISO date");
    changes.last_activity_at = activity;
  }
  if (present.has("closed_at")) changes.closed_at = cleanDate(source.closed_at, "closed_at");
  if (present.has("status")) {
    if (typeof source.status !== "string" || !isStatus(source.status)) {
      throw new HttpError(400, "status must be open, done, dropped, or snoozed");
    }
    changes.status = source.status;
  }

  const meaningful = [...present].filter((key) => MUTABLE.has(key));
  return { changes, present: new Set(meaningful) };
}

export function parseUpsertBody(input: unknown): ParsedChanges[] {
  const list = Array.isArray(input) ? input : [input];
  if (list.length === 0) throw new HttpError(400, "Provide an item or an array of items");
  if (list.length > 200) throw new HttpError(400, "Too many items in one upsert");
  return list.map(parseItemChanges);
}

export function parseClose(input: unknown): { status: "done" | "dropped"; note: string | null } {
  if (!isRecord(input)) throw new HttpError(400, "Body must be an object");
  if (input.status !== "done" && input.status !== "dropped") {
    throw new HttpError(400, "status must be done or dropped");
  }
  return {
    status: input.status,
    note: cleanText(input.note, "note", 4_000, false),
  };
}

export type ParsedAction =
  | { type: "done" }
  | { type: "drop" }
  | { type: "snooze"; until: string }
  | { type: "reply"; text: string }
  | { type: "choose"; value: string }
  | { type: "move"; section: Section };

export function parseAction(input: unknown, now: Date): ParsedAction {
  if (!isRecord(input)) throw new HttpError(400, "Body must be an object");
  if (typeof input.type !== "string" || !isUserAction(input.type)) {
    throw new HttpError(400, "type must be done, snooze, drop, reply, choose, or move");
  }
  if (input.type === "done") return { type: "done" };
  if (input.type === "drop") return { type: "drop" };
  if (input.type === "move") {
    if (typeof input.value !== "string" || !isSection(input.value) || input.value === "done") {
      throw new HttpError(400, "value must be a section other than done");
    }
    return { type: "move", section: input.value };
  }
  const raw = typeof input.value === "string" ? input.value.trim() : "";
  if (!raw) throw new HttpError(400, "value is required");
  if (input.type === "reply") {
    if (raw.length > 4_000) throw new HttpError(400, "value is too long");
    return { type: "reply", text: raw };
  }
  if (input.type === "choose") {
    if (raw.length > 200) throw new HttpError(400, "value is too long");
    return { type: "choose", value: raw };
  }
  const until = cleanDate(raw, "value");
  if (!until) throw new HttpError(400, "value must be an ISO date");
  if (Date.parse(until) <= now.getTime()) {
    throw new HttpError(400, "Snooze time must be in the future");
  }
  return { type: "snooze", until };
}

export function parseMessage(input: unknown): string {
  if (!isRecord(input)) throw new HttpError(400, "Body must be an object");
  const text = cleanText(input.text, "text", 4_000, true);
  if (!text) throw new HttpError(400, "text is required");
  return text;
}

export function parseAck(input: unknown): number[] {
  if (!isRecord(input) || !Array.isArray(input.ids)) {
    throw new HttpError(400, "ids must be an array");
  }
  if (input.ids.length === 0) throw new HttpError(400, "ids must include at least one id");
  if (input.ids.length > 500) throw new HttpError(400, "Too many ids");
  return input.ids.map((id) => {
    if (typeof id !== "number" || !Number.isInteger(id) || id < 1) {
      throw new HttpError(400, "ids must be positive integers");
    }
    return id;
  });
}

export function parseSince(value: string | undefined): string | null {
  if (value == null || value === "") return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new HttpError(400, "since must be an ISO date");
  return new Date(ms).toISOString();
}

export function parseListFilters(query: { status?: string; section?: string }): {
  status?: ItemStatus;
  section?: Section;
} {
  const filters: { status?: ItemStatus; section?: Section } = {};
  if (query.status) {
    if (!isStatus(query.status)) throw new HttpError(400, "status must be open, done, dropped, or snoozed");
    filters.status = query.status;
  }
  if (query.section) {
    if (!isSection(query.section)) throw new HttpError(400, "section is not a known list");
    filters.section = query.section;
  }
  return filters;
}

export function parseSync(input: unknown, now: Date): string {
  if (input == null || (isRecord(input) && Object.keys(input).length === 0)) return now.toISOString();
  if (!isRecord(input)) throw new HttpError(400, "Body must be an object");
  if (input.at == null) return now.toISOString();
  const at = cleanDate(input.at, "at");
  if (!at) throw new HttpError(400, "at must be an ISO date");
  return at;
}

export function parseId(raw: string): number {
  if (!/^[1-9]\d{0,8}$/.test(raw)) throw new HttpError(400, "Invalid id");
  return Number(raw);
}
