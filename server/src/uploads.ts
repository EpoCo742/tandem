import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import type { SourceContent } from "@tandem/shared";
import { config } from "./config.js";
import { db, now, schema } from "./db/index.js";
import { requireUser } from "./auth.js";
import { appendEvent, getState } from "./ledger.js";
import { createCommit, contentHash } from "./governance.js";

// Uploads become source cards: the file lands on local disk (S3 in production), text is
// extracted for text-like files, and a `source` artifact is written to the ledger so the
// AI sees it as untrusted source material on later turns.

const MAX_TEXT = 20_000;
const TEXT_EXT = new Set([".md", ".markdown", ".txt", ".mmd", ".json", ".yaml", ".yml", ".csv", ".puml"]);

function kindOf(name: string, mime: string): SourceContent["kind"] {
  const ext = path.extname(name).toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (ext === ".mmd") return "diagram";
  if (ext === ".md" || ext === ".markdown") return "markdown";
  return "text";
}

export async function registerUploadRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string } }>("/api/v1/sessions/:id/uploads", async (req, reply) => {
    const user = requireUser(req, reply);
    const me = db.select().from(schema.participants).where(and(eq(schema.participants.sessionId, req.params.id), eq(schema.participants.userId, user.id))).get();
    if (!me) return reply.code(403).send({ error: "not a participant" });
    if (me.role === "viewer") return reply.code(403).send({ error: "viewers cannot upload" });
    const file = await req.file({ limits: { fileSize: 25 * 1024 * 1024 } });
    if (!file) return reply.code(400).send({ error: "no file" });

    const uploadId = ulid();
    const safeName = file.filename.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "upload";
    const dir = path.join(config.filesDir, req.params.id);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `${uploadId}-${safeName}`);
    await pipeline(file.file, fs.createWriteStream(dest));
    const bytes = fs.statSync(dest).size;
    const mime = file.mimetype || "application/octet-stream";
    const kind = kindOf(file.filename, mime);

    let extractedText: string | undefined;
    if (kind !== "image" && (mime.startsWith("text/") || TEXT_EXT.has(path.extname(file.filename).toLowerCase()) || mime === "application/json")) {
      extractedText = fs.readFileSync(dest, "utf8").slice(0, MAX_TEXT);
    }

    db.insert(schema.uploads).values({ id: uploadId, sessionId: req.params.id, uploaderUserId: user.id, name: file.filename, path: dest, mime, bytes, extractedText: extractedText ?? null, createdAt: now() }).run();
    const added = appendEvent(req.params.id, { type: "upload.added", actorKind: "user", actorUserId: user.id, payload: { uploadId, mime, bytes, name: file.filename } });

    // A .mmd upload becomes a mermaid card directly; everything else a source card.
    const artifactId = ulid();
    if (kind === "diagram" && extractedText) {
      appendEvent(req.params.id, {
        type: "artifact.applied",
        actorKind: "user",
        actorUserId: user.id,
        causedBy: [added.id],
        payload: {
          artifactId,
          artifactType: "mermaid",
          title: file.filename,
          versionId: ulid(),
          versionNo: 1,
          op: "create",
          proposalId: null,
          content: { source: extractedText, kind: "other", sections: [{ id: "upload", derivedFrom: [added.id] }] },
          summary: `Uploaded diagram ${file.filename}`,
          authorKind: "user",
          authorUserId: user.id,
          provenance: [{ sectionId: "upload", derivedFrom: [added.id] }],
          contentHash: contentHash(extractedText),
        },
      });
    } else {
      const firstLine = extractedText?.split("\n").find((l) => l.trim())?.trim().slice(0, 140);
      const content: SourceContent = {
        uploadId,
        kind,
        name: file.filename,
        mime,
        extractedText,
        aiSummary: kind === "image" ? `Image upload ${file.filename} (${Math.round(bytes / 1024)} KB)` : firstLine ? `${firstLine}${extractedText && extractedText.length > 140 ? " …" : ""}` : `Upload ${file.filename}`,
      };
      appendEvent(req.params.id, {
        type: "artifact.applied",
        actorKind: "user",
        actorUserId: user.id,
        causedBy: [added.id],
        payload: {
          artifactId,
          artifactType: "source",
          title: file.filename,
          versionId: ulid(),
          versionNo: 1,
          op: "create",
          proposalId: null,
          content,
          summary: content.aiSummary,
          authorKind: "user",
          authorUserId: user.id,
          provenance: [{ sectionId: "upload", derivedFrom: [added.id] }],
          contentHash: contentHash(content),
        },
      });
    }
    appendEvent(req.params.id, { type: "source.ingested", actorKind: "system", actorUserId: null, causedBy: [added.id], payload: { uploadId, artifactId } });
    createCommit(req.params.id, user.id, null, `${user.displayName || user.handle} uploaded ${file.filename}`);
    return { uploadId, artifactId, kind, bytes };
  });

  app.get<{ Params: { id: string; uploadId: string } }>("/api/v1/sessions/:id/files/:uploadId", async (req, reply) => {
    const user = requireUser(req, reply);
    const me = db.select().from(schema.participants).where(and(eq(schema.participants.sessionId, req.params.id), eq(schema.participants.userId, user.id))).get();
    if (!me) return reply.code(403).send({ error: "not a participant" });
    const row = db.select().from(schema.uploads).where(and(eq(schema.uploads.id, req.params.uploadId), eq(schema.uploads.sessionId, req.params.id))).get();
    if (!row || !fs.existsSync(row.path)) return reply.code(404).send({ error: "not found" });
    reply.header("Content-Type", row.mime);
    reply.header("Content-Disposition", `inline; filename="${encodeURIComponent(row.name)}"`);
    return reply.send(fs.createReadStream(row.path));
  });

  // Sanity: state helper used by tests
  app.get<{ Params: { id: string } }>("/api/v1/sessions/:id/uploads", async (req, reply) => {
    const user = requireUser(req, reply);
    const me = db.select().from(schema.participants).where(and(eq(schema.participants.sessionId, req.params.id), eq(schema.participants.userId, user.id))).get();
    if (!me) return reply.code(403).send({ error: "not a participant" });
    const state = getState(req.params.id);
    return Object.values(state.artifacts).filter((a) => a.type === "source" && !a.deleted).map((a) => ({ artifactId: a.id, title: a.title, content: a.current.content }));
  });
}
