# Using the board

How the board behaves, for people using it and for anyone wiring an assistant to it. The API side is in [API.md](API.md).

## Sections

Sections, in order. The sidebar lists every section with its count (empty ones stay, dimmed); the list hides empty sections:

1. Needs your decision (`decision`)
2. Needs your action (`action`)
3. Questions waiting on you (`question_for_you`)
4. Your questions still open (`question_from_you`)
5. Stalled (`stalled`)
6. Waiting on others (`waiting_on_others`)
7. Recently done (`done`, closed in the last 7 days)

## Views

The top bar toggles List and Kanban, and this browser remembers the choice. In the list, click a section in the sidebar to work only that section (Prev/Next, `j` / `k` and auto-advance stay inside it), or Everything for the whole board. In Kanban, a sidebar click scrolls to that column. Kanban columns follow the same order and scroll sideways on a phone. Click a card in either view to open it. On a phone the sidebar becomes swipeable tabs and the editor is a full-screen sheet. The theme follows the system, or pick Light or Dark.

## Shortcuts and actions

Shortcuts in the editor: `d` done, `s` snooze until tomorrow, `x` drop, `r` reply, `j` / `k` or the arrow keys for the next and previous card, and Esc to close. After an action, the editor moves to the next open card. On a desktop with a mouse, drag an open card onto another column. The Done column is not a drop target. A drag updates the section and sends a webhook with type `move`.

## Cards

A list card shows the title, source, age in days (older than 7 days is highlighted), due date, link, and an expandable markdown note. A kanban card shows the title, source, age, and due date. The editor has the full note, the link, who it belongs to, the event history, and the actions: decision options, Done, Snooze (tomorrow, Friday, next week, or a date, each at 09:00 local), Drop, and Reply. Choosing an option marks the card done. A reply stays on the card until the assistant closes it. The list shows seven cards in a section, then a control to show the rest.

## Snooze and stall

Snoozed cards are hidden until `snoozed_until`, then they come back. An open card with no activity for 7 days moves to Stalled and keeps its previous section in `original_section`. A later edit, reply, or patch brings it back. Re-upserting the same title with the original section does not clear the stall, so a routine sync will not undo it. Omit `last_activity_at` on those upserts unless you mean to set the clock.

## Sidebar and messages

The sidebar shows counts, overdue items, the last time the assistant called `POST /api/sync/complete`, and how many webhook events are still queued. Blur for sharing hides titles and notes. The board refreshes every 60 seconds. Actions update the page immediately, then the server confirms them. The message box above the board sends a freeform note to the assistant. It does not become a card. Typing `@` offers the assistant and any other bots it published with `PUT /api/bots`; a tagged message still goes to the assistant's webhook, with `to` set, for it to relay.
