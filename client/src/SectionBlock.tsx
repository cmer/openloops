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
}: {
  id: Section;
  title: string;
  hint: string;
  items: Item[];
  renderItem: (item: Item) => ReactNode;
}) {
  const [all, setAll] = useState(false);
  const extra = items.length - CAP;
  const shown = all ? items : items.slice(0, CAP);
  return (
    <section id={`sec-${id}`} className={`ol-section${id === "done" ? " ol-section--done" : ""}`} aria-labelledby={`h-${id}`}>
      <div className="ol-section-head">
        <span className="ol-section-count">{items.length}</span>
        <div className="ol-section-title">
          <h2 id={`h-${id}`}>{title}</h2>
          <p>{hint}</p>
        </div>
      </div>
      {shown.map(renderItem)}
      {extra > 0 && (
        <button type="button" className="ol-more" onClick={() => setAll((current) => !current)}>
          {all ? "Show less" : `Show ${extra} more`}
        </button>
      )}
    </section>
  );
}
