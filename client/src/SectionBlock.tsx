import { useState, type ReactNode } from "react";
import type { Item, Section } from "../../shared/types";

const CAP = 7;

/** One sheet per section, with the 7-card cap. The caller leaves out empty sections. */
export function SectionBlock({
  id,
  title,
  hint,
  items,
  renderItem,
  collapsed = false,
  onToggle,
}: {
  id: Section;
  title: string;
  hint: string;
  items: Item[];
  renderItem: (item: Item) => ReactNode;
  /** When set, the title becomes a toggle that hides the section's cards. */
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const [all, setAll] = useState(false);
  const extra = items.length - CAP;
  const shown = all ? items : items.slice(0, CAP);
  return (
    <section
      id={`sec-${id}`}
      className={`ol-section${id === "done" ? " ol-section--done" : ""}${collapsed ? " is-collapsed" : ""}`}
      aria-labelledby={`h-${id}`}
    >
      <div className="ol-section-head">
        <span className="ol-section-count">{items.length}</span>
        <div className="ol-section-title">
          <h2 id={`h-${id}`}>
            {onToggle ? (
              <button type="button" className="ol-collapse" aria-expanded={!collapsed} aria-controls={`list-${id}`} onClick={onToggle}>
                <Chevron open={!collapsed} />
                {title}
              </button>
            ) : (
              title
            )}
          </h2>
          <p>{hint}</p>
        </div>
      </div>
      {!collapsed && (
        <div id={`list-${id}`} className="ol-section-list">
          {shown.map(renderItem)}
          {extra > 0 && (
            <button type="button" className="ol-more" onClick={() => setAll((current) => !current)}>
              {all ? "Show less" : `Show ${extra} more`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`ol-chevron${open ? " is-open" : ""}`} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
