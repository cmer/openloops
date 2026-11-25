import { HttpError } from "./errors.js";

/** A bot the message box can tag. The assistant publishes the list; messages to any bot still go to the assistant's webhook. */
export type Bot = { handle: string; name: string; description: string | null; primary: boolean };

export const MAX_BOTS = 50;
const MAX_HANDLE = 32;
const HANDLE = /^[a-z0-9_-]{1,32}$/;

/** "Email Bot" -> "email_bot", "Réna's helper" -> "renas_helper". Lowercase letters, digits and underscores. */
export function handleFrom(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_HANDLE)
    .replace(/_+$/g, "");
}

export function isHandle(value: string): boolean {
  return HANDLE.test(value);
}

export type BotInput = { name: string; handle: string | null; description: string | null };

/** Turns the published list into bots with unique handles. The assistant's own handle is reserved and skipped. */
export function normalizeBots(inputs: BotInput[], primaryHandle: string): { bots: Bot[]; skipped: string[] } {
  const taken = new Set([primaryHandle]);
  const bots: Bot[] = [];
  const skipped: string[] = [];
  for (const input of inputs) {
    const base = input.handle ?? handleFrom(input.name);
    if (!base) throw new HttpError(400, `Bot "${input.name}" needs a handle: its name has no letters or digits`);
    if (base === primaryHandle) {
      skipped.push(input.name);
      continue;
    }
    if (input.handle && taken.has(base)) throw new HttpError(400, `Bot handle "${base}" is used twice`);
    let handle = base;
    for (let n = 2; taken.has(handle); n += 1) handle = `${base.slice(0, MAX_HANDLE - String(n).length - 1)}_${n}`;
    taken.add(handle);
    bots.push({ handle, name: input.name, description: input.description, primary: false });
  }
  return { bots, skipped };
}

/** Picks the bot for a message. `to` wins. Otherwise a leading "@handle " that names a known bot routes it and is
 *  stripped; any other leading "@word" is left alone and the message goes to the assistant as before. */
export function routeMessage(bots: Bot[], text: string, to: string | undefined): { bot: Bot; text: string } {
  const primary = bots.find((bot) => bot.primary) ?? bots[0]!;
  if (to) {
    const bot = bots.find((entry) => entry.handle === to.replace(/^@/, "").toLowerCase());
    if (!bot) throw new HttpError(400, `No bot called @${to.replace(/^@/, "")}`);
    return { bot, text };
  }
  const match = text.match(/^@([A-Za-z0-9_-]+)\s+([\s\S]+)$/);
  const tagged = match ? bots.find((entry) => entry.handle === match[1]!.toLowerCase()) : undefined;
  if (!tagged || !match) return { bot: primary, text };
  return { bot: tagged, text: match[2]!.trim() };
}
