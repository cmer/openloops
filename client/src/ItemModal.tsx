import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Item, Section } from "../../shared/types";
import { getItemDetail, type ActionType, type ItemEvent } from "./api";
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

export function ItemModal({
  item,
  now,
  pending,
  hasPrev,
  hasNext,
  onClose,
  onPrev,
  onNext,
  onAct,
  assistantName,
}: {
  item: Item;
  now: number;
  pending: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onAct: (item: Item, type: ActionType, value?: string) => Promise<boolean>;
  assistantName: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const [events, setEvents] = useState<ItemEvent[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [date, setDate] = useState("");
  const [dateError, setDateError] = useState<string | null>(null);
  const [showSnooze, setShowSnooze] = useState(false);
  const [confirmDrop, setConfirmDrop] = useState(false);
  const days = ageDays(item.created_at, now);
  const old = days > 7;
  const overdue = Boolean(item.due_at && item.status === "open" && Date.parse(item.due_at) < now);
  const choiceLabel = item.choice ? (item.options?.find((option) => option.value === item.choice)?.label ?? item.choice) : null;
  const host = item.link ? safeHost(item.link) : null;
  const open = item.status === "open";

  useEffect(() => {
    setReply("");
    setDate("");
    setDateError(null);
    setShowSnooze(false);
    setConfirmDrop(false);
  }, [item.id]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setEvents(null);
    setHistoryError(null);
    void getItemDetail(item.id)
      .then((detail) => {
        if (!cancelled) setEvents(detail.events);
      })
      .catch((err: unknown) => {
        if (!cancelled) setHistoryError(err instanceof Error ? err.message : "Couldn't load history");
      });
    return () => {
      cancelled = true;
    };
  }, [item.id, item.updated_at]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "j" || event.key === "ArrowDown" || event.key === "ArrowRight") {
        if (isTyping(event.target)) return;
        event.preventDefault();
        if (hasNext) onNext();
        return;
      }
      if (event.key === "k" || event.key === "ArrowUp" || event.key === "ArrowLeft") {
        if (isTyping(event.target)) return;
        event.preventDefault();
        if (hasPrev) onPrev();
        return;
      }
      if (isTyping(event.target) || !open || pending) return;
      if (event.key === "d") {
        event.preventDefault();
        void onAct(item, "done");
      } else if (event.key === "s") {
        event.preventDefault();
        const tomorrow = snoozeChoices(new Date(now))[0];
        if (tomorrow) void onAct(item, "snooze", tomorrow.at);
      } else if (event.key === "r") {
        event.preventDefault();
        setShowSnooze(false);
        replyRef.current?.focus();
      } else if (event.key === "x") {
        event.preventDefault();
        if (confirmDrop) void onAct(item, "drop");
        else setConfirmDrop(true);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirmDrop, hasNext, hasPrev, item, now, onAct, onClose, onNext, onPrev, open, pending]);

  function submitReply(event: FormEvent) {
    event.preventDefault();
    const text = reply.trim();
    if (!text) return;
    void onAct(item, "reply", text);
  }

  function submitDate(event: FormEvent) {
    event.preventDefault();
    const until = customSnooze(date, now);
    if (!until) {
      setDateError("Pick a future day.");
      return;
    }
    void onAct(item, "snooze", until);
  }

  return (
    <div className="fixed inset-0 z-40 flex items-stretch justify-center sm:items-center sm:p-4">
      <button type="button" className="absolute inset-0 bg-night/45" aria-label="Close" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="item-dialog-title"
        tabIndex={-1}
        className="relative flex h-[100dvh] w-full flex-col bg-card outline-none sm:h-auto sm:max-h-[min(44rem,calc(100dvh-2rem))] sm:max-w-xl sm:rounded-2xl sm:border sm:border-line sm:shadow-xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">{SECTION_LABEL[item.section]}</p>
            <h2 id="item-dialog-title" className="sensitive mt-1 font-serif text-2xl leading-tight">
              {item.title}
            </h2>
          </div>
          <div className="flex shrink-0 gap-1">
            <button type="button" className={quiet} disabled={!hasPrev} onClick={onPrev}>
              Prev
            </button>
            <button type="button" className={quiet} disabled={!hasNext} onClick={onNext}>
              Next
            </button>
            <button type="button" className={button} onClick={onClose}>
              Close
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {item.source && <span className="rounded-full bg-pine-soft px-2.5 py-1 font-medium text-pine">{item.source}</span>}
            <span className={old ? "rounded-full bg-rust-soft px-2.5 py-1 font-medium text-rust" : "text-muted"}>
              {ageLabel(days)}
            </span>
            {item.due_at && (
              <span className={overdue ? "font-medium text-rust" : "text-muted"}>
                {overdue ? "Overdue" : "Due"} {formatDay(item.due_at)}
              </span>
            )}
            {item.owner && <span className="sensitive text-muted">Who: {item.owner}</span>}
            {item.status === "done" && item.closed_at && <span className="text-muted">Closed {formatDay(item.closed_at)}</span>}
          </div>
          {item.section === "stalled" && item.original_section && (
            <p className="mt-2 text-xs text-muted">Was: {SECTION_LABEL[item.original_section]}</p>
          )}
          {host && item.link && (
            <a className="mt-2 inline-block text-sm text-pine underline" href={item.link} target="_blank" rel="noreferrer">
              {host}
            </a>
          )}
          {choiceLabel && <p className="sensitive mt-3 text-sm">Chose {choiceLabel}</p>}
          {item.last_reply && <p className="sensitive mt-3 text-sm leading-relaxed">You replied: {item.last_reply}</p>}

          <div className="sensitive mt-4">
            {item.body ? <Markdown text={item.body} /> : <p className="text-sm text-muted">No notes.</p>}
          </div>

          <h3 className="mt-6 text-xs font-medium tracking-wide text-muted uppercase">History</h3>
          {historyError && <p className="mt-2 text-sm text-rust">{historyError}</p>}
          {events === null && !historyError && <p className="mt-2 text-sm text-muted">Loading history…</p>}
          {events?.length === 0 && <p className="mt-2 text-sm text-muted">No events yet.</p>}
          {events && events.length > 0 && (
            <ol className="mt-2 flex flex-col gap-2">
              {events.map((event) => (
                <li key={event.id} className="text-sm leading-snug">
                  <span className="sensitive">{describeEvent(event, assistantName)}</span>
                  <span className="ml-2 text-xs text-muted">{formatEventTime(event.created_at, now)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <footer className="border-t border-line px-4 py-3">
          {open ? (
            <>
              {item.options && item.options.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {item.options.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={primary}
                      disabled={pending}
                      onClick={() => void onAct(item, "choose", option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button type="button" className={button} disabled={pending} onClick={() => void onAct(item, "done")}>
                  Done
                </button>
                <button
                  type="button"
                  className={button}
                  disabled={pending}
                  onClick={() => {
                    setShowSnooze((current) => !current);
                    setConfirmDrop(false);
                  }}
                >
                  Snooze
                </button>
                <button
                  type="button"
                  className={button}
                  disabled={pending}
                  onClick={() => {
                    replyRef.current?.focus();
                    setShowSnooze(false);
                  }}
                >
                  Reply
                </button>
                {confirmDrop ? (
                  <button type="button" className={danger} disabled={pending} onClick={() => void onAct(item, "drop")}>
                    Confirm drop
                  </button>
                ) : (
                  <button type="button" className={quiet} disabled={pending} onClick={() => setConfirmDrop(true)}>
                    Drop
                  </button>
                )}
              </div>
              {showSnooze && (
                <div className="mt-3">
                  <div className="flex flex-wrap gap-2">
                    {snoozeChoices(new Date(now)).map((choice) => (
                      <button
                        key={choice.id}
                        type="button"
                        className={button}
                        disabled={pending}
                        onClick={() => void onAct(item, "snooze", choice.at)}
                      >
                        {choice.label}
                        <span className="ml-1.5 text-muted">{choice.detail}</span>
                      </button>
                    ))}
                  </div>
                  <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={submitDate}>
                    <label className="sr-only" htmlFor={`modal-snooze-${item.id}`}>
                      Custom snooze date
                    </label>
                    <input
                      id={`modal-snooze-${item.id}`}
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
              <form className="mt-3" onSubmit={submitReply}>
                <label className="sr-only" htmlFor={`modal-reply-${item.id}`}>
                  Reply
                </label>
                <textarea
                  ref={replyRef}
                  id={`modal-reply-${item.id}`}
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  rows={3}
                  placeholder="Write the answer"
                  className="sensitive w-full resize-y rounded-xl border border-line bg-white px-3 py-2 text-base leading-relaxed"
                />
                <button type="submit" className={`${primary} mt-2`} disabled={pending || !reply.trim()}>
                  Send reply
                </button>
              </form>
              <p className="mt-3 text-xs text-muted">d done · s snooze tomorrow · x drop · r reply · j/k next · Esc close</p>
            </>
          ) : (
            <p className="text-sm text-muted">This one is closed. j and k still move through the board.</p>
          )}
        </footer>
      </div>
    </div>
  );
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

function safeHost(link: string): string {
  try {
    return new URL(link).host;
  } catch {
    return "Link";
  }
}

function formatEventTime(iso: string, now: number): string {
  const minutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (Number.isNaN(minutes)) return "";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours}h ago`;
  return formatDay(iso);
}

function describeEvent(event: ItemEvent, assistantName: string): string {
  const value = typeof event.payload?.value === "string" ? event.payload.value : "";
  const who = event.actor === "user" ? "You" : assistantName;
  if (event.type === "done") return `${who} marked it done`;
  if (event.type === "drop") return `${who} dropped it`;
  if (event.type === "snooze") return `${who} snoozed it${value ? ` until ${formatDay(value)}` : ""}`;
  if (event.type === "reply") return value ? `${who} replied: ${value}` : `${who} replied`;
  if (event.type === "choose") {
    const label = typeof event.payload?.label === "string" && event.payload.label ? event.payload.label : value;
    return `${who} chose ${label}`;
  }
  if (event.type === "move") {
    const from = typeof event.payload?.from === "string" ? sectionName(event.payload.from) : "";
    const to = sectionName(value);
    return from ? `${who} moved it from ${from} to ${to}` : `${who} moved it to ${to}`;
  }
  if (event.type === "close") {
    const note = typeof event.payload?.note === "string" ? event.payload.note : "";
    return note ? `${assistantName} closed it: ${note}` : `${assistantName} closed it`;
  }
  if (event.type === "upsert") return event.payload?.created === true ? `${assistantName} added it` : `${assistantName} updated it`;
  if (event.type === "patch") return `${assistantName} updated it`;
  return `${who} · ${event.type}`;
}

function sectionName(value: string): string {
  if (value in SECTION_LABEL) return SECTION_LABEL[value as Section];
  return value;
}
