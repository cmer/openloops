import { useId, useState, type FormEvent, type MouseEvent, type RefObject } from "react";
import type { Item } from "../../shared/types";
import type { ActionType } from "./api";
import { Markdown } from "./markdown";
import { Age, Btn, Gutter, HostLink, WasFlag, choiceLabel } from "./primitives";
import { customSnooze, snoozeChoices, tomorrowInputValue } from "./time";

export type OnAct = (type: ActionType, value?: string) => void;

/* ---------- panels, shared with ItemModal ---------- */

export function SnoozePanel({ now, busy, onAct }: { now: number; busy: boolean; onAct: OnAct }) {
  const id = useId();
  const [date, setDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const until = customSnooze(date, now);
    if (!until) {
      setError("Pick a future day.");
      return;
    }
    onAct("snooze", until);
  }

  return (
    <div className="ol-panel" role="group" aria-label="Snooze">
      <div className="ol-panel-row">
        {snoozeChoices(new Date(now)).map((choice) => (
          <Btn key={choice.id} className="ol-snooze-preset" disabled={busy} onClick={() => onAct("snooze", choice.at)}>
            {choice.label}
            <small>{choice.detail}</small>
          </Btn>
        ))}
      </div>
      {/* noValidate: `min` greys out past days in the picker, but a typed past date should get our message. */}
      <form className="ol-panel-row" onSubmit={submit} noValidate>
        <label className="ol-sr" htmlFor={id}>
          Snooze until date
        </label>
        <input
          id={id}
          type="date"
          className="ol-input"
          style={{ width: "auto" }}
          min={tomorrowInputValue(new Date(now))}
          value={date}
          onChange={(event) => {
            setDate(event.target.value);
            setError(null);
          }}
        />
        <Btn type="submit" disabled={busy}>
          Snooze until date
        </Btn>
      </form>
      {error && (
        <p className="ol-panel-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function ReplyPanel({
  busy,
  onAct,
  onCancel,
  inputRef,
}: {
  busy: boolean;
  onAct: OnAct;
  onCancel: () => void;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const id = useId();
  const [text, setText] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const reply = text.trim();
    if (reply && !busy) onAct("reply", reply);
  }

  return (
    <form className="ol-panel" onSubmit={submit}>
      <label className="ol-sr" htmlFor={id}>
        Reply
      </label>
      <textarea
        id={id}
        ref={inputRef}
        autoFocus
        className="ol-textarea sensitive"
        placeholder="Write the answer"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          // Cmd+Enter (Ctrl+Enter off Mac) sends; plain Enter still adds a new line.
          if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || event.nativeEvent.isComposing) return;
          event.preventDefault();
          event.currentTarget.form?.requestSubmit();
        }}
      />
      <div className="ol-panel-row">
        <Btn variant="primary" type="submit" disabled={busy || !text.trim()} title="Send reply (⌘↵)">
          Send reply
        </Btn>
        <Btn variant="quiet" onClick={onCancel}>
          Cancel
        </Btn>
      </div>
    </form>
  );
}

/** The confirm sits in its own panel, away from where Drop was tapped. Keep it is on the left. */
export function DropConfirm({ busy, onAct, onCancel }: { busy: boolean; onAct: OnAct; onCancel: () => void }) {
  return (
    <div className="ol-panel" role="group" aria-label="Confirm drop">
      <span>Drop this loop? It won't appear in Recently done.</span>
      <div className="ol-panel-row">
        <Btn size="sm" onClick={onCancel}>
          Keep it
        </Btn>
        <span style={{ flex: 1 }} />
        <Btn size="sm" variant="armed" disabled={busy} onClick={() => onAct("drop")}>
          Confirm drop
        </Btn>
      </div>
    </div>
  );
}

export function OptionButtons({ item, busy, onAct }: { item: Item; busy: boolean; onAct: OnAct }) {
  if (item.status !== "open" || !item.options?.length) return null;
  return (
    <div className="ol-options" role="group" aria-label="Options">
      {item.options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="ol-option sensitive"
          disabled={busy}
          onClick={() => onAct("choose", option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- list entry ---------- */

const INTERACTIVE = "a, button, input, textarea, select, label, form";

export function ItemCard({
  item,
  now,
  pending,
  busy,
  onOpen,
  onAct,
}: {
  item: Item;
  now: number;
  /** This card's action is in flight. */
  pending: boolean;
  /** Any action is in flight. Actions are serialized. */
  busy: boolean;
  onOpen: (item: Item) => void;
  onAct: (item: Item, type: ActionType, value?: string) => void;
}) {
  const [panel, setPanel] = useState<null | "snooze" | "reply" | "drop">(null);
  const [expanded, setExpanded] = useState(false);
  const open = item.status === "open";
  const toggle = (next: "snooze" | "reply" | "drop") => setPanel((current) => (current === next ? null : next));
  const act: OnAct = (type, value) => {
    setPanel(null);
    onAct(item, type, value);
  };

  function rowClick(event: MouseEvent<HTMLElement>) {
    const target = event.target;
    if (target instanceof Element && target.closest(INTERACTIVE)) return;
    onOpen(item);
  }

  const details = item.body ? (
    <Btn size="sm" variant="quiet" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>
      {expanded ? "Hide" : "Details"}
    </Btn>
  ) : null;

  return (
    <article className={`ol-entry${item.status === "done" ? " is-done" : ""}`} onClick={rowClick}>
      <Gutter item={item} now={now} />
      <div className="ol-body">
        <div className="ol-topline">
          <span className="ol-src">{item.source}</span>
          <Age item={item} now={now} />
        </div>
        <h3 className="ol-title">
          <button type="button" className="ol-title-btn sensitive" onClick={() => onOpen(item)}>
            {item.title}
          </button>
        </h3>
        <WasFlag item={item} />
        {(item.owner || item.link) && (
          <div className="ol-facts-line">
            {item.owner && (
              <span>
                <span className="k">Who</span>
                <span className="sensitive">{item.owner}</span>
              </span>
            )}
            {item.link && (
              <span>
                <span className="k">Link</span>
                <HostLink url={item.link} />
              </span>
            )}
          </div>
        )}
        {item.choice && (
          <p className="ol-quote ol-quote--chose">
            <span className="k">Chose</span>
            <span className="sensitive">{choiceLabel(item)}</span>
          </p>
        )}
        {item.last_reply && (
          <p className="ol-quote">
            <span className="k">You replied</span>
            <span className="sensitive">{item.last_reply}</span>
          </p>
        )}
        {expanded && item.body && <Markdown text={item.body} />}

        <OptionButtons item={item} busy={busy} onAct={act} />

        {open ? (
          <div className="ol-actions">
            <Btn variant="primary" size="sm" pending={pending} disabled={busy} onClick={() => act("done")}>
              {pending ? "Saving…" : "Done"}
            </Btn>
            <Btn size="sm" disabled={busy} aria-expanded={panel === "snooze"} onClick={() => toggle("snooze")}>
              Snooze
            </Btn>
            <Btn size="sm" disabled={busy} aria-expanded={panel === "reply"} onClick={() => toggle("reply")}>
              Reply
            </Btn>
            {details}
            <span className="ol-spacer" />
            {panel !== "drop" && (
              <Btn size="sm" variant="drop" disabled={busy} onClick={() => toggle("drop")}>
                Drop
              </Btn>
            )}
          </div>
        ) : details ? (
          <div className="ol-actions">{details}</div>
        ) : null}

        {open && panel === "snooze" && <SnoozePanel now={now} busy={busy} onAct={act} />}
        {open && panel === "reply" && <ReplyPanel busy={busy} onAct={act} onCancel={() => setPanel(null)} />}
        {open && panel === "drop" && <DropConfirm busy={busy} onAct={act} onCancel={() => setPanel(null)} />}
      </div>
    </article>
  );
}
