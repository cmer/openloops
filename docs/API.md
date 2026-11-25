# API

The assistant talks to OpenLoops over a JSON API with a bearer token (`API_TOKEN`). The board talks back through a webhook. To connect an assistant without reading all of this, paste [GROKBOT_SETUP_PROMPT.md](GROKBOT_SETUP_PROMPT.md) into it.

## How an assistant should use it

1. Give every real-world loop a stable `external_key` (`ask:email:1842`). The same key updates the same row and returns the same id. Never reuse a key for a different loop.
2. `POST /api/items/upsert` with the open set. Send the real section, not `stalled`. Omit `last_activity_at` on a routine sync so you do not wake a stalled card by accident.
3. `POST /api/items/:id/close` when the loop is resolved. There is no delete.
4. `GET /api/events?since=<cursor>` for actions the webhook missed. `since` is exclusive. Only `user` events are returned.
5. `GET /api/outbox`, act, then `POST /api/outbox/ack` with the ids you handled.
6. `POST /api/sync/complete` so the sidebar can show the sync time.
7. If you relay messages to other bots, `PUT /api/bots` with the current list whenever it changes, so the message box can offer them after `@`.

A reply stays open until you close the card. A choice is already done; do the thing they picked. A drop means do not recreate that key. A snooze means stay quiet until `value`. A move is the person correcting your filing. [GROKBOT_SETUP_PROMPT.md](GROKBOT_SETUP_PROMPT.md) is a copy-paste prompt for wiring an assistant that has routines, a webhook trigger, memory, and a secrets store.


## Webhook

The server POSTs once, with an 8 second timeout. The browser does not call the assistant.

```http
POST /openloops
Host: hooks.example
Content-Type: application/json
Authorization: Bearer <WEBHOOK_KEY>
X-Automation-Key: <WEBHOOK_KEY>
```

```json
{
  "type": "done",
  "item_id": 12,
  "external_key": "loop-12",
  "title": "Send the sample note",
  "value": null,
  "at": "2026-11-25T18:04:00.000Z"
}
```

`type` is `done`, `snooze`, `drop`, `reply`, `choose`, `move`, or `message`.

| type | `value` |
| --- | --- |
| `done` | `null`. The card is done. |
| `drop` | `null`. The card is dropped. |
| `snooze` | ISO time the card is hidden until. |
| `reply` | The reply text. The card stays open. |
| `choose` | The chosen option's `value`. The card is done. |
| `move` | The new section id. |
| `message` | The message text. `item_id`, `external_key`, and `title` are `null`. When the person tagged another bot, `to` is its handle and `to_name` its name; pass the message on to that bot. Messages for the assistant itself have no `to`. |

This is a shared secret on HTTPS, not a signature over the body. Verify it by comparing `Authorization` (after the `Bearer ` prefix) or `X-Automation-Key` to `WEBHOOK_KEY` with a constant-time compare. Reject the request when neither matches. Do not log the headers. Both headers carry the same key so a receiver that only looks at one of them still works.

If the POST fails or the URL is unset, the same JSON is stored in the outbox. The assistant drains it with the API below. The same actions are also in `GET /api/events`, so a missed webhook can be replayed from there.

## Endpoints

Set `BASE` and `API_TOKEN`. Every `/api` route requires the bearer token. `GET /healthz` does not. Browser routes are separate and listed at the end. Access protection for them is in [SELF_HOSTING.md](SELF_HOSTING.md).

```bash
export BASE=http://localhost:4732
export API_TOKEN=choose-a-long-random-string
```

### GET /healthz

```bash
curl -s "$BASE/healthz"
```

```json
{ "ok": true }
```

### POST /api/items/upsert

One object or an array. Matched on `external_key`. Without `external_key`, each call creates a row.

Sections: `decision`, `action`, `question_for_you`, `question_from_you`, `stalled`, `waiting_on_others`, `done`.

Status: `open`, `done`, `dropped`, `snoozed`. `who` is an alias for `owner`. `options` is `[{ "label", "value" }]`.

```bash
curl -s -X POST "$BASE/api/items/upsert" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"external_key":"demo-1","section":"action","title":"Send the sample note","source":"chat"}'
```

```bash
curl -s -X POST "$BASE/api/items/upsert" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[{"external_key":"demo-1","section":"action","title":"Send the sample note"},{"external_key":"demo-2","section":"decision","title":"Pick a color","options":[{"label":"Green","value":"green"}]}]'
```

```json
{
  "ids": [1, 2],
  "items": [
    { "id": 1, "external_key": "demo-1", "created": false },
    { "id": 2, "external_key": "demo-2", "created": true }
  ]
}
```

A card looks like this wherever an item is returned:

```json
{
  "id": 1,
  "external_key": "demo-1",
  "section": "action",
  "original_section": null,
  "title": "Send the sample note",
  "body": null,
  "source": "chat",
  "link": null,
  "owner": null,
  "options": null,
  "choice": null,
  "last_reply": null,
  "due_at": null,
  "snoozed_until": null,
  "created_at": "2026-11-25T12:00:00.000Z",
  "updated_at": "2026-11-25T12:00:00.000Z",
  "last_activity_at": "2026-11-25T12:00:00.000Z",
  "closed_at": null,
  "status": "open"
}
```

### PATCH /api/items/:id

Any card field. Example: due date, owner, section, status, `snoozed_until`.

```bash
curl -s -X PATCH "$BASE/api/items/1" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"due_at":"2026-12-01T15:00:00.000Z","owner":"Northwind Supply","section":"waiting_on_others"}'
```

```json
{ "item": { "id": 1, "owner": "Northwind Supply", "section": "waiting_on_others" } }
```

### POST /api/items/:id/close

`status` is `done` or `dropped`. `note` is optional and stored on the event.

```bash
curl -s -X POST "$BASE/api/items/1/close" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"done","note":"Handled"}'
```

```json
{ "item": { "id": 1, "status": "done", "closed_at": "2026-11-25T18:04:00.000Z" } }
```

### GET /api/items

Optional `status` and `section`.

```bash
curl -s "$BASE/api/items?status=open&section=action" \
  -H "Authorization: Bearer $API_TOKEN"
```

```json
{ "items": [] }
```

### GET /api/events

Actions taken on the board only (`actor` is `user`), oldest first. `since` is exclusive. Assistant upserts are not included.

```bash
curl -s "$BASE/api/events?since=2026-01-01T00:00:00.000Z" \
  -H "Authorization: Bearer $API_TOKEN"
```

```json
{
  "events": [
    {
      "id": 4,
      "item_id": 12,
      "actor": "user",
      "type": "done",
      "payload": { "value": null, "title": "Send the sample note", "external_key": "loop-12" },
      "created_at": "2026-11-25T18:04:00.000Z"
    }
  ]
}
```

### POST /api/sync/complete

Stores the "last synced" time shown in the sidebar. `at` is optional and defaults to now.

```bash
curl -s -X POST "$BASE/api/sync/complete" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"at":"2026-11-25T12:00:00.000Z"}'
```

```json
{ "last_synced_at": "2026-11-25T12:00:00.000Z" }
```

### PUT /api/bots

Replaces the list of other bots the message box offers after `@`. Send the whole list each time; an empty list removes them all. The assistant itself is always first and is not part of the list. Messages to any bot still go to the assistant's webhook, with `to` set (see [Webhook](#webhook)), and the assistant passes them on.

Each bot needs a `name` (up to 60 characters). `handle` is optional: by default it comes from the name, lowercased, with accents removed and spaces and punctuation turned into underscores, so `Email Bot` becomes `email_bot`. Pass `handle` (lowercase letters, digits, `_`, `-`, up to 32) to keep a tag stable when a name changes. `description` (up to 200) shows in the autocomplete. At most 50 bots. A bot whose handle matches the assistant's is skipped and listed in `skipped`.

```bash
curl -s -X PUT "$BASE/api/bots" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"bots":[{"name":"Email Bot","description":"Drafts replies"},{"name":"Calendar","handle":"cal"}]}'
```

```json
{
  "bots": [
    { "handle": "assistant", "name": "Assistant", "description": null, "primary": true },
    { "handle": "email_bot", "name": "Email Bot", "description": "Drafts replies", "primary": false },
    { "handle": "cal", "name": "Calendar", "description": null, "primary": false }
  ],
  "skipped": []
}
```

`GET /api/bots` returns the same `bots` list.

### GET /api/outbox

Undelivered webhook bodies, oldest first.

```bash
curl -s "$BASE/api/outbox" \
  -H "Authorization: Bearer $API_TOKEN"
```

```json
{
  "events": [
    {
      "id": 1,
      "created_at": "2026-11-25T18:04:00.000Z",
      "payload": {
        "type": "done",
        "item_id": 12,
        "external_key": "loop-12",
        "title": "Send the sample note",
        "value": null,
        "at": "2026-11-25T18:04:00.000Z"
      }
    }
  ]
}
```

### POST /api/outbox/ack

```bash
curl -s -X POST "$BASE/api/outbox/ack" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ids":[1]}'
```

```json
{ "acked": 1 }
```

### Browser routes

These are for the page. They require Access (or a local escape hatch). They do not accept `API_TOKEN`.

| Method and path | Body | Response |
| --- | --- | --- |
| `GET /hq/board` | | `{ generated_at, assistant_name, last_synced_at, outbox_count, items }` |
| `GET /hq/items/:id` | | `{ item, events }` |
| `POST /hq/items/:id/act` | `{ "type": "done" \| "snooze" \| "drop" \| "reply" \| "choose" \| "move", "value"?: "..." }` | `{ ok, delivered, outbox_count, item }` |
| `GET /hq/bots` | | `{ bots }`, the same list as `GET /api/bots` |
| `POST /hq/message` | `{ "text": "...", "to"?: "handle" }` | `{ ok, delivered, outbox_count, to }` |

Without `to`, a message that starts with `@handle ` for a known bot goes to that bot, minus the tag. Any other leading `@word` stays in the text and goes to the assistant. An unknown `to` is a 400.

`snooze` needs a future ISO `value`. `reply` and `choose` need `value`. `move` needs a section other than `done`.

## Limits

Limits enforced by the API: title 300 characters, body 20,000, source / owner / external key / choice 200, option label and value 120, at most 12 options, reply / note / message 4,000, 200 cards per upsert, 500 outbox ids per ack, request body 1,000,000 bytes.
