import { useCallback, useEffect, useRef, useState } from "react";
import type { Item, Section } from "../../shared/types";
import { getBoard, getBots, postAct, postMessage, type ActionType, type Board } from "./api";
import { Banners, type Banner } from "./Banners";
import { EmptyBoard, EmptySection, LoadError, LoadingBoard } from "./BoardStates";
import { fallbackBots, type Bot } from "./compose";
import { Composer } from "./Composer";
import { ItemCard } from "./ItemCard";
import { ItemModal } from "./ItemModal";
import { KanbanBoard } from "./Kanban";
import { applyOptimistic, boardOrder, groupBoard, nextOpenId } from "./order";
import { SectionBlock } from "./SectionBlock";
import { BOARD_SECTIONS, SECTION_LABEL, isSectionFilter, sectionHint, type SectionFilter } from "./sections";
import { Sidebar, Topbar, type BoardView } from "./Sidebar";
import { formatWeekday, isVisible } from "./time";
import { useTheme } from "./useTheme";

const ADVANCES: ActionType[] = ["done", "drop", "snooze", "choose"];

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

function scrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

export function App() {
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [registry, setRegistry] = useState<Bot[] | null>(null);
  const [blur, setBlur] = useState(() => readStored("openloops-blur") === "1");
  const [view, setView] = useState<BoardView>(() => (readStored("openloops-view") === "kanban" ? "kanban" : "list"));
  const [filter, setFilter] = useState<SectionFilter>(() => {
    const stored = readStored("openloops-filter");
    return isSectionFilter(stored) ? stored : "all";
  });
  // Recently done starts collapsed; only an explicit "0" (the user opened it) keeps it open across reloads.
  const [doneCollapsed, setDoneCollapsed] = useState(() => readStored("openloops-done-collapsed") !== "0");
  const [theme, setTheme] = useTheme();
  const [modalId, setModalId] = useState<number | null>(null);
  const assistantName = board?.assistant_name?.trim() || "Assistant";
  const inflight = useRef(0);
  const modalIdRef = useRef<number | null>(null);
  const modalItemRef = useRef<Item | null>(null);
  const bannerId = useRef(0);
  modalIdRef.current = modalId;
  const loadGen = useRef(0);

  const pushBanner = useCallback((kind: Banner["kind"], text: string) => {
    const id = ++bannerId.current;
    setBanners((current) => [...current.slice(-2), { id, kind, text }]);
    window.setTimeout(() => setBanners((current) => current.filter((banner) => banner.id !== id)), 4200);
  }, []);

  const load = useCallback(
    async (silent: boolean) => {
      const gen = ++loadGen.current;
      if (!silent) setLoading(true);
      // The assistant can rename or add bots at any time, so the list reloads with the board.
      void getBots().then((list) => {
        if (list) setRegistry(list);
      });
      try {
        const next = await getBoard();
        if (gen !== loadGen.current || inflight.current > 0) return;
        setBoard(next);
        setLoadError(null);
        setNow(Date.now());
      } catch (err) {
        if (gen !== loadGen.current) return;
        const message = err instanceof Error ? err.message : "Couldn't load the board";
        if (silent) pushBanner("error", "Couldn't refresh the board. Showing what was last loaded.");
        else setLoadError(message);
      } finally {
        if (!silent && gen === loadGen.current) setLoading(false);
      }
    },
    [pushBanner],
  );

  async function refresh() {
    setRefreshing(true);
    try {
      await load(true);
    } finally {
      setRefreshing(false);
    }
  }

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
    document.title = "OpenLoops";
  }, []);

  function chooseView(next: BoardView) {
    setView(next);
    store("openloops-view", next);
  }

  function toggleBlur() {
    setBlur((current) => {
      const next = !current;
      store("openloops-blur", next ? "1" : "0");
      return next;
    });
  }

  function toggleDone() {
    setDoneCollapsed((current) => {
      const next = !current;
      store("openloops-done-collapsed", next ? "1" : "0");
      return next;
    });
  }

  function chooseFilter(next: SectionFilter) {
    if (view === "kanban") {
      const column = document.querySelector(next === "all" ? ".ol-col" : `[data-col="${next}"]`);
      column?.scrollIntoView({ behavior: scrollBehavior(), block: "nearest", inline: "start" });
      return;
    }
    setFilter(next);
    store("openloops-filter", next);
    document.querySelector(".ol-content")?.scrollIntoView({ block: "start" });
  }

  const groups = groupBoard(board?.items ?? [], now);
  const activeFilter: SectionFilter = view === "list" ? filter : "all";
  const ordered = boardOrder(groups, activeFilter);

  function successText(type: ActionType, item: Item): string {
    const has = ` ${assistantName} has it.`;
    switch (type) {
      case "done":
        return `Marked done.${has}`;
      case "drop":
        return `Dropped.${has}`;
      case "snooze":
        return `Snoozed until ${item.snoozed_until ? formatWeekday(item.snoozed_until) : "later"}.${has}`;
      case "choose":
        return `Choice sent.${has}`;
      case "reply":
        return `Reply sent. The loop stays open until ${assistantName} closes it.`;
      case "move":
        return `Moved to ${SECTION_LABEL[item.section]}.${has}`;
    }
  }

  async function onAct(item: Item, type: ActionType, value?: string): Promise<boolean> {
    if (!board || inflight.current > 0) return false;
    inflight.current += 1;
    setPendingId(item.id);
    const snapshot = board;
    const orderBefore = boardOrder(groupBoard(board.items, Date.now()), activeFilter);
    const nowIso = new Date().toISOString();
    setBoard({ ...board, items: applyOptimistic(board.items, item, type, value, nowIso) });
    try {
      const result = await postAct(item.id, type, value);
      const visible = isVisible(result.item, Date.now());
      const items = snapshot.items.filter((entry) => entry.id !== result.item.id).concat(visible ? [result.item] : []);
      setBoard((current) => {
        const base = current ?? snapshot;
        const nextItems = base.items.filter((entry) => entry.id !== result.item.id);
        if (visible) nextItems.push(result.item);
        return { ...base, items: nextItems, outbox_count: result.outbox_count };
      });
      if (modalIdRef.current === item.id && ADVANCES.includes(type)) setModalId(nextOpenId(orderBefore, item.id, items));
      if (result.delivered) pushBanner("ok", successText(type, result.item));
      else pushBanner("queued", `Not delivered to ${assistantName}. It's queued.`);
      return true;
    } catch (err) {
      setBoard(snapshot);
      pushBanner("error", err instanceof Error ? err.message : "Couldn't save that");
      return false;
    } finally {
      inflight.current -= 1;
      setPendingId(null);
    }
  }

  async function sendMessage(text: string, to: string): Promise<{ delivered: boolean }> {
    const result = await postMessage(text, to);
    setBoard((current) => (current ? { ...current, outbox_count: result.outbox_count } : current));
    return result;
  }

  const bots = registry ?? fallbackBots(assistantName);
  const modalIndex = ordered.findIndex((item) => item.id === modalId);
  const liveModalItem = modalIndex >= 0 ? ordered[modalIndex] : board?.items.find((item) => item.id === modalId);
  if (liveModalItem) modalItemRef.current = liveModalItem;
  const modalItem = modalId == null ? null : (liveModalItem ?? modalItemRef.current);
  const boardEmpty = BOARD_SECTIONS.every((section) => groups[section.id].length === 0);
  const filteredSection = activeFilter === "all" ? null : BOARD_SECTIONS.find((section) => section.id === activeFilter);
  const busy = pendingId != null;

  function renderList() {
    if (!board) return null;
    if (filteredSection && groups[filteredSection.id].length === 0) {
      return <EmptySection label={filteredSection.title} done={filteredSection.id === "done"} onShowAll={() => chooseFilter("all")} />;
    }
    if (boardEmpty) return <EmptyBoard assistantName={assistantName} />;
    return BOARD_SECTIONS.filter((section) => groups[section.id].length > 0 && (activeFilter === "all" || section.id === activeFilter)).map(
      (section) => (
        <SectionBlock
          key={section.id}
          id={section.id}
          title={section.title}
          hint={sectionHint(section.id, assistantName)}
          items={groups[section.id]}
          // Filtering to Recently done means the user wants to see it, so the toggle only applies on the full board.
          {...(section.id === "done" && activeFilter === "all" ? { collapsed: doneCollapsed, onToggle: toggleDone } : {})}
          renderItem={(item) => (
            <ItemCard
              key={item.id}
              item={item}
              now={now}
              pending={pendingId === item.id}
              busy={busy}
              onOpen={(entry) => setModalId(entry.id)}
              onAct={(entry, type, value) => void onAct(entry, type, value)}
            />
          )}
        />
      ),
    );
  }

  return (
    <div className={`ol-app${blur ? " privacy" : ""}`} data-look="standard">
      <div className="ol-shell">
        <Sidebar
          assistantName={assistantName}
          groups={groups}
          items={board?.items ?? []}
          loaded={board != null}
          now={now}
          lastSyncedAt={board?.last_synced_at ?? null}
          outboxCount={board?.outbox_count ?? 0}
          view={view}
          filter={filter}
          onFilter={chooseFilter}
          refreshing={refreshing}
          onRefresh={() => void refresh()}
          blur={blur}
          onBlur={toggleBlur}
          theme={theme}
          onTheme={setTheme}
        />
        <div className="ol-content">
          <Topbar
            assistantName={assistantName}
            view={view}
            filter={filter}
            onView={chooseView}
            onFilter={chooseFilter}
            groups={groups}
            items={board?.items ?? []}
            now={now}
          />
          <main className={`ol-main${view === "kanban" ? " ol-main--wide" : filteredSection ? " ol-main--single" : ""}`}>
            <Composer bots={bots} send={sendMessage} />
            {loading && !board && <LoadingBoard />}
            {loadError && !board && <LoadError message={loadError} onRetry={() => void load(false)} />}
            {board &&
              (view === "list" ? (
                renderList()
              ) : (
                <KanbanBoard
                  groups={groups}
                  now={now}
                  onOpen={(item) => setModalId(item.id)}
                  onMove={(item, section: Section) => void onAct(item, "move", section)}
                  doneCollapsed={doneCollapsed}
                  onToggleDone={toggleDone}
                />
              ))}
          </main>
        </div>
      </div>
      {modalItem && (
        <ItemModal
          item={modalItem}
          now={now}
          pending={pendingId === modalItem.id}
          busy={busy}
          position={modalIndex}
          total={ordered.length}
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
      <Banners banners={banners} />
    </div>
  );
}
