# OpenLoops

OpenLoops is a self-hosted board for the open loops between you and an assistant: decisions, actions, questions, stalled threads, and what is waiting on someone else.

You use the page, on a phone or a desktop. The page saves the action immediately and the server notifies the assistant. The assistant pushes and updates cards through the JSON API.

The app has no user login. It assumes it sits behind Cloudflare Tunnel and Cloudflare Access, and it refuses to serve the UI unless that protection is actually in place. The browser never sees `API_TOKEN` or the webhook key.

The assistant's display name is `ASSISTANT_NAME`. It defaults to Assistant.

## Screenshots

Screenshots of the list, the kanban board, and the card editor go in `docs/screenshots/`. None are checked in yet.

```text
docs/screenshots/list.png
docs/screenshots/kanban.png
docs/screenshots/card.png
```

## Features

Sections, in order. The sidebar lists every section with its count (empty ones stay, dimmed); the list hides empty sections:

1. Needs your decision (`decision`)
2. Needs your action (`action`)
3. Questions waiting on you (`question_for_you`)
4. Your questions still open (`question_from_you`)
5. Stalled (`stalled`)
6. Waiting on others (`waiting_on_others`)
7. Recently done (`done`, closed in the last 7 days)

The top bar toggles List and Kanban, and this browser remembers the choice. In the list, click a section in the sidebar to work only that section (Prev/Next, `j` / `k` and auto-advance stay inside it), or Everything for the whole board. In Kanban, a sidebar click scrolls to that column. Kanban columns follow the same order and scroll sideways on a phone. Click a card in either view to open it. On a phone the sidebar becomes swipeable tabs and the editor is a full-screen sheet. The theme follows the system, or pick Light or Dark.

Shortcuts in the editor: `d` done, `s` snooze until tomorrow, `x` drop, `r` reply, `j` / `k` or the arrow keys for the next and previous card, and Esc to close. After an action, the editor moves to the next open card. On a desktop with a mouse, drag an open card onto another column. The Done column is not a drop target. A drag updates the section and sends a webhook with type `move`.

A list card shows the title, source, age in days (older than 7 days is highlighted), due date, link, and an expandable markdown note. A kanban card shows the title, source, age, and due date. The editor has the full note, the link, who it belongs to, the event history, and the actions: decision options, Done, Snooze (tomorrow, Friday, next week, or a date, each at 09:00 local), Drop, and Reply. Choosing an option marks the card done. A reply stays on the card until the assistant closes it. The list shows seven cards in a section, then a control to show the rest.

Snoozed cards are hidden until `snoozed_until`, then they come back. An open card with no activity for 7 days moves to Stalled and keeps its previous section in `original_section`. A later edit, reply, or patch brings it back. Re-upserting the same title with the original section does not clear the stall, so a routine sync will not undo it. Omit `last_activity_at` on those upserts unless you mean to set the clock.

The sidebar shows counts, overdue items, the last time the assistant called `POST /api/sync/complete`, and how many webhook events are still queued. Blur for sharing hides titles and notes. The board refreshes every 60 seconds. Actions update the page immediately, then the server confirms them. The message box above the board sends a freeform note to the assistant. It does not become a card.

Limits enforced by the API: title 300 characters, body 20,000, source / owner / external key / choice 200, option label and value 120, at most 12 options, reply / note / ping 4,000, 200 cards per upsert, 500 outbox ids per ack, request body 1,000,000 bytes.

## Architecture

One process. A React + Vite + TypeScript client, and a Hono server with SQLite (`better-sqlite3`). In production the same process serves the built UI and the API. In development, Vite serves the UI on port 4731 and proxies `/hq`, `/api`, and `/healthz` to the API on port 4732.

```text
browser  --Cloudflare Access-->  UI and /hq/*
assistant --Bearer API_TOKEN-->  /api/*
probe    ---------------------->  /healthz
server   --webhook POST-------->  assistant
```

User actions are stored, then posted once to `WEBHOOK_URL` with an 8 second timeout. If the URL is empty or the POST fails, the same JSON is queued in an outbox the assistant can drain. SQLite lives at `DATABASE_PATH` (default `./data/openloops.db`, `/data/openloops.db` in Docker).

Actors stored on events are `user` (someone on the board) and `assistant` (API upserts, patches, and closes).

## Quick start

Node is not required on the host. Docker is.

```bash
export API_TOKEN="$(openssl rand -hex 32)"
export WEBHOOK_URL="https://hooks.example/openloops"
export WEBHOOK_KEY="$(openssl rand -hex 32)"
export ASSISTANT_NAME="Assistant"

docker compose up --build -d
docker compose exec openloops node dist/scripts/seed.js
```

Open `http://localhost:4732`. The compose file sets `INSECURE_ALLOW_UNPROTECTED=1` so this works from the published port. The SQLite file is in the `openloops-data` volume.

Seed data is fictional (a made-up bakery, a mascot, Northwind Supply) and safe to load again. Re-running refreshes the sample dates.

`docker-compose.example.yml` is the same file. Copy it to `docker-compose.yml` if you start from the example.

Remove `INSECURE_ALLOW_UNPROTECTED` before anyone but you can reach the port. The next section is how.

## Environment

Copy `.env.example`. Do not commit a filled-in `.env`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `API_TOKEN` | for the assistant | Bearer token for every `/api` route. If it is empty, `/api` returns 401. Compared in constant time. |
| `WEBHOOK_URL` | for delivery | Where the server POSTs each action from the board. If it is empty, actions are saved and queued in the outbox. |
| `WEBHOOK_KEY` | with the webhook | Sent as `Authorization: Bearer <key>` and `X-Automation-Key: <key>`. |
| `ASSISTANT_NAME` | no | Name in the sidebar, message box, and history. Default `Assistant`. Trimmed, control characters removed, capped at 60 characters. |
| `CF_ACCESS_TEAM_DOMAIN` | to serve the UI publicly | Team host, for example `team.cloudflareaccess.com`. `https://` and a trailing slash are accepted. Any other host is rejected. |
| `CF_ACCESS_AUD` | with the team domain | Audience (AUD) tag of the Access application. |
| `INSECURE_ALLOW_UNPROTECTED` | local only | Set to `1` to serve the UI with no Access check. Ignored once both Access variables are valid. The process logs a warning when a request is served this way. |
| `PORT` | no | Default `4732`. |
| `DATABASE_PATH` | no | Default `./data/openloops.db`. Docker uses `/data/openloops.db`. |
| `NODE_ENV` | no | `production` in the image, which turns on the built UI. |

## Cloudflare Tunnel and Access

The UI routes (`/`, static files, `/hq/board`, `/hq/items/:id`, `/hq/items/:id/act`, `/hq/message`) are not a login form. They require a Cloudflare Access JWT (`Cf-Access-Jwt-Assertion`, or the `CF_Authorization` cookie) signed by the team's keys. `/api` keeps using `API_TOKEN`. `/healthz` stays open so Docker and the tunnel can probe it.

Access usually bypasses `/api` and `/healthz`. The app still checks the bearer token on `/api`.

1. Run the container on the machine that will hold the tunnel. Leave it bound to localhost if you can (`127.0.0.1:4732:4732`). The published compose file binds all interfaces for the local quick start.
2. In Cloudflare Zero Trust, create a tunnel and point the public hostname at `http://localhost:4732` (or `http://openloops:4732` if cloudflared shares the Docker network).
3. Create a self-hosted Access application for that hostname. Policy: Allow, include your email or group. Copy the team domain and the application audience (AUD) tag.
4. Add a second self-hosted application, or a path policy, for `/api` and `/healthz` with a **Bypass** decision for everyone. The assistant and the health check should not be challenged by Access. A service token works too, if the assistant can send `Cf-Access-Client-Id` and `Cf-Access-Client-Secret`. Bypass is the simpler match for a client that only knows `API_TOKEN`.
5. Set `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD`. Unset `INSECURE_ALLOW_UNPROTECTED`. Restart the container.
6. Open the public hostname in a browser. Access should prompt, then the board loads. `curl` against the public UI URL without a session should stop at Access. A request that reaches the origin with no valid JWT gets the app's own 403 page.

The server downloads `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, caches the keys for one hour, and refetches once when a token names a key it has not seen. It checks RS256, expiry (60 seconds of skew), `nbf`, `iat`, `aud`, and `iss` (`https://<team>.cloudflareaccess.com`). If the keys cannot be downloaded and there is no cache, the UI returns 503 instead of skipping the check.

Two local escapes, both logged:

- `INSECURE_ALLOW_UNPROTECTED=1` serves the UI to any caller, but only while Access is not configured. A valid team domain and audience still require a JWT. The switch cannot turn a configured check off.
- With neither Access variable set, a request is allowed when the TCP peer is loopback (`127.0.0.1` or `::1`) **and** the Host is `localhost`, `127.0.0.1`, or `::1`. This is `npm start` on the same machine. It is not a Docker published port (the peer is the bridge gateway) and it is not a tunnel: cloudflared connecting to `127.0.0.1` still sends your public Host, and that request is refused.

If the variables are set but invalid, every UI request is refused, including localhost, until they are fixed. The page names the variables and the bypass for `/api` and `/healthz`.

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
| `message` | The ping text. `item_id`, `external_key`, and `title` are `null`. |

This is a shared secret on HTTPS, not a signature over the body. Verify it by comparing `Authorization` (after the `Bearer ` prefix) or `X-Automation-Key` to `WEBHOOK_KEY` with a constant-time compare. Reject the request when neither matches. Do not log the headers. Both headers carry the same key so a receiver that only looks at one of them still works.

If the POST fails or the URL is unset, the same JSON is stored in the outbox. The assistant drains it with the API below. The same actions are also in `GET /api/events`, so a missed webhook can be replayed from there.

## How an assistant should use it

1. Give every real-world loop a stable `external_key` (`ask:email:1842`). The same key updates the same row and returns the same id. Never reuse a key for a different loop.
2. `POST /api/items/upsert` with the open set. Send the real section, not `stalled`. Omit `last_activity_at` on a routine sync so you do not wake a stalled card by accident.
3. `POST /api/items/:id/close` when the loop is resolved. There is no delete.
4. `GET /api/events?since=<cursor>` for actions the webhook missed. `since` is exclusive. Only `user` events are returned.
5. `GET /api/outbox`, act, then `POST /api/outbox/ack` with the ids you handled.
6. `POST /api/sync/complete` so the sidebar can show the sync time.

A reply stays open until you close the card. A choice is already done; do the thing they picked. A drop means do not recreate that key. A snooze means stay quiet until `value`. A move is the person correcting your filing. `docs/GROKBOT_SETUP_PROMPT.md` is a copy-paste prompt for wiring an assistant that has routines, a webhook trigger, memory, and a secrets store.

## API

Set `BASE` and `API_TOKEN`. Every `/api` route requires the bearer token. `GET /healthz` does not. UI routes are separate and are covered above.

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
| `POST /hq/message` | `{ "text": "..." }` | `{ ok, delivered, outbox_count }` |

`snooze` needs a future ISO `value`. `reply` and `choose` need `value`. `move` needs a section other than `done`.

## Development

Node 22+.

```bash
npm ci
npm run dev
```

The UI is at `http://localhost:4731` and proxies the API on port `4732`. That API sees a loopback peer and a localhost Host, so the UI loads without `INSECURE_ALLOW_UNPROTECTED`. Do not expose the dev server.

```bash
npm test
npm run typecheck
npm run build
npm start
```

`npm start` serves the built UI and the API together on port `4732`. `npm run seed` loads the fictional sample cards. Tests cover API auth, upsert idempotency, close, events since, outbox on webhook failure, the stall and snooze rules, and the Access check (missing config, loopback, the insecure switch, JWT success and failure, key cache).

## License

MIT. See [LICENSE](LICENSE).
