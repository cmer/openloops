# Development

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

## Running locally

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
