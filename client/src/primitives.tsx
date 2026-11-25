import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Item } from "../../shared/types";
import { SECTION_LABEL } from "./sections";
import { ageDays, ageLabel, formatDay, hostname, isOverdue } from "./time";

type Variant = "default" | "primary" | "quiet" | "drop" | "armed";

export function Btn({
  variant = "default",
  size,
  k,
  pending,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm";
  k?: string;
  pending?: boolean;
  children: ReactNode;
}) {
  const cls = ["ol-btn", variant !== "default" && `ol-btn--${variant}`, size === "sm" && "ol-btn--sm", pending && "is-pending", className]
    .filter(Boolean)
    .join(" ");
  return (
    <button type="button" className={cls} {...rest}>
      {children}
      {k && (
        <span className="ol-key" aria-hidden="true">
          {k}
        </span>
      )}
    </button>
  );
}

const groupOf = (item: Item) => (item.status === "done" ? "done" : item.section);

/** Left column of a list entry: #id, due or closed date, Overdue flag. */
export function Gutter({ item, now }: { item: Item; now: number }) {
  const overdue = isOverdue(item, now);
  const cls = ["ol-gut", overdue && "is-overdue", item.status === "done" && "is-done", groupOf(item) === "stalled" && "is-stalled"]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls}>
      <span className="ol-gut-id">#{item.id}</span>
      {item.status === "done" && item.closed_at ? (
        <>
          <span className="ol-gut-label">Closed</span>
          <span className="ol-gut-date">{formatDay(item.closed_at)}</span>
        </>
      ) : item.due_at ? (
        <>
          <span className="ol-gut-label">Due</span>
          <span className="ol-gut-date">{formatDay(item.due_at)}</span>
          {overdue && <span className="ol-flag ol-flag--overdue">Overdue</span>}
        </>
      ) : (
        <span className="ol-gut-none">No date</span>
      )}
    </div>
  );
}

export function Age({ item, now }: { item: Item; now: number }) {
  const days = ageDays(item.created_at, now);
  return <span className={`ol-age${days > 7 ? " is-old" : ""}`}>{ageLabel(days)}</span>;
}

export function WasFlag({ item }: { item: Item }) {
  if (groupOf(item) !== "stalled" || !item.original_section) return null;
  return <span className="ol-flag ol-flag--stalled">Was: {SECTION_LABEL[item.original_section]}</span>;
}

export function HostLink({ url }: { url: string }) {
  return (
    <a className="ol-link" href={url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
      {hostname(url)} ↗
    </a>
  );
}

export function choiceLabel(item: Item): string {
  return item.options?.find((option) => option.value === item.choice)?.label ?? item.choice ?? "";
}
