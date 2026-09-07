import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { requireUser } from "../auth.js";
import { config } from "../config.js";
import { isDemoSession } from "../demo.js";
import { allSessionIds, importBundle, makeBundle, parseBundle, snapshotDatabase, type ImportMode } from "../bundle.js";

// Sessions leave and enter as bundles (see bundle.ts). People move their own sessions through
// /api/v1/backup; an operator with TANDEM_ADMIN_TOKEN moves the whole install through /api/v1/admin,
// which is what a deployment pipeline calls before and after a redeploy.

const BODY_LIMIT = 512 * 1024 * 1024; // uploads travel inline as base64

const modeOf = (q: { mode?: string } | undefined): ImportMode => (q?.mode === "replace" ? "replace" : "copy");

function requireAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!config.adminToken) {
    reply.code(404).send({ error: "operator access is off: set TANDEM_ADMIN_TOKEN on the server to turn it on" });
    return false;
  }
  const given = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(config.adminToken);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    reply.code(401).send({ error: "operator token missing or wrong" });
    return false;
  }
  return true;
}

export async function registerBackupRoutes(app: FastifyInstance) {
  // One or more of my sessions as a file.
  app.post<{ Body: { sessionIds?: string[] } }>("/api/v1/backup/export", async (req, reply) => {
    const user = requireUser(req, reply);
    const ids = [...new Set((req.body?.sessionIds ?? []).filter((x) => typeof x === "string"))];
    if (!ids.length) return reply.code(400).send({ error: "sessionIds is empty" });
    for (const id of ids) {
      if (isDemoSession(id)) return reply.code(400).send({ error: "the built-in demo ships with every install; it is not exported" });
      const me = db.select({ role: schema.participants.role }).from(schema.participants).where(and(eq(schema.participants.sessionId, id), eq(schema.participants.userId, user.id))).get();
      if (!me) return reply.code(403).send({ error: `you are not in session ${id}` });
    }
    const bundle = makeBundle(ids, { id: user.id, handle: user.handle });
    const name = ids.length === 1 ? bundle.sessions[0]!.title.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "session" : `${ids.length}-sessions`;
    reply.header("Content-Disposition", `attachment; filename="${name}.session-zero.json"`);
    return bundle;
  });

  // A bundle comes back as my sessions: a copy (default) or, for my own, a restore in place.
  app.post<{ Querystring: { mode?: string }; Body: unknown }>("/api/v1/backup/import", { bodyLimit: BODY_LIMIT }, async (req, reply) => {
    const user = requireUser(req, reply);
    const bundle = parseBundle(req.body);
    const sessions = importBundle(bundle, { importer: { id: user.id, handle: user.handle, displayName: user.displayName, avatarUrl: user.avatarUrl }, mode: modeOf(req.query) });
    return { mode: modeOf(req.query), exportedAt: bundle.exportedAt, sessions };
  });

  // Operator: every session on the install, and the way to put them back.
  app.get("/api/v1/admin/backup", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const ids = allSessionIds();
    reply.header("Content-Disposition", `attachment; filename="session-zero-${new Date().toISOString().slice(0, 10)}.json"`);
    return makeBundle(ids, null);
  });

  app.post<{ Querystring: { mode?: string }; Body: unknown }>("/api/v1/admin/restore", { bodyLimit: BODY_LIMIT }, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const bundle = parseBundle(req.body);
    const mode = req.query?.mode === "copy" ? "copy" : "replace";
    return { mode, exportedAt: bundle.exportedAt, sessions: importBundle(bundle, { importer: null, mode }) };
  });

  // Operator: the database file itself, copied consistently while the app runs. Carries
  // everything the bundle does not (accounts, sealed credentials, tool servers, notification
  // rules) but not the uploaded files, which live beside it under DATA_DIR/files.
  app.get("/api/v1/admin/backup.db", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const tmp = path.join(config.dataDir, `snapshot-${process.pid}-${Date.now()}.db`);
    await snapshotDatabase(tmp);
    const stream = fs.createReadStream(tmp);
    stream.on("close", () => fs.rm(tmp, { force: true }, () => undefined));
    reply.header("Content-Type", "application/vnd.sqlite3");
    reply.header("Content-Disposition", `attachment; filename="tandem-${new Date().toISOString().slice(0, 10)}.db"`);
    return reply.send(stream);
  });
}
