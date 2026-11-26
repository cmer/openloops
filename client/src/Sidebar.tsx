import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Item } from "../../shared/types";
import type { Groups } from "./order";
import { Btn } from "./primitives";
import { BOARD_SECTIONS, sectionHint, type SectionFilter } from "./sections";
import { ago, isOverdue } from "./time";
import type { Theme } from "./useTheme";

export type BoardView = "list" | "kanban";

type Props = {
  assistantName: string;
  groups: Groups;
  items: Item[];
  loaded: boolean;
  now: number;
  lastSyncedAt: string | null;
  outboxCount: number;
  view: BoardView;
  filter: SectionFilter;
  /** List: show only that section. Kanban: scroll its column into view. */
  onFilter: (filter: SectionFilter) => void;
  refreshing: boolean;
  /** A refresh webhook is waiting for the assistant to finish a sync. */
  asking: boolean;
  onRefresh: () => void;
  blur: boolean;
  onBlur: () => void;
  theme: Theme;
  onTheme: (theme: Theme) => void;
};

const THEMES: { id: Theme; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

type NavEntry = { id: SectionFilter; label: string; count: number; late: number };

/** "Everything" plus each board section, with counts. Shared by the sidebar and the phone section sheet. */
function navEntries(groups: Groups, items: Item[], now: number): NavEntry[] {
  return [
    {
      id: "all",
      label: "Everything",
      count: items.filter((item) => item.status === "open").length,
      late: items.filter((item) => isOverdue(item, now)).length,
    },
    ...BOARD_SECTIONS.map((section) => {
      const list = groups[section.id];
      return { id: section.id, label: section.title, count: list.length, late: list.filter((item) => isOverdue(item, now)).length };
    }),
  ];
}

/** A left sidebar from 900px up. Below that it becomes a compact top bar: the section list hides
 *  (the Topbar's section picker takes over) and Refresh / Blur / Theme move into the "More" menu. */
export function Sidebar(props: Props) {
  const entries = navEntries(props.groups, props.items, props.now);
  const openCount = entries[0].count;
  const overdueCount = entries[0].late;
  const current: SectionFilter = props.view === "list" ? props.filter : "all";

  const navItem = ({ id, label, count, late }: NavEntry) => (
    <button
      key={id}
      type="button"
      className={`ol-nav-item${count ? "" : " is-empty"}`}
      aria-current={current === id ? "true" : undefined}
      onClick={() => props.onFilter(id)}
    >
      <span>{label}</span>
      {late > 0 && <span className="ol-nav-late">{late} late</span>}
      <span className="n">{count || ""}</span>
    </button>
  );

  const tools = (where: string) => (
    <>
      <div className="ol-row">
        <Btn
          size="sm"
          onClick={props.onRefresh}
          disabled={props.refreshing || props.asking}
          pending={props.asking}
          aria-busy={props.asking || undefined}
        >
          {props.asking ? `Asking ${props.assistantName}…` : "Refresh"}
        </Btn>
        <Btn size="sm" aria-pressed={props.blur} onClick={props.onBlur}>
          {props.blur ? "Show text" : "Blur for sharing"}
        </Btn>
      </div>
      <span className="ol-field-label" id={`theme-${where}`}>
        Theme
      </span>
      <div className="ol-seg" role="group" aria-labelledby={`theme-${where}`}>
        {THEMES.map((theme) => (
          <Btn key={theme.id} size="sm" aria-pressed={props.theme === theme.id} onClick={() => props.onTheme(theme.id)}>
            {theme.label}
          </Btn>
        ))}
      </div>
    </>
  );

  const name = props.assistantName;

  return (
    <aside className="ol-side" aria-label="OpenLoops">
      <div className="ol-side-brand">
        <span className="ol-wordmark">OpenLoops</span>
        <OverflowMenu>{tools("menu")}</OverflowMenu>
      </div>

      <div className="ol-side-status">
        <span>
          <b>{!props.loaded ? "…" : openCount ? `${openCount} open` : "Nothing open"}</b>
          {overdueCount > 0 && (
            <>
              {" · "}
              <span className="is-late">{overdueCount} overdue</span>
            </>
          )}
        </span>
        <span className={`ol-sync${props.asking || props.lastSyncedAt ? "" : " is-stale"}`}>
          {props.asking
            ? `Asking ${name}…`
            : !props.loaded
              ? "Loading the board"
              : props.lastSyncedAt
                ? `Synced from ${name} · ${ago(props.lastSyncedAt, props.now)}`
                : `${name} hasn't synced yet`}
        </span>
        {props.outboxCount > 0 && (
          <span className="ol-chip is-warn">
            ⚠ {props.outboxCount} {props.outboxCount === 1 ? "event not delivered" : "events not delivered"}
          </span>
        )}
      </div>

      <nav className="ol-nav" aria-label="Sections">
        {entries.map((entry) => [
          entry.id === "done" || entry.id === "decision" ? <div key={`sep-${entry.id}`} className="ol-nav-sep" role="presentation" /> : null,
          navItem(entry),
        ])}
      </nav>

      <div className="ol-side-foot">
        <OverflowMenu up>{tools("side")}</OverflowMenu>
      </div>
    </aside>
  );
}

/** "More" menu holding Refresh, Blur and Theme. The sidebar footer copy opens upward (desktop);
 *  the brand-row copy opens downward (phones). Closes on Escape or a click outside. */
function OverflowMenu({ up = false, children }: { up?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = () => {
      if (ref.current) ref.current.open = false;
    };
    const onPointer = (event: PointerEvent) => {
      if (ref.current?.open && !ref.current.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !ref.current?.open) return;
      close();
      ref.current.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  return (
    <details ref={ref} className={`ol-menu${up ? " ol-menu--up" : ""}`}>
      <summary className="ol-btn ol-btn--sm ol-menu-trigger" aria-label="More: refresh, blur and theme" title="More">
        <span aria-hidden="true">⋮</span>
      </summary>
      <div className="ol-menu-pop">{children}</div>
    </details>
  );
}

export function Topbar({
  assistantName,
  view,
  filter,
  onView,
  onFilter,
  groups,
  items,
  now,
}: {
  assistantName: string;
  view: BoardView;
  filter: SectionFilter;
  onView: (view: BoardView) => void;
  onFilter: (filter: SectionFilter) => void;
  groups: Groups;
  items: Item[];
  now: number;
}) {
  const section = filter === "all" ? undefined : BOARD_SECTIONS.find((entry) => entry.id === filter);
  const title = view === "kanban" ? "Board" : section ? section.title : "Everything";
  const hint =
    view === "kanban"
      ? "Every section as a column."
      : section
        ? sectionHint(section.id, assistantName)
        : "Everything open, in the order to work it.";
  const entries = navEntries(groups, items, now);
  const count = view === "kanban" ? null : (entries.find((entry) => entry.id === filter)?.count ?? 0);
  return (
    <div className="ol-topbar">
      <div className="ol-topbar-text">
        <h1>{title}</h1>
        <SectionPicker
          title={title}
          count={count}
          entries={entries}
          current={view === "list" ? filter : null}
          view={view}
          onFilter={onFilter}
          onView={onView}
        />
        <p>{hint}</p>
      </div>
      <div className="ol-seg ol-topbar-layout" role="group" aria-label="Layout">
        <LayoutButtons view={view} onView={onView} />
      </div>
    </div>
  );
}

function LayoutButtons({ view, onView }: { view: BoardView; onView: (view: BoardView) => void }) {
  return (
    <>
      <Btn size="sm" aria-pressed={view === "list"} onClick={() => onView("list")}>
        List
      </Btn>
      <Btn size="sm" aria-pressed={view === "kanban"} onClick={() => onView("kanban")}>
        Kanban
      </Btn>
    </>
  );
}

/** Phones only (CSS): the page title is a button that opens a bottom sheet listing every section,
 *  empty ones included, so there is always a way back to Everything. */
function SectionPicker({
  title,
  count,
  entries,
  current,
  view,
  onFilter,
  onView,
}: {
  title: string;
  count: number | null;
  entries: NavEntry[];
  /** The selected entry in List view; null in Kanban, where picking scrolls to a column. */
  current: SectionFilter | null;
  view: BoardView;
  onFilter: (filter: SectionFilter) => void;
  onView: (view: BoardView) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const sheet = sheetRef.current;
    (sheet?.querySelector<HTMLElement>('[aria-current="true"]') ?? sheet?.querySelector<HTMLElement>("button"))?.focus({
      preventScroll: true,
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !sheet) return;
      const buttons = [...sheet.querySelectorAll<HTMLElement>("button")];
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      trigger?.focus({ preventScroll: true });
    };
  }, [open]);

  const pick = (id: SectionFilter) => {
    setOpen(false);
    onFilter(id);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="ol-picker"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span className="ol-picker-title">{title}</span>
        {count != null && <span className="ol-picker-n">{count}</span>}
        <svg className="ol-picker-caret" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <>
          <button type="button" className="ol-overlay ol-sheet-scrim" aria-hidden="true" tabIndex={-1} onClick={() => setOpen(false)} />
          <div ref={sheetRef} className="ol-sheet" role="dialog" aria-modal="true" aria-label="Sections">
            <div className="ol-sheet-grab" aria-hidden="true" />
            <div className="ol-sheet-list">
              {entries.map((entry) => [
                entry.id === "decision" || entry.id === "done" ? <div key={`sep-${entry.id}`} className="ol-nav-sep" role="presentation" /> : null,
                <button
                  key={entry.id}
                  type="button"
                  className={`ol-sheet-item${entry.count ? "" : " is-empty"}`}
                  aria-current={current === entry.id ? "true" : undefined}
                  onClick={() => pick(entry.id)}
                >
                  <span>{entry.id === "all" ? "Everything open" : entry.label}</span>
                  {entry.late > 0 && <span className="ol-nav-late">{entry.late} late</span>}
                  <span className="n">{entry.count}</span>
                </button>,
              ])}
            </div>
            <div className="ol-seg ol-sheet-layout" role="group" aria-label="Layout">
              <LayoutButtons
                view={view}
                onView={(next) => {
                  setOpen(false);
                  onView(next);
                }}
              />
            </div>
          </div>
        </>
      )}
    </>
  );
}
