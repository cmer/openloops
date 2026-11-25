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

/** A left sidebar from 900px up. Below that the same markup becomes a top bar with swipeable
 *  section tabs, and Refresh / Blur / Theme move into the "More" menu (CSS only). */
export function Sidebar(props: Props) {
  const openCount = props.items.filter((item) => item.status === "open").length;
  const overdueCount = props.items.filter((item) => isOverdue(item, props.now)).length;
  const current: SectionFilter = props.view === "list" ? props.filter : "all";

  const navItem = (id: SectionFilter, label: string, count: number, late: number) => (
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
        <Btn size="sm" onClick={props.onRefresh} disabled={props.refreshing}>
          {props.refreshing ? "Refreshing…" : "Refresh"}
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
        <span className="ol-kicker">You + {name}</span>
        <details className="ol-menu">
          <summary className="ol-btn ol-btn--sm">More</summary>
          <div className="ol-menu-pop">{tools("menu")}</div>
        </details>
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
        <span className={`ol-sync${props.lastSyncedAt ? "" : " is-stale"}`}>
          {!props.loaded
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
        {navItem("all", "Everything", openCount, overdueCount)}
        <div className="ol-nav-sep" role="presentation" />
        {BOARD_SECTIONS.map((section) => {
          const list = props.groups[section.id];
          return [
            section.id === "done" ? <div key="sep-done" className="ol-nav-sep" role="presentation" /> : null,
            navItem(section.id, section.title, list.length, list.filter((item) => isOverdue(item, props.now)).length),
          ];
        })}
      </nav>

      <div className="ol-side-foot">{tools("side")}</div>
    </aside>
  );
}

export function Topbar({
  assistantName,
  view,
  filter,
  onView,
}: {
  assistantName: string;
  view: BoardView;
  filter: SectionFilter;
  onView: (view: BoardView) => void;
}) {
  const section = filter === "all" ? undefined : BOARD_SECTIONS.find((entry) => entry.id === filter);
  const title = view === "kanban" ? "Board" : section ? section.title : "Everything";
  const hint =
    view === "kanban"
      ? "Every section as a column."
      : section
        ? sectionHint(section.id, assistantName)
        : "Everything open, in the order to work it.";
  return (
    <div className="ol-topbar">
      <div>
        <h1>{title}</h1>
        <p>{hint}</p>
      </div>
      <div className="ol-seg" role="group" aria-label="Layout">
        <Btn size="sm" aria-pressed={view === "list"} onClick={() => onView("list")}>
          List
        </Btn>
        <Btn size="sm" aria-pressed={view === "kanban"} onClick={() => onView("kanban")}>
          Kanban
        </Btn>
      </div>
    </div>
  );
}
