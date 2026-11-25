# Prompt: connect a Grok Bot to OpenLoops

Copy everything below the line into a new chat with your own Grok Bot. It assumes a desktop assistant that has a shell, routines (including routines triggered by an incoming webhook), a memory, and a secrets store. Fill nothing in beforehand. The bot should ask you for the two values it needs.

---

You are connecting yourself to my OpenLoops board. OpenLoops is a self-hosted list and kanban of everything you need from me: decisions, actions, questions, and things waiting on someone else. I use the board. You feed it and you consume what I do there. There is no login inside the app. The board is for me, behind Cloudflare Access. You use the JSON API with a bearer token.

Do this in order. Do not skip the questions. Do not invent a URL or a token.

## 1. Ask me, then store the secret

Ask me for two things, one at a time:

1. The base URL of my OpenLoops instance. It should look like `https://loops.example.com`, with an `https` scheme, no path, no query, and no credentials. Repeat the URL back and wait until I confirm it.
2. The API token. Tell me to paste it once. Store it in your secrets store under the name `OPENLOOPS_API_TOKEN`. Never echo the token, never write it into memory, a routine prompt, a file in the chat, or a command line that would show up in a transcript. After it is stored, tell me to rotate it if it has already appeared in this chat, and do not repeat it while saying so.

If I only give you a token and no URL, stop and ask for the URL. If the URL does not parse, ask again. Remember the confirmed URL in memory. Remember that the token lives in the secret `OPENLOOPS_API_TOKEN` and nowhere else.

Check the instance before you build routines:

- `GET {URL}/healthz` with no token. Expect `{"ok":true}`.
- `GET {URL}/api/items` with no token. Expect 401.
- `GET {URL}/api/items` with `Authorization: Bearer` and the secret. Expect 200 and `{"items":[...]}`.

If the authed call fails, stop and tell me. Do not guess a different token.

## 2. Webhook routine

Create a webhook-triggered routine that receives what I do on the board.

Generate a long random webhook key (32 bytes, hex is fine). Store it in your secrets store as `OPENLOOPS_WEBHOOK_KEY`. Never echo it.

The routine's trigger is an incoming HTTP webhook. Note the URL the routine gives you. That URL is not a secret. The key is.

On every delivery:

1. Read `Authorization` and `X-Automation-Key`. Accept the request only when at least one of them equals `OPENLOOPS_WEBHOOK_KEY`. Compare in constant time if you can. If neither matches, ignore the body and do not act.
2. Parse the JSON body. Do not log the headers.
3. Act on `type`, then remember what you did so a retry does not do it twice. Use `item_id` plus `at` as the idempotency key.

The body looks like this:

```json
{
  "type": "done",
  "item_id": 12,
  "external_key": "ask:email:1842",
  "title": "Send the sample note",
  "value": null,
  "at": "2026-11-25T18:04:00.000Z"
}
```

`type` is one of:

- `done` — I finished it. Mark your copy done. Do not ask me again.
- `snooze` — `value` is an ISO time. Leave it alone until then. Do not nudge me before that.
- `drop` — I cancelled it. Drop your copy. Do not recreate that `external_key`.
- `reply` — `value` is my reply. Read it and continue the work. The card stays open until you close it.
- `choose` — I picked a decision. `value` is the option's `value` (not the label). Do that thing. The card is already done.
- `move` — I dragged it to another section. `value` is the new section. Treat that as a correction of your filing.
- `message` — I pinged you from the box at the top of the board. `item_id`, `external_key`, and `title` are null. `value` is the text. Respond to it as a fresh note from me.

If the delivery is a type you do not know, store the body in memory and tell me, and do not guess.

## 3. Put the webhook on the instance

OpenLoops reads the webhook from its own environment, not from an API call:

- `WEBHOOK_URL` = the routine's webhook URL
- `WEBHOOK_KEY` = `OPENLOOPS_WEBHOOK_KEY`

You cannot set those through `/api`. Ask me to set them and restart the container. If I give you a shell on that host, show me the exact edit and the restart command and wait for me to say yes before you run it. Do not print the key in the command. Pass it from the secret store into the environment without echoing it.

Until those two are set, my actions are still saved. They queue in the outbox. Your sync routine below must drain that queue, so nothing is lost while the webhook is empty.

## 4. Recurring sync routine

Create a second routine on a schedule. Suggest every 30 minutes while I am likely to be around, plus once in the morning, and let me change the cadence before you save it.

Each run:

1. Read `OPENLOOPS_API_TOKEN` from the secret store. Send `Authorization: Bearer <token>` and `Content-Type: application/json` on every `/api` call.
2. Gather the open loops you actually need from me: decisions, things only I can do, questions you are blocked on, questions I asked that are still open, and things parked on someone else. Skip anything I dropped.
3. Upsert them in one `POST {URL}/api/items/upsert`. One object or an array. Match on `external_key`. The same key updates the same card and returns the same id. A missing key creates a card.
4. Close cards whose real-world loop is finished: `POST {URL}/api/items/{id}/close` with `{"status":"done"}` or `{"status":"dropped","note":"..."}`. Closing by id is how a resolved loop leaves the board. Do not delete rows. There is no delete API.
5. Catch up anything the webhook missed: `GET {URL}/api/events?since={cursor}`. The cursor is exclusive. Only my actions are in this list (`actor` is `user`). Store the cursor in memory after you have acted on the page.
6. Drain leftovers: `GET {URL}/api/outbox`, act on each payload the same way as a webhook delivery, then `POST {URL}/api/outbox/ack` with `{"ids":[...]}` for the ones you handled. Ack only ids you successfully handled.
7. `POST {URL}/api/sync/complete` with `{}` or `{"at":"<ISO time>"}`. That sets the "last synced" line in the header.

Keep the token out of the routine's visible prompt. Refer to the secret by name.

## 5. How to write cards

Sections, in board order:

| section | when to use it |
| --- | --- |
| `decision` | I need to pick one option. Include `options`: `[{ "label", "value" }]`, at most 12. |
| `action` | Only I can move this. |
| `question_for_you` | You are blocked on an answer from me. |
| `question_from_you` | I asked something and it is still open. |
| `waiting_on_others` | The ball is with someone else. Set `owner` to them. |
| `stalled` | Do not file here yourself. The board moves a card here after 7 days with no activity, and it remembers the previous section. |
| `done` | Prefer the close API. A card I marked done stays visible for 7 days. |

`external_key` is stable for the life of one real loop. Never reuse a key for a different loop. A good shape is `ask:<source>:<id>`, `decision:<id>`, or `waiting:<who>:<id>`.

On a routine upsert, send the real section (`decision`, `action`, `question_for_you`, `question_from_you`, or `waiting_on_others`), not `stalled`. Re-sending that original section does not clear a stall. Omit `last_activity_at` unless something actually happened. Sending a new timestamp wakes a stalled card, which you should only do on purpose.

Writing:

- `title` is the ask, a verb when it is an action, at most 300 characters.
- `body` is markdown I need in order to act: the fact, the constraint, the link target. Not a transcript. At most 20,000 characters.
- `source` is where it came from (`chat`, `email`, `calendar`), at most 200 characters.
- `owner` is who has the ball, when that is not me.
- `link` is an `http` or `https` URL.
- `due_at` is an ISO time, only when there is a real deadline.
- `who` is an alias for `owner` if that is easier to write.
- One card per loop. Update it by posting the same `external_key`.

Status values are `open`, `done`, `dropped`, and `snoozed`. Snoozed cards hide until `snoozed_until`. Do not clear a snooze I set unless I asked you to.

Other limits: 200 items per upsert, `external_key` 200 characters, option label and value 120 characters, a reply or close note 4,000 characters.

## 6. Check that it works

Do these and tell me the result of each. Do not print the token or the webhook key.

- [ ] `GET /healthz` returns `{"ok":true}`.
- [ ] `GET /api/items` without the token returns 401, and with the token returns 200.
- [ ] Upsert one sample card with external key `setup:check`, section `action`, title `Confirm OpenLoops is connected`. I can see it on the board.
- [ ] I mark that card done, or you close it with the API if I ask you to. It leaves the open lists.
- [ ] I take one action on the board (done, snooze, drop, reply, a decision, or a drag). Your webhook routine receives it, or, if the webhook URL is not set yet, the event is in `GET /api/outbox` and your sync routine acks it.
- [ ] `POST /api/sync/complete` runs, and the header can show a sync time.
- [ ] The token and the webhook key are only in the secrets store. They are not in memory, the routine text, or this chat.
- [ ] The name on the board matches `ASSISTANT_NAME` on the server (the default is Assistant). You did not hardcode a person's name into cards.

When the checklist passes, stop. Do not create extra cards. Leave the sample card closed.
