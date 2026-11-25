import { useEffect, useRef, useState } from "react";
import type { Item, Section } from "../../shared/types";
import { ageDays, ageLabel, formatDay } from "./time";

export function KanbanBoard({
  groups,
  now,
  onOpen,
  onMove,
}: {
  groups: { id: Section; title: string; items: Item[] }[];
  now: number;
  onOpen: (item: Item) => void;
  onMove: (item: Item, section: Section) => void;
}) {
  const [over, setOver] = useState<Section | null>(null);
  const [finePointer, setFinePointer] = useState(false);
  const dragId = useRef<number | null>(null);
  const items = groups.flatMap((group) => group.items);

  useEffect(() => {
    const query = window.matchMedia("(pointer: fine)");
    const update = () => setFinePointer(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  function dropOn(section: Section) {
    const id = dragId.current;
    dragId.current = null;
    setOver(null);
    if (id == null || section === "done") return;
    const item = items.find((entry) => entry.id === id);
    if (!item || item.status !== "open" || item.section === section) return;
    onMove(item, section);
  }

  return (
    <div>
      <p className="mx-auto mb-3 max-w-3xl px-4 text-sm text-muted">
        Tap a card to open it. Swipe sideways for more columns. With a mouse, drag a card to another column.
      </p>
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4">
        {groups.map((group) => {
          const droppable = group.id !== "done";
          return (
            <section
              key={group.id}
              aria-label={group.title}
              onDragOver={(event) => {
                if (!droppable || dragId.current == null) return;
                event.preventDefault();
                setOver(group.id);
              }}
              onDragLeave={() => setOver((current) => (current === group.id ? null : current))}
              onDrop={(event) => {
                if (!droppable) return;
                event.preventDefault();
                dropOn(group.id);
              }}
              className={`flex w-[82vw] shrink-0 snap-start flex-col rounded-2xl border bg-card/60 sm:w-72 ${
                over === group.id ? "border-pine ring-2 ring-pine" : "border-line"
              }`}
            >
              <header className="flex items-baseline justify-between gap-2 px-3 py-3">
                <h2 className="font-serif text-lg leading-tight">{group.title}</h2>
                <span className="text-sm text-muted">{group.items.length}</span>
              </header>
              <div className="flex max-h-[calc(100dvh-16rem)] flex-col gap-2 overflow-y-auto px-3 pb-3">
                {group.items.length === 0 && <p className="px-1 py-4 text-sm text-muted">Nothing here.</p>}
                {group.items.map((item) => (
                  <KanbanCard
                    key={item.id}
                    item={item}
                    now={now}
                    draggable={finePointer && item.status === "open"}
                    onOpen={onOpen}
                    onDragStart={() => {
                      dragId.current = item.id;
                    }}
                    onDragEnd={() => {
                      dragId.current = null;
                      setOver(null);
                    }}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function KanbanCard({
  item,
  now,
  draggable,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  item: Item;
  now: number;
  draggable: boolean;
  onOpen: (item: Item) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const suppressClick = useRef(false);
  const days = ageDays(item.created_at, now);
  const old = days > 7;
  const overdue = Boolean(item.due_at && item.status === "open" && Date.parse(item.due_at) < now);

  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={(event) => {
        suppressClick.current = true;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(item.id));
        onDragStart();
      }}
      onDragEnd={() => {
        onDragEnd();
        window.setTimeout(() => {
          suppressClick.current = false;
        }, 0);
      }}
      onClick={() => {
        if (suppressClick.current) return;
        onOpen(item);
      }}
      className={`w-full rounded-xl border bg-card px-3 py-3 text-left ${
        old ? "border-rust/40" : "border-line"
      } ${draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
    >
      <span className="flex flex-wrap items-center gap-1.5 text-xs">
        {item.source && <span className="rounded-full bg-pine-soft px-2 py-0.5 font-medium text-pine">{item.source}</span>}
        <span className={old ? "rounded-full bg-rust-soft px-2 py-0.5 font-medium text-rust" : "text-muted"}>
          {ageLabel(days)}
        </span>
        {item.due_at && (
          <span className={overdue ? "font-medium text-rust" : "text-muted"}>
            {overdue ? "Overdue" : "Due"} {formatDay(item.due_at)}
          </span>
        )}
      </span>
      <span className="sensitive mt-2 block font-serif text-lg leading-snug text-ink">{item.title}</span>
    </button>
  );
}
