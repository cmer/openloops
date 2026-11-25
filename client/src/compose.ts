export type Bot = { handle: string; name: string; primary?: boolean; description?: string };

/** Until the server has a bot registry, the only bot is the assistant itself. */
export function fallbackBots(assistantName: string): Bot[] {
  const handle = assistantName.toLowerCase().replace(/[^a-z0-9_-]+/g, "") || "assistant";
  return [{ handle, name: assistantName, primary: true }];
}

export type Parsed = {
  /** The bot it goes to, or null for an unknown tag. */
  bot: Bot | null;
  /** The text to send, with any leading tag removed. */
  body: string;
  tagged: boolean;
  /** Still typing the tag itself (nothing after it yet). */
  typingTag: boolean;
  handle: string;
};

/** A leading @handle picks the bot. Anything else goes to the primary bot. Only a tag at the very start counts. */
export function parseMessage(text: string, bots: Bot[]): Parsed {
  const primary = bots.find((bot) => bot.primary) ?? bots[0] ?? null;
  const match = text.match(/^@([A-Za-z0-9_-]*)/);
  if (!match) return { bot: primary, body: text.trim(), tagged: false, typingTag: false, handle: "" };
  const handle = (match[1] ?? "").toLowerCase();
  const rest = text.slice(match[0].length);
  return {
    bot: bots.find((bot) => bot.handle === handle) ?? null,
    body: rest.trim(),
    tagged: true,
    typingTag: rest.length === 0,
    handle,
  };
}
