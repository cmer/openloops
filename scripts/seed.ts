import { resolve } from "node:path";
import { openDatabase, upsertItems } from "../server/db.js";
import type { ItemChanges } from "../server/validate.js";

const day = 86_400_000;
const now = new Date();

function iso(offsetMs: number): string {
  return new Date(now.getTime() + offsetMs).toISOString();
}

function atHour(offsetDays: number, hour: number): string {
  const date = new Date(now);
  date.setDate(date.getDate() + offsetDays);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

function sample(item: ItemChanges): ItemChanges {
  return {
    status: "open",
    choice: null,
    last_reply: null,
    closed_at: null,
    snoozed_until: null,
    ...item,
  };
}

const samples: ItemChanges[] = [
  {
    external_key: "example-decision-mascot",
    section: "decision",
    title: "Pick a mascot for the fictional Northwind demo",
    body: "Sample data only. The assistant made up three options for a product that **does not exist**.\n\n- Pine Marten\n- Brass Compass\n- Paper Boat",
    source: "chat",
    options: [
      { label: "Pine Marten", value: "marten" },
      { label: "Brass Compass", value: "compass" },
      { label: "Paper Boat", value: "boat" },
    ],
    created_at: iso(-2 * day),
    updated_at: iso(-2 * day),
    last_activity_at: iso(-2 * day),
  },
  {
    external_key: "example-action-invoice",
    section: "action",
    title: "Send the imaginary invoice to Example Bakery",
    body: "Demo only. There is no invoice and no bakery.",
    source: "email",
    owner: "You",
    link: "https://example.com/northwind-invoice",
    due_at: atHour(1, 17),
    created_at: iso(-1 * day),
    updated_at: iso(-1 * day),
    last_activity_at: iso(-1 * day),
  },
  {
    external_key: "example-action-domain",
    section: "action",
    title: "Renew the example domain before the fake deadline",
    source: "email",
    due_at: atHour(-1, 12),
    created_at: iso(-9 * day),
    updated_at: iso(-1 * day),
    last_activity_at: iso(-1 * day),
  },
  {
    external_key: "example-action-wifi",
    section: "action",
    title: "Paste the sample Wi-Fi note into the fake guest guide",
    source: "asks sweep",
    created_at: iso(-2 * day),
    updated_at: iso(-2 * day),
    last_activity_at: iso(-2 * day),
  },
  {
    external_key: "example-action-blurb",
    section: "action",
    title: "Approve the placeholder press blurb",
    source: "chat",
    created_at: iso(-3 * day),
    updated_at: iso(-3 * day),
    last_activity_at: iso(-3 * day),
  },
  {
    external_key: "example-action-ducks",
    section: "action",
    title: "File the made-up expense for rubber ducks",
    source: "email",
    created_at: iso(-4 * day),
    updated_at: iso(-4 * day),
    last_activity_at: iso(-4 * day),
  },
  {
    external_key: "example-action-hoa",
    section: "action",
    title: "Reply to the example HOA about the fictional fence",
    source: "email",
    created_at: iso(-5 * day),
    updated_at: iso(-5 * day),
    last_activity_at: iso(-5 * day),
  },
  {
    external_key: "example-action-offsite",
    section: "action",
    title: "Book a pretend room for the demo offsite",
    source: "chat",
    due_at: atHour(5, 9),
    created_at: iso(-1 * day),
    updated_at: iso(-1 * day),
    last_activity_at: iso(-1 * day),
  },
  {
    external_key: "example-action-key",
    section: "action",
    title: "Label the spare sample key",
    source: "asks sweep",
    created_at: iso(-6 * day),
    updated_at: iso(-6 * day),
    last_activity_at: iso(-6 * day),
  },
  {
    external_key: "example-question-for-you",
    section: "question_for_you",
    title: "Which fake airport code should the sample itinerary use?",
    body: "This is a made-up question. SFO and BOS are both fine; the assistant just needs a word.",
    source: "asks sweep",
    created_at: iso(-3 * day),
    updated_at: iso(-3 * day),
    last_activity_at: iso(-3 * day),
  },
  {
    external_key: "example-question-from-you",
    section: "question_from_you",
    title: "Did the fictional vendor Northwind Supply ever reply?",
    source: "chat",
    owner: "Northwind Supply",
    created_at: iso(-4 * day),
    updated_at: iso(-4 * day),
    last_activity_at: iso(-4 * day),
  },
  {
    external_key: "example-stalled-greenhouse",
    section: "action",
    title: "Follow up on the made-up greenhouse quote",
    body: "Nobody has touched this sample thread. It should land in Stalled on its own.",
    source: "chat",
    created_at: iso(-18 * day),
    updated_at: iso(-11 * day),
    last_activity_at: iso(-11 * day),
  },
  {
    external_key: "example-waiting-logo",
    section: "waiting_on_others",
    title: "Waiting on Northwind Supply for the sample logo sketches",
    source: "Northwind Supply",
    owner: "Northwind Supply",
    created_at: iso(-5 * day),
    updated_at: iso(-2 * day),
    last_activity_at: iso(-2 * day),
  },
  {
    external_key: "example-done-recent",
    section: "action",
    status: "done",
    title: "Confirm the sample calendar hold",
    source: "chat",
    created_at: iso(-6 * day),
    updated_at: iso(-1 * day),
    last_activity_at: iso(-1 * day),
    closed_at: iso(-1 * day),
  },
  {
    external_key: "example-done-old",
    section: "action",
    status: "done",
    title: "Archive the old fictional brief",
    source: "email",
    created_at: iso(-30 * day),
    updated_at: iso(-20 * day),
    last_activity_at: iso(-20 * day),
    closed_at: iso(-20 * day),
  },
  {
    external_key: "example-snoozed-budget",
    section: "action",
    status: "snoozed",
    title: "Review the pretend budget (snoozed sample)",
    source: "email",
    snoozed_until: iso(3 * day),
    created_at: iso(-2 * day),
    updated_at: iso(-1 * day),
    last_activity_at: iso(-1 * day),
  },
];

const dbPath = process.env.DATABASE_PATH ?? resolve(process.cwd(), "data/openloops.db");
const db = openDatabase(dbPath);
db.exec(`DELETE FROM outbox; DELETE FROM events; DELETE FROM meta;`);
const results = upsertItems(
  db,
  samples.map((changes) => {
    const full = sample(changes);
    return { changes: full, present: new Set(Object.keys(full)) };
  }),
  now,
);
const missingHistory = db
  .prepare(
    `SELECT id, title, section, external_key FROM items i
     WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.item_id = i.id)`,
  )
  .all() as { id: number; title: string; section: string; external_key: string | null }[];
const insertHistory = db.prepare(
  `INSERT INTO events (item_id, actor, type, payload_json, created_at) VALUES (?, 'assistant', 'upsert', ?, ?)`,
);
const stamp = now.toISOString();
for (const item of missingHistory) {
  insertHistory.run(item.id, JSON.stringify({ created: false, title: item.title, section: item.section, external_key: item.external_key }), stamp);
}
const visible = db
  .prepare(
    `SELECT COUNT(*) AS n FROM items WHERE status = 'open' OR (status = 'done' AND closed_at >= ?)`,
  )
  .get(iso(-7 * day)) as { n: number };

console.log(`Seeded ${results.length} fake sample items into ${dbPath}`);
console.log(`${visible.n} are visible on the board. One snoozed item and one older done item stay hidden.`);
db.close();
