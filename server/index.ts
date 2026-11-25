import { serve } from "@hono/node-server";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { accessStartupWarning, type AccessOptions } from "./access.js";
import { createApp } from "./app.js";
import { openDatabase, reconcile } from "./db.js";

const port = Number(process.env.PORT ?? 4732);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("PORT must be an integer between 1 and 65535");
  process.exit(1);
}

const dbPath = process.env.DATABASE_PATH ?? resolve(process.cwd(), "data/openloops.db");
const db = openDatabase(dbPath);
reconcile(db);

const timer = setInterval(() => {
  try {
    reconcile(db);
  } catch (err) {
    console.error("reconcile failed", err);
  }
}, 60_000);
timer.unref();

if (!process.env.API_TOKEN) {
  console.warn("API_TOKEN is empty. /api will reject every request.");
}
if (!process.env.WEBHOOK_URL) {
  console.warn("WEBHOOK_URL is empty. Actions will queue in the outbox.");
}

const access: AccessOptions = {
  teamDomain: process.env.CF_ACCESS_TEAM_DOMAIN,
  audience: process.env.CF_ACCESS_AUD,
  insecureAllowUnprotected: process.env.INSECURE_ALLOW_UNPROTECTED === "1",
};
const accessWarning = accessStartupWarning(access);
if (accessWarning) console.warn(accessWarning);

const isProd = process.env.NODE_ENV === "production";
const app = createApp({
  db,
  apiToken: process.env.API_TOKEN ?? "",
  summaryToken: process.env.SUMMARY_TOKEN || undefined,
  webhookUrl: process.env.WEBHOOK_URL || undefined,
  webhookKey: process.env.WEBHOOK_KEY ?? "",
  assistantName: process.env.ASSISTANT_NAME,
  access,
  staticDir: isProd ? fileURLToPath(new URL("../client", import.meta.url)) : undefined,
});

const server = serve({ fetch: app.fetch, hostname: "0.0.0.0", port }, (info) => {
  console.log(`OpenLoops listening on http://${info.address}:${info.port}`);
  console.log(`database ${dbPath}`);
});

function shutdown() {
  clearInterval(timer);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
