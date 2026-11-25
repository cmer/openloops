import { useEffect, useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { parseMessage, type Bot } from "./compose";
import { Btn } from "./primitives";

/** Sends `body` to the bot with handle `to`. Resolves with whether it was delivered or queued. */
export type Send = (body: string, to: string) => Promise<{ delivered: boolean }>;

type Status = { kind: "ok" | "queued" | "error" | "sending"; text: string };

/** Plain text goes to the primary bot. A leading @handle sends to that bot, with autocomplete. */
export function Composer({ bots, send }: { bots: Bot[]; send: Send }) {
  const listId = useId();
  const inputId = `${listId}-input`;
  const [text, setText] = useState("");
  const [index, setIndex] = useState(0);
  const [closed, setClosed] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const primary = bots.find((bot) => bot.primary) ?? bots[0];

  const parsed = parseMessage(text, bots);
  const bad = parsed.tagged && !parsed.bot && !parsed.typingTag;
  const matches = parsed.tagged && parsed.typingTag && !closed ? bots.filter((bot) => bot.handle.startsWith(parsed.handle)) : [];
  const active = matches[Math.min(index, matches.length - 1)];
  const sending = status?.kind === "sending";

  useEffect(() => {
    if (status?.kind !== "ok" && status?.kind !== "queued") return;
    const timeout = window.setTimeout(() => setStatus(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [status]);

  function change(value: string) {
    setText(value);
    setClosed(false);
    setIndex(0);
    if (!sending) setStatus(null);
  }

  function pick(bot: Bot) {
    setText(`@${bot.handle} ${text.replace(/^@[A-Za-z0-9_-]*\s*/, "")}`);
    setClosed(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!matches.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIndex((current) => (current + 1) % matches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setIndex((current) => (current - 1 + matches.length) % matches.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      if (active) pick(active);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setClosed(true);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const bot = parsed.bot;
    if (!bot || !parsed.body || sending) return;
    setStatus({ kind: "sending", text: `Sending to ${bot.name}…` });
    try {
      const result = await send(parsed.body, bot.handle);
      setText("");
      setStatus(
        result.delivered
          ? { kind: "ok", text: `Sent to ${bot.name}.` }
          : { kind: "queued", text: `Saved here. ${bot.name} will pick it up from the outbox.` },
      );
    } catch (err) {
      const reason = err instanceof Error && err.message ? err.message : "Couldn't send that";
      setStatus({ kind: "error", text: `${reason}. Your text is still here.` });
    }
  }

  const hintClass = `ol-compose-hint${
    status ? (status.kind === "queued" ? " is-queued" : status.kind === "error" ? " is-error" : " is-ok") : bad ? " is-error" : ""
  }`;
  const hint = status ? (
    status.text
  ) : bad ? (
    `No bot called @${parsed.handle}.`
  ) : parsed.tagged && parsed.bot && !parsed.typingTag ? (
    <>
      {parsed.body ? "Sending to " : "Write the message for "}
      <b>{parsed.bot.name}</b>
    </>
  ) : null;
  const name = primary?.name ?? "the assistant";

  return (
    <form className="ol-compose" onSubmit={(event) => void submit(event)} autoComplete="off">
      <div className={`ol-compose-field${bad ? " is-bad" : ""}`}>
        <label className="ol-sr" htmlFor={inputId}>
          Message {name} or another bot
        </label>
        <input
          id={inputId}
          className="ol-compose-input sensitive"
          value={text}
          onChange={(event) => change(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`Message ${name} · type @ for another bot`}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={matches.length > 0}
          aria-controls={listId}
          aria-activedescendant={active ? `${listId}-${active.handle}` : undefined}
          aria-describedby={`${listId}-hint`}
          aria-invalid={bad || undefined}
        />
        <Btn variant="primary" size="sm" className="ol-compose-send" type="submit" disabled={!parsed.bot || !parsed.body || sending}>
          {sending ? "Sending…" : "Send"}
        </Btn>
      </div>
      <p id={`${listId}-hint`} className={hintClass} hidden={!hint} role={status?.kind === "error" ? "alert" : undefined}>
        {hint}
      </p>
      {matches.length > 0 && (
        <ul id={listId} className="ol-ac" role="listbox" aria-label="Bots">
          {matches.map((bot) => (
            <li
              key={bot.handle}
              id={`${listId}-${bot.handle}`}
              role="option"
              aria-selected={bot === active}
              onMouseDown={(event) => {
                event.preventDefault();
                pick(bot);
              }}
            >
              <span className="h">@{bot.handle}</span>
              {bot.primary ? <span className="p">Primary</span> : <span />}
              {bot.description && <span className="d">{bot.description}</span>}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
