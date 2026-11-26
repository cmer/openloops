import type { Item, RefreshState } from "../../shared/types";
import type { Bot } from "./compose";

export type { RefreshState };

export type Board = {
  generated_at: string;
  assistant_name: string;
  last_synced_at: string | null;
  outbox_count: number;
  refresh: RefreshState;
  items: Item[];
};

export type ActResult = {
  ok: boolean;
  delivered: boolean;
  outbox_count: number;
  item: Item;
};

export type MessageResult = {
  ok: boolean;
  delivered: boolean;
  outbox_count: number;
};

export type RefreshResult = {
  ok: boolean;
  debounced: boolean;
  delivered: boolean;
  outbox_count: number;
  refresh: RefreshState;
};

export type ActionType = "done" | "snooze" | "drop" | "reply" | "choose" | "move";

export type ItemEvent = {
  id: number;
  item_id: number | null;
  actor: string;
  type: string;
  payload: Record<string, unknown> | null;
  created_at: string;
};

async function readError(res: Response): Promise<string> {
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  return data?.error || "Couldn't save that";
}

export async function getBoard(): Promise<Board> {
  const res = await fetch("/hq/board");
  if (!res.ok) {
    const text = await res.text();
    const title = text.match(/<h1>([^<]+)<\/h1>/);
    throw new Error(title?.[1] || "Couldn't load the board");
  }
  return (await res.json()) as Board;
}

export async function getItemDetail(id: number): Promise<{ item: Item; events: ItemEvent[] }> {
  const res = await fetch(`/hq/items/${id}`);
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as { item: Item; events: ItemEvent[] };
}

export async function postAct(id: number, type: ActionType, value?: string): Promise<ActResult> {
  const res = await fetch(`/hq/items/${id}/act`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type, value }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as ActResult;
}

export async function postRefresh(): Promise<RefreshResult> {
  const res = await fetch("/hq/refresh-requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as RefreshResult;
}

export async function postMessage(text: string, to?: string): Promise<MessageResult> {
  const res = await fetch("/hq/message", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, to }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as MessageResult;
}

/** GET /hq/bots. Null when the server doesn't have a bot registry yet (404 or a network error). */
export async function getBots(): Promise<Bot[] | null> {
  try {
    const res = await fetch("/hq/bots");
    if (!res.ok) return null;
    const data = (await res.json()) as { bots?: unknown } | unknown[];
    const list = Array.isArray(data) ? data : (data as { bots?: unknown }).bots;
    if (!Array.isArray(list)) return null;
    const bots = list.filter(
      (bot): bot is Bot =>
        typeof bot === "object" && bot !== null && typeof (bot as Bot).handle === "string" && typeof (bot as Bot).name === "string",
    );
    return bots.length > 0 ? bots : null;
  } catch {
    return null;
  }
}
