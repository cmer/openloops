import type { Section } from "../../shared/types";

export type SectionFilter = "all" | Section;

export const SECTION_LABEL: Record<Section, string> = {
  decision: "Needs your decision",
  action: "Needs your action",
  question_for_you: "Questions waiting on you",
  question_from_you: "Your questions still open",
  stalled: "Stalled",
  waiting_on_others: "Waiting on others",
  done: "Recently done",
};

export const BOARD_SECTIONS: { id: Section; title: string }[] = (
  ["decision", "action", "question_for_you", "question_from_you", "stalled", "waiting_on_others", "done"] as const
).map((id) => ({ id, title: SECTION_LABEL[id] }));

export function sectionHint(id: Section, assistantName: string): string {
  switch (id) {
    case "decision":
      return `Pick one. ${assistantName} will take it from here.`;
    case "action":
      return "Only you can move these.";
    case "question_for_you":
      return `${assistantName} is blocked on an answer.`;
    case "question_from_you":
      return "You asked, and nobody has answered.";
    case "stalled":
      return "No activity for a week or more.";
    case "waiting_on_others":
      return "Parked on someone else.";
    case "done":
      return "Closed in the last 7 days.";
  }
}

export function isSectionFilter(value: string | null): value is SectionFilter {
  return value === "all" || BOARD_SECTIONS.some((section) => section.id === value);
}
