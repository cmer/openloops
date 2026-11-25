import { useRef, useState, useSyncExternalStore } from "react";
import type { Item, Section } from "../../shared/types";
import type { Groups } from "./order";
import { BOARD_SECTIONS, SECTION_LABEL } from "./sections";
import { ageDays, ageLabel, formatDay, isOverdue } from "./time";

const fine = typeof window !== "undefined" ? window.matchMedia("(pointer: fine)") : null;

function useFinePointer(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      fine?.addEventListener("change", onChange);
      return () => fine?.removeEventListener("change", onChange);
    },
    () => Boolean(fine?.matches),
    () => false,
  );
}

const groupOf = (item: Item): Section => (item.status === "done" ? "done" : item.section);

export function KanbanBoard({
  groups,
  now,
  onOpen,
  onMove,
}: {
  groups: Groups;
  now: number;
  onOpen: (item: Item) => void;
  onMove: (item: Item, section: Section) => void;
}) {
  const canDrag = useFinePointer();
  const [dragId, setDragId] = useState<number | null>(null);
  const [target, setTarget] = useState<Section | null>(null);
  const items = BOARD_SECTIONS.flatMap((section) => groups[section.id]);
  const dragged = dragId == null ? undefined : items.find((item) => item.id === dragId);
  const accepts = (column: Section) => Boolean(dragged) && dragged?.status === "open" && column !== "done" && column !== groupOf(dragged!);

  // Empty columns stay (narrow) so Stalled and Decision are always drop targets. Recently done hides when empty.
  const columns = BOARD_SECTIONS.filter((section) => section.id !== "done" || groups.done.length > 0);

  return (
    <>
      <p className="ol-board-help">
        {canDrag
          ? "Click a card to open it. Drag an open card to another column to move it."
          : "Tap a card to open it. Swipe sideways for more columns."}
      </p>
      <div className="ol-board">
        {columns.map((section) => {
          const list = groups[section.id];
          return (
            <section
              key={section.id}
              aria-label={section.title}
              data-col={section.id}
              className={`ol-col${section.id === "done" ? " ol-col--done" : ""}${target === section.id ? " is-target" : ""}`}
              style={list.length ? undefined : { maxWidth: "12rem" }}
              onDragOver={(event) => {
                if (!accepts(section.id)) return;
                event.preventDefault();
                setTarget(section.id);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTarget(null);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragged && accepts(section.id)) onMove(dragged, section.id);
                setTarget(null);
                setDragId(null);
              }}
            >
              <div className="ol-col-head">
                <h2>{section.title}</h2>
                <b>{list.length}</b>
              </div>
              <div className="ol-col-list">
                {list.length ? (
                  list.map((item) => (
                    <KanbanCard
                      key={item.id}
                      item={item}
                      now={now}
                      draggable={canDrag && item.status === "open"}
                      dragging={dragId === item.id}
                      onOpen={() => onOpen(item)}
                      onDragStart={() => setDragId(item.id)}
                      onDragEnd={() => {
                        setDragId(null);
                        setTarget(null);
                      }}
                    />
                  ))
                ) : (
                  <p className="ol-col-empty">Nothing here.</p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

function KanbanCard({
  item,
  now,
  draggable,
  dragging,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  item: Item;
  now: number;
  draggable: boolean;
  dragging: boolean;
  onOpen: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const suppressClick = useRef(false);
  const days = ageDays(item.created_at, now);
  const overdue = isOverdue(item, now);
  const stalled = groupOf(item) === "stalled";
  const cls = ["ol-kcard", overdue && "is-overdue", stalled && "is-stalled", item.status === "done" && "is-done", dragging && "is-dragging"]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      className={cls}
      draggable={draggable}
      onClick={() => {
        if (!suppressClick.current) onOpen();
      }}
      onDragStart={(event) => {
        suppressClick.current = true;
        event.dataTransfer.setData("text/plain", String(item.id));
        event.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={() => {
        onDragEnd();
        window.setTimeout(() => {
          suppressClick.current = false;
        }, 0);
      }}
    >
      <span className="ol-kcard-top">
        <span>
          #{item.id} · <span style={days > 7 ? { color: "var(--ol-old)" } : undefined}>{ageLabel(days)}</span>
        </span>
        <span>
          {item.status === "done" && item.closed_at ? (
            `Closed ${formatDay(item.closed_at)}`
          ) : overdue && item.due_at ? (
            <span className="is-overdue">Overdue · {formatDay(item.due_at)}</span>
          ) : item.due_at ? (
            `Due ${formatDay(item.due_at)}`
          ) : null}
        </span>
      </span>
      <span className="ol-src">{item.source}</span>
      <span className="ol-title sensitive">{item.title}</span>
      {stalled && item.original_section && <span className="ol-flag ol-flag--stalled">Was: {SECTION_LABEL[item.original_section]}</span>}
    </button>
  );
}
