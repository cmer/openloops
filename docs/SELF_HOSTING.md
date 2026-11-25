# Self-hosting OpenLoops

The easiest path is to let a coding agent do this for you with [SERVER_SETUP_PROMPT.md](SERVER_SETUP_PROMPT.md). This page is the manual version, and the reference for what that prompt sets up.

## Try it locally

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

Remove `INSECURE_ALLOW_UNPROTECTED` before anyone but you can reach the port. [Cloudflare Tunnel and Access](#cloudflare-tunnel-and-access) is how.

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
