import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Item, Section } from "../../shared/types";
import { getBoard, postAct, postMessage, type ActionType, type Board } from "./api";
import { ItemCard } from "./ItemCard";
import { ItemModal } from "./ItemModal";
import { KanbanBoard } from "./Kanban";
import { BOARD_SECTIONS, SECTION_CHIP, sectionHint } from "./sections";
import { compareOpen, formatSynced, isVisible } from "./time";

type BoardView = "list" | "kanban";

export function App() {
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [pinging, setPinging] = useState(false);
  const [blur, setBlur] = useState(() => {
    try {
      return localStorage.getItem("open-loops-blur") === "1";
    } catch {
      return false;
    }
  });
  const [view, setView] = useState<BoardView>(() => {
    try {
      return localStorage.getItem("open-loops-view") === "kanban" ? "kanban" : "list";
    } catch {
      return "list";
    }
  });
  const [modalId, setModalId] = useState<number | null>(null);
  const assistantName = board?.assistant_name?.trim() || "Assistant";
  const inflight = useRef(0);
  const modalIdRef = useRef<number | null>(null);
  const modalItemRef = useRef<Item | null>(null);
  modalIdRef.current = modalId;
  const loadGen = useRef(0);

  const load = useCallback(async (silent: boolean) => {
    const gen = ++loadGen.current;
    if (!silent) setLoading(true);
    try {
      const next = await getBoard();
      if (gen !== loadGen.current || inflight.current > 0) return;
      setBoard(next);
      setLoadError(null);
      setNow(Date.now());
    } catch (err) {
      if (gen !== loadGen.current) return;
      const message = err instanceof Error ? err.message : "Couldn't load the board";
      if (silent) setBanner(message);
      else setLoadError(message);
    } finally {
      if (!silent && gen === loadGen.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
    const interval = window.setInterval(() => void load(true), 60_000);
    const clock = window.setInterval(() => setNow(Date.now()), 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      window.clearInterval(clock);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  useEffect(() => {
    if (!banner) return;
    const timeout = window.setTimeout(() => setBanner(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [banner]);

  function chooseView(next: BoardView) {
    setView(next);
    try {
      localStorage.setItem("open-loops-view", next);
    } catch {
      /* private mode */
    }
  }

  function toggleBlur() {
    setBlur((current) => {
      const next = !current;
      try {
        localStorage.setItem("open-loops-blur", next ? "1" : "0");
      } catch {
        /* private mode */
      }
      return next;
    });
  }

  async function onAct(item: Item, type: ActionType, value?: string): Promise<boolean> {
    if (!board || inflight.current > 0) return false;
    inflight.current += 1;
    setPendingId(item.id);
    const snapshot = board;
    const order = orderedItems(board.items, Date.now());
    const nowIso = new Date().toISOString();
    setBoard({ ...board, items: applyOptimistic(board.items, item, type, value, nowIso) });
    try {
      const result = await postAct(item.id, type, value);
      const items = (snapshot.items.filter((entry) => entry.id !== result.item.id) as Item[]).concat(
        isVisible(result.item, Date.now()) ? [result.item] : [],
      );
      setBoard((current) => {
        const base = current ?? snapshot;
        const nextItems = base.items.filter((entry) => entry.id !== result.item.id);
        if (isVisible(result.item, Date.now())) nextItems.push(result.item);
        return { ...base, items: nextItems, outbox_count: result.outbox_count };
      });
      if (modalIdRef.current === item.id) setModalId(nextOpenId(order, item.id, items));
      if (!result.delivered) setBanner(`Not delivered to ${assistantName}. It's queued.`);
      return true;
    } catch (err) {
      setBoard(snapshot);
      setBanner(err instanceof Error ? err.message : "Couldn't save that");
      return false;
    } finally {
      inflight.current -= 1;
      setPendingId(null);
    }
  }

  async function onPing(text: string): Promise<boolean> {
    if (inflight.current > 0) return false;
    inflight.current += 1;
    setPinging(true);
    try {
      const result = await postMessage(text);
      setBoard((current) => (current ? { ...current, outbox_count: result.outbox_count } : current));
      setBanner(result.delivered ? `Sent to ${assistantName}.` : `Saved here. ${assistantName} will pick it up from the outbox.`);
      return true;
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "Couldn't send that");
      return false;
    } finally {
      inflight.current -= 1;
      setPinging(false);
    }
  }

  useEffect(() => {
    document.title = "Open Loops";
  }, []);

  const groups = BOARD_SECTIONS.map((section) => ({
    ...section,
    hint: sectionHint(section.id, assistantName),
    items: board ? itemsFor(board.items, section.id, now) : [],
  }));
  const openCount = board?.items.filter((item) => item.status === "open").length ?? 0;
  const ordered = board ? orderedItems(board.items, now) : [];
  const modalIndex = ordered.findIndex((item) => item.id === modalId);
  const liveModalItem = modalIndex >= 0 ? ordered[modalIndex] : board?.items.find((item) => item.id === modalId);
  if (liveModalItem) modalItemRef.current = liveModalItem;
  const modalItem = modalId == null ? null : (liveModalItem ?? modalItemRef.current);

  return (
    <div className={blur ? "privacy" : undefined}>
      <header className="bg-night text-[#f6f3ec]">
        <div className="mx-auto max-w-3xl px-4 py-5 sm:py-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-medium tracking-[0.16em] text-[#f6f3ec]/60 uppercase">Open loops</p>
              <h1 className="mt-1 font-serif text-4xl leading-none">Open Loops</h1>
              <p className="mt-2 text-sm text-[#f6f3ec]/75">What {assistantName} needs from you.</p>
              <p className="mt-3 font-serif text-2xl">{board ? (openCount === 0 ? "Nothing open" : `${openCount} open`) : "…"}</p>
              <p className="mt-1 text-sm text-[#f6f3ec]/70">{board ? formatSynced(board.last_synced_at, now, assistantName) : "Loading the board"}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="flex rounded-full border border-white/20 p-0.5" role="group" aria-label="Layout">
                <button
                  type="button"
                  aria-pressed={view === "list"}
                  onClick={() => chooseView("list")}
                  className={`min-h-11 rounded-full px-3.5 text-sm ${view === "list" ? "bg-[#f6f3ec] text-night" : "text-[#f6f3ec]"}`}
                >
                  List
                </button>
                <button
                  type="button"
                  aria-pressed={view === "kanban"}
                  onClick={() => chooseView("kanban")}
                  className={`min-h-11 rounded-full px-3.5 text-sm ${view === "kanban" ? "bg-[#f6f3ec] text-night" : "text-[#f6f3ec]"}`}
                >
                  Kanban
                </button>
              </div>
              <button
                type="button"
                onClick={() => void load(true)}
                className="min-h-11 rounded-full border border-white/20 px-3.5 text-sm text-[#f6f3ec]"
              >
                Refresh
              </button>
              <button
                type="button"
                aria-pressed={blur}
                onClick={toggleBlur}
                className="min-h-11 rounded-full border border-white/20 px-3.5 text-sm text-[#f6f3ec]"
              >
                {blur ? "Show text" : "Blur for sharing"}
              </button>
            </div>
          </div>
          {board && (
            <div className="mt-4 flex flex-wrap gap-2">
              {groups.map((group) => {
                if (group.items.length === 0) return null;
                const [one, many] = SECTION_CHIP[group.id];
                const noun = group.items.length === 1 ? one : many;
                return (
                  <span key={group.id} className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-[#f6f3ec]">
                    {group.items.length} {noun}
                  </span>
                );
              })}
              {board.outbox_count > 0 && (
                <span className="rounded-full bg-brass-soft px-2.5 py-1 text-xs font-medium text-brass">
                  {board.outbox_count} {board.outbox_count === 1 ? "event" : "events"} not delivered
                </span>
              )}
            </div>
          )}
        </div>
      </header>

      <main className="py-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4">
        {banner && (
          <p className="rounded-xl bg-brass-soft px-3 py-2 text-sm text-brass" role="status">
            {banner}
          </p>
        )}

        <PingBox pending={pinging} assistantName={assistantName} onSend={onPing} />

        {loading && !board && <p className="text-sm text-muted">Loading open loops…</p>}

        {loadError && !board && (
          <div className="rounded-2xl border border-line bg-card px-4 py-5">
            <p className="font-medium">Couldn't reach Open Loops.</p>
            <p className="mt-1 text-sm text-muted">{loadError}</p>
            <button
              type="button"
              onClick={() => void load(false)}
              className="mt-3 inline-flex min-h-11 items-center rounded-full bg-pine px-4 text-sm font-medium text-white"
            >
              Retry
            </button>
          </div>
        )}

        {board && openCount === 0 && groups.every((group) => group.items.length === 0) && (
          <div className="rounded-2xl border border-dashed border-line bg-card px-5 py-8 text-center">
            <p className="font-serif text-2xl">No open loops.</p>
            <p className="mt-2 text-sm text-muted">When {assistantName} sends work, it lands in the lists below.</p>
          </div>
        )}

        </div>
        {view === "list" ? (
          <div className="mx-auto mt-8 flex max-w-3xl flex-col gap-8 px-4">
            {groups.map((group) => (
              <SectionBlock
                key={group.id}
                title={group.title}
                hint={group.hint}
                items={group.items}
                now={now}
                pendingId={pendingId}
                onAct={(item, type, value) => void onAct(item, type, value)}
                onOpen={(item) => setModalId(item.id)}
              />
            ))}
          </div>
        ) : (
          <div className="mt-8">
            <KanbanBoard
              groups={groups}
              now={now}
              onOpen={(item) => setModalId(item.id)}
              onMove={(item, section) => void onAct(item, "move", section)}
            />
          </div>
        )}
        {modalItem && (
          <ItemModal
            item={modalItem}
            now={now}
            pending={pendingId === modalItem.id}
            hasPrev={modalIndex > 0}
            hasNext={modalIndex >= 0 && modalIndex < ordered.length - 1}
            onClose={() => setModalId(null)}
            onPrev={() => {
              const previous = ordered[modalIndex - 1];
              if (previous) setModalId(previous.id);
            }}
            onNext={() => {
              const next = ordered[modalIndex + 1];
              if (next) setModalId(next.id);
            }}
            onAct={onAct}
            assistantName={assistantName}
          />
        )}
      </main>
    </div>
  );
}

function SectionBlock({
  title,
  hint,
  items,
  now,
  pendingId,
  onAct,
  onOpen,
}: {
  title: string;
  hint: string;
  items: Item[];
  now: number;
  pendingId: number | null;
  onAct: (item: Item, type: ActionType, value?: string) => void;
  onOpen: (item: Item) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;
  const shown = expanded ? items : items.slice(0, 7);
  const hidden = items.length - shown.length;
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-[1.7rem] leading-tight">{title}</h2>
        <span className="text-sm text-muted">{items.length}</span>
      </div>
      <p className="mb-3 text-sm text-muted">{hint}</p>
      <div className="flex flex-col gap-3">
        {shown.map((item) => (
          <ItemCard key={item.id} item={item} now={now} pending={pendingId === item.id} onAct={onAct} onOpen={onOpen} />
        ))}
      </div>
      {hidden > 0 && (
        <button
          type="button"
          className="mt-3 flex min-h-11 w-full items-center justify-center rounded-xl border border-dashed border-line text-sm font-medium text-pine"
          onClick={() => setExpanded(true)}
        >
          Show {hidden} more
        </button>
      )}
      {expanded && items.length > 7 && (
        <button
          type="button"
          className="mt-3 flex min-h-11 w-full items-center justify-center rounded-xl text-sm font-medium text-muted"
          onClick={() => setExpanded(false)}
        >
          Show less
        </button>
      )}
    </section>
  );
}

function PingBox({
  pending,
  assistantName,
  onSend,
}: {
  pending: boolean;
  assistantName: string;
  onSend: (text: string) => Promise<boolean>;
}) {
  const [text, setText] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const message = text.trim();
    if (!message) return;
    const ok = await onSend(message);
    if (ok) setText("");
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="rounded-2xl border border-line bg-card px-4 py-4">
      <label htmlFor="ping" className="font-serif text-xl">
        Ping {assistantName}
      </label>
      <p className="mt-1 text-sm text-muted">A nudge, a correction, or a new loop. It goes to {assistantName}, not into a list.</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          id="ping"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={`Tell ${assistantName} something`}
          className="sensitive min-h-11 w-full rounded-xl border border-line bg-white px-3 text-base"
        />
        <button
          type="submit"
          disabled={pending || !text.trim()}
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-pine px-4 text-sm font-medium text-white"
        >
          Send
        </button>
      </div>
    </form>
  );
}

function orderedItems(items: Item[], now: number): Item[] {
  return BOARD_SECTIONS.flatMap((section) => itemsFor(items, section.id, now));
}

function nextOpenId(order: Item[], currentId: number, items: Item[]): number | null {
  const byId = new Map(items.map((item) => [item.id, item]));
  const ids = order.map((item) => item.id);
  const start = ids.indexOf(currentId);
  const origin = start < 0 ? 0 : start;
  for (let step = 1; step <= ids.length; step += 1) {
    const id = ids[(origin + step) % ids.length];
    if (id === undefined) continue;
    const candidate = byId.get(id);
    if (candidate?.status !== "open") continue;
    if (id === currentId) return currentId;
    return id;
  }
  return null;
}

function itemsFor(items: Item[], section: Section, now: number): Item[] {
  if (section === "done") {
    return items
      .filter((item) => item.status === "done")
      .sort((a, b) => Date.parse(b.closed_at ?? "") - Date.parse(a.closed_at ?? ""));
  }
  return items.filter((item) => item.status === "open" && item.section === section).sort((a, b) => compareOpen(a, b, now));
}

function applyOptimistic(items: Item[], item: Item, type: ActionType, value: string | undefined, nowIso: string): Item[] {
  const next: Item = { ...item, updated_at: nowIso, last_activity_at: nowIso };
  if (type === "done") {
    next.status = "done";
    next.closed_at = nowIso;
  } else if (type === "drop") {
    next.status = "dropped";
    next.closed_at = nowIso;
  } else if (type === "snooze") {
    next.status = "snoozed";
    next.snoozed_until = value ?? null;
  } else if (type === "reply") {
    next.last_reply = value ?? null;
    if (next.section === "stalled" && next.original_section) {
      next.section = next.original_section;
      next.original_section = null;
    }
  } else if (type === "move" && value && value !== "done") {
    next.section = value as Section;
    next.original_section = value === "stalled" ? (item.section === "stalled" ? item.original_section : item.section) : null;
  } else {
    next.choice = value ?? null;
    next.status = "done";
    next.closed_at = nowIso;
  }
  const rest = items.filter((entry) => entry.id !== item.id);
  return isVisible(next, Date.now()) ? [...rest, next] : rest;
}
