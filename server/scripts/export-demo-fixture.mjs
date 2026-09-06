// Capture a seeded session as the built-in demo fixture: its ledger, participants, uploads
// (with file bytes) and canvas layout, so every install can load it read only at start.
//
//   node server/scripts/export-demo-fixture.mjs --db server/data-demo/tandem.db --session <id> [--out server/fixtures/demo-session.json]
//
// Users are renamed demo-<handle> so they never collide with real accounts; participant names
// inside the ledger (Alice, Bob, Carol) stay as they are.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const dbPath = opt("db", "server/data-demo/tandem.db");
const out = opt("out", "server/fixtures/demo-session.json");
const sessionId = opt("session", "");
if (!sessionId) {
  console.error("--session <id> is required");
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });
const session = db.prepare("select * from sessions where id = ?").get(sessionId);
if (!session) {
  console.error(`no session ${sessionId} in ${dbPath}`);
  process.exit(1);
}
const participants = db.prepare("select * from participants where session_id = ? order by joined_at").all(sessionId);
const users = participants.map((p) => db.prepare("select id, handle, display_name, avatar_url from users where id = ?").get(p.user_id)).filter(Boolean);
const events = db.prepare("select * from events where session_id = ? order by seq").all(sessionId);
const uploads = db.prepare("select * from uploads where session_id = ?").all(sessionId);
const layout = db.prepare("select state from yjs_documents where name = ?").get(`session:${sessionId}:layout`);

const fixture = {
  version: Number(opt("version", String(Math.floor(Date.now() / 1000)))),
  title: opt("title", `Demo: ${session.title}`),
  session: { id: session.id, policy: session.policy, payerMode: session.payer_mode, pinnedModel: session.pinned_model, provider: session.provider, template: session.template, createdAt: session.created_at },
  users: users.map((u) => ({ id: u.id, handle: `demo-${u.handle}`, displayName: u.display_name, avatarUrl: u.avatar_url })),
  participants: participants.map((p) => ({ userId: p.user_id, role: p.role, color: p.color, joinedAt: p.joined_at, consentedAt: p.consented_at })),
  events: events.map((e) => ({ id: e.id, seq: e.seq, type: e.type, actorKind: e.actor_kind, actorUserId: e.actor_user_id, causedBy: JSON.parse(e.caused_by), turnId: e.turn_id, payload: JSON.parse(e.payload), createdAt: e.created_at })),
  uploads: uploads.map((u) => ({ id: u.id, uploaderUserId: u.uploader_user_id, name: u.name, mime: u.mime, bytes: u.bytes, extractedText: u.extracted_text, createdAt: u.created_at, data: fs.existsSync(u.path) ? fs.readFileSync(u.path).toString("base64") : null })),
  layout: layout ? Buffer.from(layout.state).toString("base64") : null,
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(fixture, null, 1));
console.log(`wrote ${out}: ${fixture.events.length} events, ${fixture.users.length} users, ${fixture.uploads.length} uploads, layout ${fixture.layout ? "yes" : "no"}, version ${fixture.version}`);
