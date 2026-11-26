export const SECTIONS = [
  "decision",
  "action",
  "question_for_you",
  "question_from_you",
  "stalled",
  "waiting_on_others",
  "done",
] as const;

export type Section = (typeof SECTIONS)[number];

export const STATUSES = ["open", "done", "dropped", "snoozed"] as const;

export type ItemStatus = (typeof STATUSES)[number];

export const USER_ACTIONS = ["done", "snooze", "drop", "reply", "choose", "move"] as const;

export type UserActionType = (typeof USER_ACTIONS)[number];

/** A second Refresh inside this window returns the pending request and does not send another webhook. */
export const REFRESH_WAIT_MS = 10 * 60 * 1000;

/** Shown on the board while a refresh is waiting for POST /api/sync/complete. */
export type RefreshState = {
  pending: boolean;
  requested_at: string | null;
};

export type Option = {
  label: string;
  value: string;
};

export type Item = {
  id: number;
  external_key: string | null;
  section: Section;
  original_section: Section | null;
  title: string;
  body: string | null;
  source: string | null;
  link: string | null;
  owner: string | null;
  options: Option[] | null;
  choice: string | null;
  last_reply: string | null;
  due_at: string | null;
  snoozed_until: string | null;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
  closed_at: string | null;
  status: ItemStatus;
};

export function isSection(value: string): value is Section {
  return (SECTIONS as readonly string[]).includes(value);
}

export function isStatus(value: string): value is ItemStatus {
  return (STATUSES as readonly string[]).includes(value);
}

export function isUserAction(value: string): value is UserActionType {
  return (USER_ACTIONS as readonly string[]).includes(value);
}
