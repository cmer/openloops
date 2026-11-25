import { enqueueOutbox, type DB, type WebhookBody } from "./db.js";

export type WebhookFetch = (url: string, init: RequestInit) => Promise<Response>;

export async function deliverWebhook(
  db: DB,
  body: WebhookBody,
  opts: { url?: string; key: string; fetchImpl: WebhookFetch; now: Date },
): Promise<boolean> {
  if (!opts.url) {
    enqueueOutbox(db, body, opts.now);
    return false;
  }
  try {
    const res = await opts.fetchImpl(opts.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.key}`,
        "X-Automation-Key": opts.key,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      enqueueOutbox(db, body, opts.now);
      console.error(`webhook delivery failed: status ${res.status}`);
      return false;
    }
    await res.body?.cancel().catch(() => undefined);
    return true;
  } catch (err) {
    enqueueOutbox(db, body, opts.now);
    const message = err instanceof Error ? err.message : "error";
    console.error(opts.key && message.includes(opts.key) ? "webhook delivery failed" : `webhook delivery failed: ${message}`);
    return false;
  }
}
