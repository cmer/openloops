import type { Section } from "../../shared/types";

export const BOARD_SECTIONS: { id: Section; title: string }[] = [
  { id: "decision", title: "Needs your decision" },
  { id: "action", title: "Needs your action" },
  { id: "question_for_you", title: "Questions waiting on you" },
  { id: "question_from_you", title: "Your questions still open" },
  { id: "stalled", title: "Stalled" },
  { id: "waiting_on_others", title: "Waiting on others" },
  { id: "done", title: "Recently done" },
];

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

export const SECTION_LABEL: Record<Section, string> = {
  decision: "Needs your decision",
  action: "Needs your action",
  question_for_you: "Questions waiting on you",
  question_from_you: "Your questions still open",
  stalled: "Stalled",
  waiting_on_others: "Waiting on others",
  done: "Recently done",
};

export const SECTION_CHIP: Record<Section, [string, string]> = {
  decision: ["decision", "decisions"],
  action: ["action", "actions"],
  question_for_you: ["question for you", "questions for you"],
  question_from_you: ["question you asked", "questions you asked"],
  stalled: ["stalled", "stalled"],
  waiting_on_others: ["waiting", "waiting"],
  done: ["done", "done"],
};
