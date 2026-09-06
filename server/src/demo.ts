import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { db, now, schema, sqlite } from "./db/index.js";
import { config } from "./config.js";
import { invalidateState } from "./ledger.js";

// The built-in demo: a complete session captured once (server/fixtures/demo-session.json) and
// loaded at start on every install. Every signed-in person can open it as a viewer and replay
// it; nobody can change, publish, fork or delete it; only its design document reaches the
// library. Set TANDEM_DEMO=0 to leave it out.

interface Fixture {
  version: number;
  title: string;
  session: { id: string; policy: string; payerMode: string; pinnedModel: string; provider: string; template: string | null; createdAt: string };
  users: { id: string; handle: string; displayName: string | null; avatarUrl: string | null }[];
  participants: { userId: string; role: string; color: string; joinedAt: string; consentedAt: string | null }[];
  events: { id: string; seq: number; type: string; actorKind: string; actorUserId: string | null; causedBy: string[]; turnId: string | null; payload: unknown; createdAt: string }[];
  uploads: { id: string; uploaderUserId: string; name: string; mime: string; bytes: number; extractedText: string | null; createdAt: string; data: string | null }[];
  layout: string | null;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, "../fixtures/demo-session.json");

let demoId: string | null = null;

export function demoSessionId(): string | null {
  if (demoId === null) {
    const row = sqlite.prepare(`select id from sessions where demo > 0 limit 1`).get() as { id: string } | undefined;
    demoId = row?.id ?? "";
  }
  return demoId || null;
}

export function isDemoSession(sessionId: string): boolean {
  return demoSessionId() === sessionId;
}

/** A stand-in participant row for someone reading the demo: a viewer who never joined the ledger. */
export function demoViewer(sessionId: string, userId: string) {
  return { sessionId, userId, role: "viewer" as const, credentialId: null, color: "#7C8893", consentedAt: null, joinedAt: now(), lastSeenSeq: 0 };
}

const importTx = sqlite.transaction((f: Fixture) => {
  const old = sqlite.prepare(`select id from sessions where demo > 0`).all() as { id: string }[];
  for (const { id } of old) {
    for (const t of ["events", "participants", "invites", "uploads"]) sqlite.prepare(`delete from ${t} where session_id = ?`).run(id);
    sqlite.prepare(`delete from yjs_documents where name like ?`).run(`session:${id}:%`);
    sqlite.prepare(`delete from publications where session_id = ?`).run(id);
    sqlite.prepare(`delete from sessions where id = ?`).run(id);
    invalidateState(id);
  }
  for (const u of f.users) {
    const existing = db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, u.id)).get();
    if (!existing) db.insert(schema.users).values({ id: u.id, handle: u.handle, displayName: u.displayName, avatarUrl: u.avatarUrl, githubId: null, createdAt: f.session.createdAt }).run();
  }
  const ts = now();
  db.insert(schema.sessions).values({ id: f.session.id, title: f.title, status: "active", template: f.session.template, demo: f.version, policy: f.session.policy, payerMode: f.session.payerMode, pinnedModel: f.session.pinnedModel, provider: f.session.provider, sponsorCredentialId: null, createdBy: f.participants[0]?.userId ?? f.users[0]!.id, createdAt: f.session.createdAt, updatedAt: ts }).run();
  for (const p of f.participants) db.insert(schema.participants).values({ sessionId: f.session.id, userId: p.userId, role: p.role, credentialId: null, color: p.color, consentedAt: p.consentedAt, joinedAt: p.joinedAt, lastSeenSeq: 0 }).run();
  const ins = sqlite.prepare(`insert into events (session_id, seq, id, type, actor_kind, actor_user_id, caused_by, turn_id, payload, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const e of f.events) ins.run(f.session.id, e.seq, e.id, e.type, e.actorKind, e.actorUserId, JSON.stringify(e.causedBy), e.turnId, JSON.stringify(e.payload), e.createdAt);
  const dir = path.join(config.filesDir, f.session.id);
  fs.mkdirSync(dir, { recursive: true });
  for (const u of f.uploads) {
    const dest = path.join(dir, `${u.id}-${u.name.replace(/[^\w.\-]+/g, "_").slice(0, 120)}`);
    if (u.data) fs.writeFileSync(dest, Buffer.from(u.data, "base64"));
    db.insert(schema.uploads).values({ id: u.id, sessionId: f.session.id, uploaderUserId: u.uploaderUserId, name: u.name, path: dest, mime: u.mime, bytes: u.bytes, extractedText: u.extractedText, createdAt: u.createdAt }).run();
  }
  if (f.layout) db.insert(schema.yjsDocuments).values({ name: `session:${f.session.id}:layout`, state: Buffer.from(f.layout, "base64"), updatedAt: ts }).run();
});

/** Load (or refresh) the demo session from the fixture. Idempotent per fixture version. */
export function ensureDemoSession(log: (msg: string) => void = () => undefined) {
  if (process.env.TANDEM_DEMO === "0") return;
  if (!fs.existsSync(FIXTURE)) {
    log(`no demo fixture at ${FIXTURE}; skipping the built-in demo`);
    return;
  }
  let f: Fixture;
  try {
    f = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as Fixture;
  } catch (e) {
    log(`demo fixture unreadable: ${(e as Error).message}`);
    return;
  }
  const current = sqlite.prepare(`select id, demo from sessions where demo > 0 limit 1`).get() as { id: string; demo: number } | undefined;
  if (current && current.id === f.session.id && current.demo === f.version) {
    demoId = current.id;
    return;
  }
  importTx(f);
  demoId = f.session.id;
  invalidateState(f.session.id);
  log(`demo session "${f.title}" loaded (${f.events.length} events, fixture version ${f.version})`);
}
