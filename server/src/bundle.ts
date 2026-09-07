import fs from "node:fs";
import path from "node:path";
import { ulid } from "ulid";
import { and, eq } from "drizzle-orm";
import { db, now, schema, sqlite } from "./db/index.js";
import { config } from "./config.js";
import { invalidateState } from "./ledger.js";
import { dropBroker } from "./turn/broker.js";
import { bus } from "./bus.js";
import { findCredentialForUser } from "./credentials.js";
import { isDemoSession } from "./demo.js";

// A bundle is one or more whole sessions in a single JSON file: the ledger, the people, the
// uploads with their bytes, the canvas layout and the published pages. It is the portable form
// of a session: a backup before a redeploy, a copy for another install, or a hand-off to a
// colleague. Nothing secret goes in: credentials, tool servers and notification rules stay
// behind, and the importer's own credential funds the session after import.
//
// Two ways back in. "copy" always makes a new session (new id, new upload ids) and makes the
// importer its owner; nothing that already exists is touched. "replace" keeps every id, so a
// backup restores in place: a session with the same id is deleted first, and only its owner
// (or an operator with the admin token) may do that.

export const BUNDLE_FORMAT = "session-zero-bundle";
export const BUNDLE_VERSION = 1;

export interface CapturedSession {
  id: string;
  title: string;
  status: string;
  template: string | null;
  thumbnail: string | null;
  policy: string;
  payerMode: string;
  pinnedModel: string;
  provider: string;
  forkedFromSessionId: string | null;
  forkedAtCommitId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  users: { id: string; handle: string; displayName: string | null; avatarUrl: string | null; githubId: number | null }[];
  participants: { userId: string; role: string; color: string; joinedAt: string; consentedAt: string | null; lastSeenSeq: number }[];
  events: { id: string; seq: number; type: string; actorKind: string; actorUserId: string | null; causedBy: string[]; turnId: string | null; payload: unknown; createdAt: string }[];
  uploads: { id: string; uploaderUserId: string; name: string; mime: string; bytes: number; extractedText: string | null; createdAt: string; data: string | null }[];
  layout: string | null;
  publications: {
    id: string;
    artifactId: string;
    slug: string;
    title: string;
    ownerUserId: string;
    revokedAt: string | null;
    createdAt: string;
    updatedAt: string;
    versions: { id: string; no: number; docVersionNo: number; commitId: string | null; title: string; markdown: string; publishedBy: string | null; publishedByName: string; publishedAt: string; note: string | null; approval: string | null }[];
  }[];
}

export interface Bundle {
  format: typeof BUNDLE_FORMAT;
  version: number;
  exportedAt: string;
  exportedBy: { id: string; handle: string } | null;
  sessions: CapturedSession[];
}

export type ImportMode = "copy" | "replace";

export interface ImportReport {
  sourceId: string;
  sessionId: string | null;
  title: string;
  outcome: "imported" | "replaced" | "skipped";
  reason?: string;
  events: number;
  uploads: number;
  publications: number;
  people: number;
}

export function captureSession(sessionId: string): CapturedSession {
  const s = db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get();
  if (!s) throw Object.assign(new Error("session not found"), { statusCode: 404 });
  const participants = db.select().from(schema.participants).where(eq(schema.participants.sessionId, sessionId)).all();
  const events = db.select().from(schema.events).where(eq(schema.events.sessionId, sessionId)).all().sort((a, b) => a.seq - b.seq);
  const uploads = db.select().from(schema.uploads).where(eq(schema.uploads.sessionId, sessionId)).all();
  const layout = db.select({ state: schema.yjsDocuments.state }).from(schema.yjsDocuments).where(eq(schema.yjsDocuments.name, `session:${sessionId}:layout`)).get();
  // Everyone the ledger names: participants, plus people who left but still appear as actors.
  const userIds = new Set<string>([s.createdBy, ...participants.map((p) => p.userId), ...events.map((e) => e.actorUserId).filter((x): x is string => Boolean(x)), ...uploads.map((u) => u.uploaderUserId)]);
  const users = [...userIds].map((id) => db.select().from(schema.users).where(eq(schema.users.id, id)).get()).filter((u): u is NonNullable<typeof u> => Boolean(u));
  const pubs = db.select().from(schema.publications).where(eq(schema.publications.sessionId, sessionId)).all();
  return {
    id: s.id,
    title: s.title,
    status: s.status,
    template: s.template,
    thumbnail: s.thumbnail,
    policy: s.policy,
    payerMode: s.payerMode,
    pinnedModel: s.pinnedModel,
    provider: s.provider,
    forkedFromSessionId: s.forkedFromSessionId,
    forkedAtCommitId: s.forkedAtCommitId,
    createdBy: s.createdBy,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    users: users.map((u) => ({ id: u.id, handle: u.handle, displayName: u.displayName, avatarUrl: u.avatarUrl, githubId: u.githubId })),
    participants: participants.map((p) => ({ userId: p.userId, role: p.role, color: p.color, joinedAt: p.joinedAt, consentedAt: p.consentedAt, lastSeenSeq: p.lastSeenSeq })),
    events: events.map((e) => ({ id: e.id, seq: e.seq, type: e.type, actorKind: e.actorKind, actorUserId: e.actorUserId, causedBy: JSON.parse(e.causedBy) as string[], turnId: e.turnId, payload: JSON.parse(e.payload) as unknown, createdAt: e.createdAt })),
    uploads: uploads.map((u) => ({ id: u.id, uploaderUserId: u.uploaderUserId, name: u.name, mime: u.mime, bytes: u.bytes, extractedText: u.extractedText, createdAt: u.createdAt, data: fs.existsSync(u.path) ? fs.readFileSync(u.path).toString("base64") : null })),
    layout: layout ? Buffer.from(layout.state).toString("base64") : null,
    publications: pubs.map((p) => ({
      id: p.id,
      artifactId: p.artifactId,
      slug: p.slug,
      title: p.title,
      ownerUserId: p.ownerUserId,
      revokedAt: p.revokedAt,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      versions: db.select().from(schema.publicationVersions).where(eq(schema.publicationVersions.publicationId, p.id)).all().sort((a, b) => a.no - b.no),
    })),
  };
}

export function makeBundle(sessionIds: string[], exportedBy: { id: string; handle: string } | null): Bundle {
  return { format: BUNDLE_FORMAT, version: BUNDLE_VERSION, exportedAt: now(), exportedBy, sessions: sessionIds.map(captureSession) };
}

/** Every session on this install except the built-in demo (which ships with the code). */
export function allSessionIds(): string[] {
  return (sqlite.prepare(`select id from sessions where demo = 0 order by created_at`).all() as { id: string }[]).map((r) => r.id);
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** Check the shape closely enough that a wrong file fails here, not halfway through a transaction. */
export function parseBundle(raw: unknown): Bundle {
  const bad = (why: string) => Object.assign(new Error(`not a session bundle: ${why}`), { statusCode: 400 });
  if (!isObj(raw)) throw bad("expected a JSON object");
  if (raw.format !== BUNDLE_FORMAT) throw bad(`format is ${JSON.stringify(raw.format)}, expected "${BUNDLE_FORMAT}"`);
  if (typeof raw.version !== "number" || raw.version > BUNDLE_VERSION) throw bad(`bundle version ${String(raw.version)} is newer than this server understands (${BUNDLE_VERSION})`);
  if (!Array.isArray(raw.sessions) || raw.sessions.length === 0) throw bad("no sessions in it");
  for (const s of raw.sessions as unknown[]) {
    if (!isObj(s) || typeof s.id !== "string" || typeof s.title !== "string") throw bad("a session lacks id or title");
    if (!Array.isArray(s.events) || !Array.isArray(s.participants) || !Array.isArray(s.users)) throw bad(`session "${String(s.title)}" lacks events, participants or users`);
    for (const e of s.events as unknown[]) if (!isObj(e) || typeof e.seq !== "number" || typeof e.type !== "string" || !("payload" in e)) throw bad(`session "${String(s.title)}" has a malformed event`);
    if (!Array.isArray(s.uploads)) s.uploads = [];
    if (!Array.isArray(s.publications)) s.publications = [];
    if (typeof s.layout !== "string") s.layout = null;
  }
  return raw as unknown as Bundle;
}

// Ids in this app are ULIDs; a remap rewrites them wherever they appear, including inside payloads.
const ULID = /[0-9A-HJKMNP-TV-Z]{26}/g;
const remapText = (text: string, map: Map<string, string>) => (map.size ? text.replace(ULID, (m) => map.get(m) ?? m) : text);
const remapId = (id: string, map: Map<string, string>) => map.get(id) ?? id;

/** Remove a session and everything that hangs off it, including its published pages and files. */
export function purgeSession(id: string) {
  dropBroker(id);
  bus.publish(id, { kind: "ephemeral", event: { kind: "session.deleted", sessionId: id } });
  for (const t of ["events", "participants", "invites", "uploads"]) sqlite.prepare(`delete from ${t} where session_id = ?`).run(id);
  sqlite.prepare(`delete from yjs_documents where name like ?`).run(`session:${id}:%`);
  const pubs = sqlite.prepare(`select id from publications where session_id = ?`).all(id) as { id: string }[];
  for (const p of pubs) sqlite.prepare(`delete from publication_versions where publication_id = ?`).run(p.id);
  sqlite.prepare(`delete from publications where session_id = ?`).run(id);
  sqlite.prepare(`delete from library_index_state where session_id = ?`).run(id);
  sqlite.prepare(`delete from sessions where id = ?`).run(id);
  invalidateState(id);
  fs.rmSync(path.join(config.filesDir, id), { recursive: true, force: true });
}

/**
 * People in the bundle become people here: the same id when known, else the same GitHub account,
 * else the same handle; anyone unknown is created with their original id so the ledger's
 * references still resolve (and a later GitHub sign-in finds them by GitHub id).
 */
function reconcileUsers(users: CapturedSession["users"], map: Map<string, string>) {
  for (const u of users) {
    const byId = db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, u.id)).get();
    if (byId) continue;
    const byGithub = u.githubId ? db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.githubId, u.githubId)).get() : null;
    const byHandle = byGithub ?? db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.handle, u.handle)).get();
    if (byHandle) {
      map.set(u.id, byHandle.id);
      continue;
    }
    db.insert(schema.users).values({ id: u.id, handle: u.handle, displayName: u.displayName, avatarUrl: u.avatarUrl, githubId: u.githubId, createdAt: now() }).run();
  }
}

const importOne = sqlite.transaction((s: CapturedSession, mode: ImportMode, importer: { id: string; handle: string; displayName: string | null; avatarUrl: string | null } | null): ImportReport => {
  const base = { sourceId: s.id, title: s.title, events: s.events.length, uploads: s.uploads.length, publications: 0, people: s.participants.length };
  const exists = Boolean(sqlite.prepare(`select 1 from sessions where id = ?`).get(s.id));
  if (isDemoSession(s.id)) return { ...base, sessionId: null, outcome: "skipped", reason: "this is the built-in demo session; it ships with every install" };
  const map = new Map<string, string>();
  let replaced = false;
  if (mode === "replace") {
    if (exists) {
      const owner = importer ? db.select({ role: schema.participants.role }).from(schema.participants).where(and(eq(schema.participants.sessionId, s.id), eq(schema.participants.userId, importer.id))).get() : { role: "owner" };
      if (owner?.role !== "owner") return { ...base, sessionId: null, outcome: "skipped", reason: "a session with this id exists here and you are not its owner; import it as a copy instead" };
      purgeSession(s.id);
      replaced = true;
    }
  } else {
    map.set(s.id, ulid());
    for (const u of s.uploads) map.set(u.id, ulid());
  }
  reconcileUsers(s.users, map);
  const id = remapId(s.id, map);
  const ts = now();
  const provider = s.provider;
  const sponsor = importer && s.payerMode === "sponsor" ? findCredentialForUser(importer.id, provider) : null;
  db.insert(schema.sessions)
    .values({ id, title: s.title, status: s.status === "archived" ? "archived" : "active", template: s.template, thumbnail: s.thumbnail, demo: 0, policy: s.policy, payerMode: s.payerMode, pinnedModel: s.pinnedModel, provider, sponsorCredentialId: sponsor?.id ?? null, forkedFromSessionId: s.forkedFromSessionId, forkedAtCommitId: s.forkedAtCommitId, createdBy: remapId(s.createdBy, map), createdAt: s.createdAt, updatedAt: mode === "copy" ? ts : s.updatedAt })
    .run();

  // Who is in it. A copy belongs to whoever imported it; a restore keeps the roles as they were,
  // and an importer who was not in the session joins as an owner so the restore is not orphaned.
  const parts = new Map<string, CapturedSession["participants"][number]>();
  for (const p of s.participants) parts.set(remapId(p.userId, map), { ...p, userId: remapId(p.userId, map) });
  let joined: CapturedSession["participants"][number] | null = null;
  if (importer) {
    const mine = parts.get(importer.id);
    if (mode === "copy") {
      for (const p of parts.values()) if (p.role === "owner") p.role = "editor";
      if (mine) mine.role = "owner";
    }
    if (!mine) {
      joined = { userId: importer.id, role: "owner", color: "#7C8893", joinedAt: ts, consentedAt: null, lastSeenSeq: 0 };
      parts.set(importer.id, joined);
    }
  }
  for (const p of parts.values()) {
    db.insert(schema.participants).values({ sessionId: id, userId: p.userId, role: p.role, credentialId: p.userId === importer?.id ? (sponsor?.id ?? null) : null, color: p.color, consentedAt: p.consentedAt, joinedAt: p.joinedAt, lastSeenSeq: mode === "copy" ? 0 : p.lastSeenSeq }).run();
  }

  const ins = sqlite.prepare(`insert into events (session_id, seq, id, type, actor_kind, actor_user_id, caused_by, turn_id, payload, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let seq = 0;
  for (const e of [...s.events].sort((a, b) => a.seq - b.seq)) {
    seq = e.seq;
    ins.run(id, e.seq, remapText(e.id, map), e.type, e.actorKind, e.actorUserId ? remapId(e.actorUserId, map) : null, remapText(JSON.stringify(e.causedBy ?? []), map), e.turnId ? remapText(e.turnId, map) : null, remapText(JSON.stringify(e.payload), map), e.createdAt);
  }
  if (joined) {
    ins.run(id, ++seq, ulid(), "participant.joined", "user", joined.userId, "[]", null, JSON.stringify({ role: "owner", name: importer!.displayName || importer!.handle, color: joined.color, avatarUrl: importer!.avatarUrl ?? undefined }), ts);
  }

  const dir = path.join(config.filesDir, id);
  fs.mkdirSync(dir, { recursive: true });
  for (const u of s.uploads) {
    const uid = remapId(u.id, map);
    const dest = path.join(dir, `${uid}-${u.name.replace(/[^\w.\-]+/g, "_").slice(0, 120)}`);
    if (u.data) fs.writeFileSync(dest, Buffer.from(u.data, "base64"));
    db.insert(schema.uploads).values({ id: uid, sessionId: id, uploaderUserId: remapId(u.uploaderUserId, map), name: u.name, path: dest, mime: u.mime, bytes: u.bytes, extractedText: u.extractedText, createdAt: u.createdAt }).run();
  }
  if (s.layout) db.insert(schema.yjsDocuments).values({ name: `session:${id}:layout`, state: Buffer.from(s.layout, "base64"), updatedAt: ts }).run();

  // Published pages come back only with a restore: a copy is a new session, and its owner
  // publishes again when ready. A slug already taken by another page stays with that page.
  let publications = 0;
  if (mode === "replace") {
    for (const p of s.publications ?? []) {
      const taken = db.select({ id: schema.publications.id }).from(schema.publications).where(eq(schema.publications.slug, p.slug)).get();
      if (taken) continue;
      db.insert(schema.publications).values({ id: p.id, sessionId: id, artifactId: p.artifactId, slug: p.slug, title: p.title, ownerUserId: remapId(p.ownerUserId, map), revokedAt: p.revokedAt, createdAt: p.createdAt, updatedAt: p.updatedAt }).run();
      for (const v of p.versions) db.insert(schema.publicationVersions).values({ id: v.id, publicationId: p.id, no: v.no, docVersionNo: v.docVersionNo, commitId: v.commitId, title: v.title, markdown: v.markdown, publishedBy: v.publishedBy ? remapId(v.publishedBy, map) : null, publishedByName: v.publishedByName, publishedAt: v.publishedAt, note: v.note, approval: v.approval }).run();
      publications++;
    }
  }
  invalidateState(id);
  return { ...base, sessionId: id, outcome: replaced ? "replaced" : "imported", publications, people: parts.size };
});

export function importBundle(b: Bundle, opts: { importer: { id: string; handle: string; displayName: string | null; avatarUrl: string | null } | null; mode: ImportMode }): ImportReport[] {
  return b.sessions.map((s) => importOne(s, opts.mode, opts.importer));
}

/** A consistent copy of the whole database file (SQLite's online backup), for an operator. */
export async function snapshotDatabase(dest: string): Promise<void> {
  await sqlite.backup(dest);
}
