# Prompt: install OpenLoops on a server

Copy everything below the line into a coding agent that has a shell on the server, or SSH access to it (Claude Code, Codex, or similar). It deploys OpenLoops with Docker Compose behind a Cloudflare Tunnel and Cloudflare Access, checks the result, and ends by giving you a prompt to paste into your Grok Bot. That second prompt links the bot to the board.

Fill nothing in beforehand. The agent asks for what it needs.

---

You are installing OpenLoops on a server for me. OpenLoops is a small self-hosted board (one Node process, SQLite) where my assistant posts the things it needs from me. It has no login of its own. The UI must sit behind Cloudflare Access, and the app refuses to serve the UI until Access is configured. The assistant talks to it over a JSON API with a bearer token.

The finished setup:

```text
browser   --HTTPS--> Cloudflare Access --> Tunnel --> cloudflared --> openloops:4732
assistant --HTTPS--> Access bypass on /api and /healthz --> same tunnel
openloops --webhook POST--> my Grok Bot
```

Work through the steps in order. Tell me what you are about to do before each step that changes the server or my Cloudflare account. Stop and ask when something does not match what this prompt expects. Do not guess.

## Rules

- Never print a secret: the API token, the webhook key, the tunnel token, or my Cloudflare API token. Generate secrets straight into files. Do not put them on a command line that shows up in shell history or in your transcript. Do not `cat` the env file. When you need to check a secret is set, print its length.
- Secrets live in one file, `/opt/openloops/.env`, owned by root with mode `600`. Nowhere else on disk.
- Do not seed sample data. `scripts/seed.ts` is for local demos.
- Do not open inbound ports. The tunnel makes an outbound connection. OpenLoops must not be published on a public interface.
- Do not touch other containers, other Cloudflare tunnels, other Access applications, or other DNS records. If a name you want to create already exists, stop and ask me.
- If a step needs `sudo` and you do not have it, tell me the exact command and wait.

## 1. Ask me

Ask these one at a time. Repeat each answer back and wait for me to confirm it.

1. **Hostname.** The public name for the board, like `loops.example.com`. Its zone (`example.com`) must already be on my Cloudflare account.
2. **Who may open the board.** One or more email addresses, or an email domain. These go in the Access allow policy.
3. **Assistant name.** Shown on the board. Default `Grok Bot`.
4. **Cloudflare access.** Ask whether I can create a Cloudflare API token for you. If yes, have me create a custom token at <https://dash.cloudflare.com/profile/api-tokens> with:
   - Account · Cloudflare Tunnel · Edit
   - Account · Access: Apps and Policies · Edit
   - Account · Access: Organizations, Identity Providers, and Groups · Edit
   - Zone · DNS · Edit, limited to the board's zone
   - Zone · Zone · Read, limited to the same zone
   - A TTL of one day is enough. The token is only needed during setup.

   Ask me to put it in a file on the server instead of pasting it into this chat, for example by running `install -m 600 /dev/null /root/.cf-setup-token && nano /root/.cf-setup-token`. If I paste it into the chat anyway, use it, and remind me at the end to delete it in the dashboard. If I say no to a token, you will do the server side and I will do the Cloudflare side by hand (section 6B).

Also check whether Cloudflare Zero Trust is turned on for my account. If I do not know, the API call in section 6 will tell you. If it is not on, I have to do that once in the dashboard (Zero Trust, pick a team name, choose the Free plan). You cannot do it for me.

## 2. Check the server

Report what you find. Stop if something is missing and tell me how to fix it.

- OS and architecture (`uname -a`, `/etc/os-release`). The image builds on `amd64` and `arm64`.
- Docker Engine and the Compose v2 plugin: `docker version`, `docker compose version`. If they are missing on Debian or Ubuntu, offer to install them from Docker's official apt repository and wait for my yes.
- At least 1 GB of free RAM and 2 GB of free disk for the build.
- Outbound HTTPS works: `curl -sS -o /dev/null -w '%{http_code}\n' https://api.cloudflare.com/client/v4/`. Outbound port 7844 (TCP and UDP) should be open for the tunnel. If you cannot test it, say so.
- Nothing already listens on `127.0.0.1:4732`.
- `/opt/openloops` does not exist yet. If it does, stop and ask me. It may be an earlier install.

## 3. Get the source

Clone the repository into `/opt/openloops/src`:

```bash
sudo mkdir -p /opt/openloops
sudo git clone https://github.com/cmer/openloops.git /opt/openloops/src
```

The repository may be private. If the clone asks for credentials, stop and ask me which I prefer: a read-only deploy key you generate on the server (show me the public key and where to add it on GitHub), a fine-grained read-only token I put in a file, or me copying the source to the server. Do not store GitHub credentials in `/opt/openloops/.env`.

Record the commit you deployed (`git -C /opt/openloops/src rev-parse --short HEAD`). Read `/opt/openloops/src/README.md`, sections "Environment" and "Cloudflare Tunnel and Access". If anything there contradicts this prompt, the README wins. Tell me what differed.

## 4. Write the env file

Create `/opt/openloops/.env`, mode `600`, without echoing values. For example:

```bash
sudo install -m 600 /dev/null /opt/openloops/.env
{
  echo "API_TOKEN=$(openssl rand -hex 32)"
  echo "WEBHOOK_KEY=$(openssl rand -hex 32)"
  echo "WEBHOOK_URL="
  echo "ASSISTANT_NAME=<the confirmed name>"
  echo "CF_ACCESS_TEAM_DOMAIN="
  echo "CF_ACCESS_AUD="
  echo "INSECURE_ALLOW_UNPROTECTED="
  echo "TUNNEL_TOKEN="
} | sudo tee /opt/openloops/.env > /dev/null
```

`WEBHOOK_URL` stays empty for now. Until it is set, my actions on the board queue in the outbox and nothing is lost. The Grok Bot gives us the URL in section 8.

You generate the webhook key here, not the bot. That way I paste one secret into the bot and nothing secret has to travel back to the server.

## 5. Write the Compose file

Do not edit the repository's `docker-compose.yml`. It publishes port 4732 on every interface and turns the insecure switch on for local testing. Write your own `/opt/openloops/compose.yml`:

```yaml
name: openloops

services:
  openloops:
    build: ./src
    image: openloops:local
    env_file: .env
    environment:
      PORT: "4732"
      NODE_ENV: production
      DATABASE_PATH: /data/openloops.db
    ports:
      - "127.0.0.1:4732:4732"
    volumes:
      - openloops-data:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:4732/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      start_period: 15s
      retries: 3

  cloudflared:
    image: cloudflare/cloudflared:<pinned release tag>
    command: tunnel --no-autoupdate run
    env_file: .env
    depends_on:
      openloops:
        condition: service_healthy
    restart: unless-stopped

volumes:
  openloops-data:
```

Pin `cloudflared` to the latest release tag you can see on Docker Hub or the `cloudflare/cloudflared` GitHub releases, not `latest`. `cloudflared` reads `TUNNEL_TOKEN` from the env file. The loopback port mapping is only for your own checks from the host. Remove it if I ask.

`env_file` passes every variable in `.env` to both containers. That is acceptable here. If you would rather keep `TUNNEL_TOKEN` out of the OpenLoops container and the API keys out of `cloudflared`, split the file in two and tell me.

Build and start only OpenLoops for now:

```bash
cd /opt/openloops && sudo docker compose up -d --build openloops
```

Check it:

- `curl -s http://127.0.0.1:4732/healthz` returns `{"ok":true}`.
- `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4732/api/items` returns `401`.
- The same call with the bearer token returns `200`. Read the token from the env file inside a subshell so it never reaches your output, for example `sudo sh -c '. /opt/openloops/.env; curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $API_TOKEN" http://127.0.0.1:4732/api/items'`.
- `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4732/` returns `403`. That is correct: Access is not configured yet, the request comes through the Docker bridge, and the app refuses the UI.

## 6A. Cloudflare, by API

Use this section if I gave you an API token. Read it from the file into a variable inside each command. Do not print it. Every call goes to `https://api.cloudflare.com/client/v4` with `Authorization: Bearer <token>`. Check `success` in every response. On an error, show me the `errors` array (it never contains the token) and stop.

If a request shape below is rejected, check the current Cloudflare API reference for that endpoint before you try something else. Do not fall back to the dashboard silently.

1. **Verify the token.** `GET /user/tokens/verify`. For an account-owned token, `GET /accounts/{account_id}/tokens/verify`.
2. **Find the account and zone.** `GET /zones?name=<zone>`. Take `result[0].id` as the zone id and `result[0].account.id` as the account id. If the zone is missing, stop.
3. **Zero Trust organization.** `GET /accounts/{account_id}/access/organizations`. Take `auth_domain`, for example `myteam.cloudflareaccess.com`. That is `CF_ACCESS_TEAM_DOMAIN`. If the call says there is no organization, stop and ask me to turn on Zero Trust (section 1), then try again.
4. **Login method.** `GET /accounts/{account_id}/access/identity_providers`. If the list is empty, add the one-time PIN method: `POST` the same path with `{"name":"One-time PIN","type":"onetimepin","config":{}}`. Do not change existing providers.
5. **Tunnel.** Check `GET /accounts/{account_id}/cfd_tunnel?name=openloops&is_deleted=false`. If one exists, stop and ask me. Otherwise `POST /accounts/{account_id}/cfd_tunnel` with `{"name":"openloops","config_src":"cloudflare"}`. Keep the `id`. Then `GET /accounts/{account_id}/cfd_tunnel/{tunnel_id}/token` and write the result into `TUNNEL_TOKEN` in `.env` without printing it.
6. **Tunnel routes.** `PUT /accounts/{account_id}/cfd_tunnel/{tunnel_id}/configurations` with:

   ```json
   {
     "config": {
       "ingress": [
         { "hostname": "<hostname>", "service": "http://openloops:4732" },
         { "service": "http_status:404" }
       ]
     }
   }
   ```

7. **DNS.** `GET /zones/{zone_id}/dns_records?name=<hostname>`. If a record exists, stop and ask me. Otherwise `POST /zones/{zone_id}/dns_records` with `{"type":"CNAME","name":"<hostname>","content":"<tunnel_id>.cfargotunnel.com","proxied":true,"comment":"OpenLoops tunnel"}`.
8. **Access policies.** Create two reusable policies with `POST /accounts/{account_id}/access/policies`:
   - `OpenLoops allow`: `"decision":"allow"`, `include` built from my answer: `{"email":{"email":"me@example.com"}}` for each address, or `{"email_domain":{"domain":"example.com"}}`.
   - `OpenLoops API bypass`: `"decision":"bypass"`, `"include":[{"everyone":{}}]`.
9. **Board application.** `POST /accounts/{account_id}/access/apps`:

   ```json
   {
     "name": "OpenLoops",
     "type": "self_hosted",
     "domain": "<hostname>",
     "destinations": [{ "type": "public", "uri": "<hostname>" }],
     "session_duration": "24h",
     "app_launcher_visible": true,
     "policies": [{ "id": "<allow policy id>", "precedence": 1 }]
   }
   ```

   Keep `aud` from the response. That is `CF_ACCESS_AUD`.
10. **API bypass application.** `POST /accounts/{account_id}/access/apps` again:

    ```json
    {
      "name": "OpenLoops API (bypass)",
      "type": "self_hosted",
      "domain": "<hostname>/api",
      "destinations": [
        { "type": "public", "uri": "<hostname>/api" },
        { "type": "public", "uri": "<hostname>/healthz" }
      ],
      "policies": [{ "id": "<bypass policy id>", "precedence": 1 }]
    }
    ```

    If the API will not take two destinations on one app, create a second bypass app for `<hostname>/healthz`. The app still checks `API_TOKEN` on every `/api` call, so the bypass only removes the Access challenge. It does not open the API.

Write `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` into `.env`. Keep `INSECURE_ALLOW_UNPROTECTED` empty. Go to section 7.

## 6B. Cloudflare, by hand

Use this section if I would not give you a token, or if 6A stopped on a permission error. Send me these steps with my real hostname filled in, then wait. I paste back three values: the tunnel token (into the file you tell me, not the chat), the team domain, and the AUD tag.

1. Zero Trust dashboard → Networks → Tunnels → Create a tunnel → Cloudflared. Name it `openloops`. On the install screen, copy the token from the `docker run` command (the long string after `--token`). Put it on the server: `sudo nano /opt/openloops/.env`, line `TUNNEL_TOKEN=`.
2. In the same tunnel, add a public hostname: `<hostname>`, service type `HTTP`, URL `openloops:4732`. Cloudflare creates the DNS record.
3. Settings → Authentication. If there is no login method, add One-time PIN.
4. Access → Applications → Add an application → Self-hosted. Name `OpenLoops`. Domain `<hostname>`, no path. Add a policy: action Allow, include Emails (or Emails ending in) with the addresses I gave you. Save. Open the app's Overview and copy the Application Audience (AUD) tag.
5. Add a second self-hosted application named `OpenLoops API (bypass)`. Add two destinations: `<hostname>` with path `api`, and `<hostname>` with path `healthz`. Policy: action Bypass, include Everyone. Save.
6. Settings → Custom Pages, or the top of the Zero Trust overview, shows the team domain (`<team>.cloudflareaccess.com`). Send it to me.

When I am done, write the team domain and the AUD into `.env` yourself and check that `TUNNEL_TOKEN` is set (print its length, not the value).

## 7. Start everything and check it

```bash
cd /opt/openloops && sudo docker compose up -d --force-recreate
sudo docker compose ps
sudo docker compose logs --tail 50 cloudflared
```

The `cloudflared` log should show registered tunnel connections. The OpenLoops log must not contain `INSECURE_ALLOW_UNPROTECTED` warnings or "invalid" Access config messages.

Then check each of these and report pass or fail. DNS can take a minute.

- [ ] `curl -s https://<hostname>/healthz` returns `{"ok":true}` (bypass works).
- [ ] `curl -s -o /dev/null -w '%{http_code}\n' https://<hostname>/api/items` returns `401` (bypass works, token still required).
- [ ] The same call with the bearer token returns `200`.
- [ ] `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://<hostname>/` returns a `302` to `<team>.cloudflareaccess.com` (Access protects the UI).
- [ ] `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4732/` returns `403` (the origin refuses a request with no Access token, even from the host).
- [ ] `ss -tlnp | grep 4732` shows only `127.0.0.1`.
- [ ] I open `https://<hostname>` in a browser, log in through Access, and see an empty board with the assistant name I chose. Ask me to confirm.

If one fails, find the cause before going on. Common ones: the DNS record is not proxied, the tunnel route points to `localhost` instead of `openloops`, the bypass app path is wrong, or the AUD belongs to the bypass app instead of the board app.

## 8. Hand-off: link the Grok Bot

Install a helper so I can set the webhook URL later without editing the env file. Write `/opt/openloops/set-webhook-url`, mode `755`, that:

- takes one argument, the webhook URL;
- refuses anything that is not `https://` with a host;
- replaces the `WEBHOOK_URL=` line in `/opt/openloops/.env` and leaves every other line alone;
- runs `docker compose up -d --force-recreate openloops` in `/opt/openloops` so the container picks up the change;
- prints `WEBHOOK_URL updated` and nothing from the env file.

Next, build the linking prompt. Take everything below the `---` line in `/opt/openloops/src/docs/GROKBOT_SETUP_PROMPT.md` and put this preface in front of it, with the real hostname and name filled in:

```markdown
Some of the setup below is already done. These notes override the sections they name.

- Section 1: my OpenLoops URL is https://<hostname>. Treat it as confirmed. Still ask me for the API token and store it as `OPENLOOPS_API_TOKEN`.
- Section 2: do not generate a webhook key. The server already has one. Ask me to paste it and store it as `OPENLOOPS_WEBHOOK_KEY`. Never echo it.
- Section 3: once the webhook routine exists, tell me its URL. I will set it on the server myself. Do not ask me for a shell.
- The board shows you as "<assistant name>".
```

Save the result as `/opt/openloops/GROKBOT_LINK_PROMPT.md`. It contains no secrets.

Then give me the hand-off, in this order:

1. The board URL, and a note that the first login sends a one-time code to my email if that is the method in use.
2. How to see the two secrets the bot will ask for. Do not show them yourself. Give me the command to run on the server:

   ```bash
   sudo grep -E '^(API_TOKEN|WEBHOOK_KEY)=' /opt/openloops/.env
   ```

3. The full linking prompt in a code block, ready to copy, and its path on disk.
4. What happens next: I paste the prompt into my Grok Bot. It asks for the API token, then the webhook key. It creates its routines and tells me its webhook URL. I run:

   ```bash
   sudo /opt/openloops/set-webhook-url 'https://<the URL the bot gave me>'
   ```

   Then the bot runs its checklist. Until I run that command, the bot still sees my actions through the outbox.

## 9. Final report

End with a short report:

- Board URL and the deployed commit.
- Paths: `/opt/openloops/compose.yml`, `.env`, `src/`, `set-webhook-url`, `GROKBOT_LINK_PROMPT.md`.
- Which section 7 checks passed and any that failed.
- Cloudflare objects you created, with ids: tunnel, DNS record, identity provider (if any), two policies, two or three Access applications.
- What I still need to do: delete the Cloudflare setup token (and `/root/.cf-setup-token`), paste the linking prompt into the bot, run `set-webhook-url`.
- How to update later:

  ```bash
  cd /opt/openloops && sudo git -C src pull && sudo docker compose up -d --build
  ```

- How to back up: the SQLite database is in the `openloops_openloops-data` volume at `/data/openloops.db`. Stop the container or use `sqlite3 .backup` before copying it.

Do not create cards, publish bots, or set the webhook URL yourself. That is the Grok Bot's job once it is linked.
