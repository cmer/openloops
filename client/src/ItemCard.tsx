import { useState } from "react";
import type { FormEvent, MouseEvent } from "react";
import type { Item } from "../../shared/types";
import type { ActionType } from "./api";
import { Markdown } from "./markdown";
import { SECTION_LABEL } from "./sections";
import { ageDays, ageLabel, customSnooze, formatDay, snoozeChoices, tomorrowInputValue } from "./time";

const button =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-line bg-card px-3.5 text-sm font-medium text-ink hover:bg-white";
const primary =
  "inline-flex min-h-11 items-center justify-center rounded-full bg-pine px-3.5 text-sm font-medium text-white hover:bg-pine/90";
const quiet = "inline-flex min-h-11 items-center justify-center rounded-full px-3 text-sm font-medium text-muted hover:text-ink";
const danger =
  "inline-flex min-h-11 items-center justify-center rounded-full bg-rust-soft px-3.5 text-sm font-medium text-rust";

export function ItemCard({
  item,
  now,
  pending,
  onAct,
  onOpen,
}: {
  item: Item;
  now: number;
  pending: boolean;
  onAct: (item: Item, type: ActionType, value?: string) => void;
  onOpen: (item: Item) => void;
}) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<"snooze" | "reply" | "drop" | null>(null);
  const [reply, setReply] = useState("");
  const [date, setDate] = useState("");
  const [dateError, setDateError] = useState<string | null>(null);
  const days = ageDays(item.created_at, now);
  const old = days > 7;
  const overdue = Boolean(item.due_at && item.status === "open" && Date.parse(item.due_at) < now);
  const choiceLabel = item.choice
    ? (item.options?.find((option) => option.value === item.choice)?.label ?? item.choice)
    : null;
  const host = item.link ? safeHost(item.link) : null;

  function toggle(next: "snooze" | "reply" | "drop") {
    setPanel((current) => (current === next ? null : next));
    setDateError(null);
  }

  function submitReply(event: FormEvent) {
    event.preventDefault();
    const text = reply.trim();
    if (!text) return;
    onAct(item, "reply", text);
    setReply("");
    setPanel(null);
  }

  function submitDate(event: FormEvent) {
    event.preventDefault();
    const until = customSnooze(date, now);
    if (!until) {
      setDateError("Pick a future day.");
      return;
    }
    onAct(item, "snooze", until);
    setPanel(null);
  }

  function openFromCard(event: MouseEvent<HTMLElement>) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest("button, a, input, textarea, form")) return;
    onOpen(item);
  }

  return (
    <article
      className={`cursor-pointer rounded-2xl border bg-card px-4 py-4 ${old ? "border-rust/40" : "border-line"}`}
      onClick={openFromCard}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {item.source && (
          <span className="rounded-full bg-pine-soft px-2.5 py-1 font-medium text-pine">{item.source}</span>
        )}
        <span className={old ? "rounded-full bg-rust-soft px-2.5 py-1 font-medium text-rust" : "text-muted"}>
          {ageLabel(days)}
        </span>
        {item.due_at && (
          <span className={overdue ? "font-medium text-rust" : "text-muted"}>
            {overdue ? "Overdue" : "Due"} {formatDay(item.due_at)}
          </span>
        )}
        {item.status === "done" && item.closed_at && (
          <span className="text-muted">Closed {formatDay(item.closed_at)}</span>
        )}
        {item.owner && <span className="sensitive text-muted">Who: {item.owner}</span>}
      </div>

      <h3 className="mt-2.5 font-serif text-[1.45rem] leading-snug">
        <button type="button" className="sensitive text-left text-ink" onClick={() => onOpen(item)}>
          {item.title}
        </button>
      </h3>

      {item.section === "stalled" && item.original_section && (
        <p className="mt-1 text-xs text-muted">Was: {SECTION_LABEL[item.original_section]}</p>
      )}
      {host && item.link && (
        <a className="mt-1 inline-block text-sm text-pine underline" href={item.link} target="_blank" rel="noreferrer">
          {host}
        </a>
      )}
      {choiceLabel && <p className="sensitive mt-2 text-sm text-ink">Chose {choiceLabel}</p>}
      {item.last_reply && <p className="sensitive mt-2 text-sm leading-relaxed text-ink">You replied: {item.last_reply}</p>}

      {open && item.body && (
        <div className="sensitive mt-3">
          <Markdown text={item.body} />
        </div>
      )}

      {item.status === "open" && item.options && item.options.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {item.options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={primary}
              disabled={pending}
              onClick={() => onAct(item, "choose", option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      {item.status === "open" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={button} disabled={pending} onClick={() => onAct(item, "done")}>
            Done
          </button>
          <button type="button" className={button} disabled={pending} onClick={() => toggle("snooze")}>
            Snooze
          </button>
          <button type="button" className={button} disabled={pending} onClick={() => toggle("reply")}>
            Reply
          </button>
          {item.body && (
            <button type="button" className={quiet} onClick={() => setOpen((current) => !current)}>
              {open ? "Hide" : "Details"}
            </button>
          )}
          {panel === "drop" ? (
            <>
              <button type="button" className={danger} disabled={pending} onClick={() => onAct(item, "drop")}>
                Confirm drop
              </button>
              <button type="button" className={quiet} onClick={() => setPanel(null)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className={quiet} disabled={pending} onClick={() => toggle("drop")}>
              Drop
            </button>
          )}
        </div>
      )}

      {item.status !== "open" && item.body && (
        <button type="button" className={`${quiet} mt-2 px-0`} onClick={() => setOpen((current) => !current)}>
          {open ? "Hide" : "Details"}
        </button>
      )}

      {panel === "snooze" && item.status === "open" && (
        <div className="mt-3 rounded-xl bg-paper px-3 py-3">
          <p className="text-xs font-medium tracking-wide text-muted uppercase">Snooze until</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {snoozeChoices(new Date(now)).map((choice) => (
              <button
                key={choice.id}
                type="button"
                className={button}
                disabled={pending}
                onClick={() => onAct(item, "snooze", choice.at)}
              >
                {choice.label}
                <span className="ml-1.5 text-muted">{choice.detail}</span>
              </button>
            ))}
          </div>
          <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={submitDate}>
            <label className="sr-only" htmlFor={`snooze-${item.id}`}>
              Custom snooze date
            </label>
            <input
              id={`snooze-${item.id}`}
              type="date"
              min={tomorrowInputValue(new Date(now))}
              value={date}
              onChange={(event) => {
                setDate(event.target.value);
                setDateError(null);
              }}
              className="min-h-11 rounded-xl border border-line bg-white px-3 text-base"
            />
            <button type="submit" className={primary} disabled={pending}>
              Snooze until date
            </button>
          </form>
          {dateError && <p className="mt-2 text-sm text-rust">{dateError}</p>}
        </div>
      )}

      {panel === "reply" && item.status === "open" && (
        <form className="mt-3" onSubmit={submitReply}>
          <label className="sr-only" htmlFor={`reply-${item.id}`}>
            Reply
          </label>
          <textarea
            id={`reply-${item.id}`}
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            rows={3}
            placeholder="Write the answer"
            className="sensitive w-full resize-y rounded-xl border border-line bg-white px-3 py-2 text-base leading-relaxed"
          />
          <div className="mt-2 flex gap-2">
            <button type="submit" className={primary} disabled={pending || !reply.trim()}>
              Send reply
            </button>
            <button type="button" className={quiet} onClick={() => setPanel(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </article>
  );
}

function safeHost(link: string): string {
  try {
    return new URL(link).host;
  } catch {
    return "Link";
  }
}
