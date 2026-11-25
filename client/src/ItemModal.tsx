import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Item, Section } from "../../shared/types";
import { getItemDetail, type ActionType, type ItemEvent } from "./api";
import { OptionButtons, ReplyPanel, SnoozePanel, type OnAct } from "./ItemCard";
import { Markdown } from "./markdown";
import { Btn, HostLink, choiceLabel } from "./primitives";
import { SECTION_LABEL } from "./sections";
import { ageDays, ageLabel, ago, formatDay, isOverdue, snoozeChoices } from "./time";

export function ItemModal({
  item,
  now,
  pending,
  busy,
  position,
  total,
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
  busy: boolean;
  /** 0-based index in the visible board order, or -1 when the card has left it. */
  position: number;
  total: number;
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
  const [panel, setPanel] = useState<null | "snooze" | "reply">(null);
  const [armed, setArmed] = useState(false);
  const open = item.status === "open";
  const section: Section = item.status === "done" ? "done" : item.section;
  const days = ageDays(item.created_at, now);
  const overdue = isOverdue(item, now);

  useEffect(() => {
    setPanel(null);
    setArmed(false);
    if (!dialogRef.current?.contains(document.activeElement)) dialogRef.current?.focus({ preventScroll: true });
  }, [item.id]);

  // Focus in, scroll lock, focus restore.
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus && document.contains(previousFocus)) previousFocus.focus({ preventScroll: true });
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

  const act: OnAct = (type, value) => {
    setPanel(null);
    setArmed(false);
    void onAct(item, type, value);
  };

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (isTyping(event.target)) return;
      if (event.key === "j" || event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault();
        if (hasNext) onNext();
        return;
      }
      if (event.key === "k" || event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        if (hasPrev) onPrev();
        return;
      }
      if (!open) return;
      if (event.key === "r") {
        event.preventDefault();
        setPanel("reply");
        requestAnimationFrame(() => replyRef.current?.focus());
        return;
      }
      if (busy) return;
      if (event.key === "d") {
        event.preventDefault();
        act("done");
      } else if (event.key === "s") {
        event.preventDefault();
        const tomorrow = snoozeChoices(new Date(now))[0];
        if (tomorrow) act("snooze", tomorrow.at);
      } else if (event.key === "x") {
        event.preventDefault();
        if (armed) act("drop");
        else setArmed(true);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const fields: [string, ReactNode, string?][] = [
    ["Source", item.source ?? "—"],
    ["Age", <span className={`ol-age${days > 7 ? " is-old" : ""}`}>{ageLabel(days)}</span>],
    item.status === "done" && item.closed_at
      ? ["Closed", formatDay(item.closed_at)]
      : ["Due", item.due_at ? `${formatDay(item.due_at)}${overdue ? " · Overdue" : ""}` : "No date", overdue ? "is-overdue" : undefined],
  ];
  if (item.owner) fields.push(["Who", <span className="sensitive">{item.owner}</span>]);
  if (section === "stalled" && item.original_section) fields.push(["Was", SECTION_LABEL[item.original_section]]);
  if (item.link) fields.push(["Link", <HostLink url={item.link} />]);
  if (item.choice) fields.push(["Chose", <span className="sensitive">{choiceLabel(item)}</span>]);
  if (item.last_reply) fields.push(["You replied", <span className="sensitive">{item.last_reply}</span>]);

  return (
    <>
      <button type="button" className="ol-overlay" aria-label="Close" onClick={onClose} />
      <div ref={dialogRef} className="ol-dialog" role="dialog" aria-modal="true" aria-labelledby="ol-dialog-title" tabIndex={-1}>
        <div className="ol-dialog-head">
          <div className="ol-dialog-bar">
            <span className="ol-label">{SECTION_LABEL[section]}</span>
            <span className="ol-mono">
              #{item.id}
              {position >= 0 && ` · ${position + 1} of ${total}`}
            </span>
            <div className="ol-dialog-nav">
              <Btn size="sm" variant="quiet" k="k" disabled={!hasPrev} onClick={onPrev}>
                Prev
              </Btn>
              <Btn size="sm" variant="quiet" k="j" disabled={!hasNext} onClick={onNext}>
                Next
              </Btn>
              <Btn size="sm" onClick={onClose}>
                Close
              </Btn>
            </div>
          </div>
          <h2 id="ol-dialog-title" className="ol-dialog-title sensitive">
            {item.title}
          </h2>
        </div>

        <div className="ol-dialog-scroll">
          <dl className="ol-fields">
            {fields.map(([key, value, cls]) => (
              <div key={key} style={{ display: "contents" }}>
                <dt>{key}</dt>
                <dd className={cls}>{value}</dd>
              </div>
            ))}
          </dl>
          <section>
            <h3 className="ol-block-label">Notes</h3>
            <Markdown text={item.body} />
          </section>
          <section>
            <h3 className="ol-block-label">History</h3>
            {historyError ? (
              <p className="ol-history-state is-error">{historyError}</p>
            ) : events === null ? (
              <p className="ol-history-state">Loading history…</p>
            ) : events.length === 0 ? (
              <p className="ol-history-state">No events yet.</p>
            ) : (
              <ol className="ol-history">
                {events.map((event) => (
                  <li key={event.id}>
                    <time dateTime={event.created_at}>{ago(event.created_at, now, "date")}</time>
                    <span className="sensitive">{describeEvent(event, assistantName)}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <div className="ol-dialog-foot">
          {open ? (
            <>
              <OptionButtons item={item} busy={busy} onAct={act} />
              <div className="ol-actions">
                <Btn variant="primary" k="d" pending={pending} disabled={busy} onClick={() => act("done")}>
                  {pending ? "Saving…" : "Done"}
                </Btn>
                <Btn
                  k="s"
                  disabled={busy}
                  aria-expanded={panel === "snooze"}
                  onClick={() => setPanel((current) => (current === "snooze" ? null : "snooze"))}
                >
                  Snooze
                </Btn>
                <Btn
                  k="r"
                  disabled={busy}
                  aria-expanded={panel === "reply"}
                  onClick={() => setPanel((current) => (current === "reply" ? null : "reply"))}
                >
                  Reply
                </Btn>
                <span className="ol-spacer" />
                {armed ? (
                  <Btn variant="armed" k="x" disabled={busy} onClick={() => act("drop")}>
                    Confirm drop
                  </Btn>
                ) : (
                  <Btn variant="drop" k="x" disabled={busy} onClick={() => setArmed(true)}>
                    Drop
                  </Btn>
                )}
              </div>
              {panel === "snooze" && <SnoozePanel now={now} busy={busy} onAct={act} />}
              {panel === "reply" && <ReplyPanel busy={busy} onAct={act} onCancel={() => setPanel(null)} inputRef={replyRef} />}
              <p className="ol-legend" aria-hidden="true">
                <kbd>d</kbd> done · <kbd>s</kbd> snooze tomorrow · <kbd>x</kbd> drop · <kbd>r</kbd> reply · <kbd>j</kbd>/<kbd>k</kbd> next ·{" "}
                <kbd>Esc</kbd> close
              </p>
            </>
          ) : (
            <p className="ol-closed-note">This one is closed. j and k still move through the board.</p>
          )}
        </div>
      </div>
    </>
  );
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function describeEvent(event: ItemEvent, assistantName: string): string {
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
