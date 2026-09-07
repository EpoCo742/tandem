import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { ulid } from "ulid";
import { randomBytes } from "node:crypto";
import { allAdrs, completeness, isTemplateId, pickColor, threadRootOf, TEMPLATES, type ArchModelContent, type ConstraintsContent, type ArtifactType, type DecisionPointContent, type ImportedFrom, type MessageAnchor, type Policy, type Role, type ViewContent } from "@tandem/shared";
import { db, now, schema, sqlite } from "../db/index.js";
import { requireUser } from "../auth.js";
import { appendEvent, getState, listEvents, sessionExists } from "../ledger.js";
import { brokerFor, dropBroker } from "../turn/broker.js";
import fs from "node:fs";
import path from "node:path";
import { bus } from "../bus.js";
import { invalidateState } from "../ledger.js";
import { config } from "../config.js";
import { findCredentialForUser, listCredentials } from "../credentials.js";
import { contentHash, createCommit, requestChange, resolveProposal, revertTo } from "../governance.js";
import { maybeCompact } from "../context/compact.js";
import { resolveExternalCall } from "../external.js";
import { digestFor, markSeen, parseMentions, scheduleExpiry } from "../async.js";
import { mintCollabToken } from "../crypto.js";
import { exportMarkdown } from "../export.js";
import { adoptAlternative, openAlternativesDecision } from "../alternatives.js";
import { requestReview, signOff, withdrawReview } from "../review.js";
import { publishDocument, revokePublication } from "../publish.js";
import { importFromLibrary } from "../importer.js";
import { demoSessionId, demoViewer, isDemoSession } from "../demo.js";
import { impactLines, impactOf, contractsOf, nextAssumptionLabel, nextQuestionLabel, parseNotation, compareDesign, comparisonMarkdown, reduceUpTo, toStructurizrDsl, upsertBoundaries, upsertComponents, upsertRelationships, emptyModel, liveArtifacts, contentText, participantName } from "@tandem/shared";

export const NARRATE_INSTRUCTION =
  "Narrate the changes. The attached card compares two versions of the design document. Replace its \"Major changes\" section with a section titled \"What matters\": a short narrative for a reader who knows the earlier version, saying what changed, why it matters and who is affected, drawn only from the comparison below it. Keep every section after it exactly as it is. Update that card with update_artifact, same title. Change nothing else on the canvas.";

export const COMPILE_INSTRUCTION =
  "Compile the design document. Create (or update, if one exists) a design_doc artifact titled \"Design document\" that assembles everything on the canvas: Overview (what is being built, for whom), Architecture (embed every mermaid diagram as a fenced mermaid block, referencing the artifact by title), Data model (as Markdown tables: one table per entity with field, type and notes; never raw JSON), Constraints (a table of the constraints card: id, statement, kind, who set it), Sources (one or two sentences per uploaded file describing what it is and what was taken from it; never paste file contents), Decision log (every decision in the registry with status, who agreed, and what superseded what), and Open questions (proposed or contested decisions, unresolved decision points). Cite artifact ids in derivedFrom. Do not invent facts that are not on the canvas.";

function participantOr403(sessionId: string, userId: string) {
  const p = db.select().from(schema.participants).where(and(eq(schema.participants.sessionId, sessionId), eq(schema.participants.userId, userId))).get();
  if (p) return p;
  if (isDemoSession(sessionId)) return demoViewer(sessionId, userId); // everyone reads the demo
  throw Object.assign(new Error("not a participant"), { statusCode: 403 });
}

function ownerOr403(sessionId: string, userId: string) {
  const p = participantOr403(sessionId, userId);
  if (p.role !== "owner") throw Object.assign(new Error("only the session owner can do that"), { statusCode: 403 });
  return p;
}

// Writes an archived session refuses. Everything else under /sessions/:id that changes state
// is caught by one guard rather than a check in every route; the listed sub-paths are the ones
// that manage the session itself (or read it), so they stay open.
const ARCHIVE_EXEMPT = new Set(["", "/archive", "/fork", "/seen", "/export", "/adrs", "/thumbnail"]);
const SESSION_PATH = /^\/api\/v1\/sessions\/([^/?]+)((?:\/[^?]*)?)/;

const deleteSessionTx = sqlite.transaction((id: string) => {
  sqlite.prepare(`delete from events where session_id = ?`).run(id);
  sqlite.prepare(`delete from participants where session_id = ?`).run(id);
  sqlite.prepare(`delete from invites where session_id = ?`).run(id);
  sqlite.prepare(`delete from uploads where session_id = ?`).run(id);
  sqlite.prepare(`delete from yjs_documents where name like ?`).run(`session:${id}:%`);
  sqlite.prepare(`delete from sessions where id = ?`).run(id);
});

export async function registerSessionRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (req, reply) => {
    if (req.method === "GET" || req.method === "HEAD") return;
    const m = SESSION_PATH.exec(req.url);
    if (!m) return;
    // The demo is read only for everyone: no messages, cards, votes, publish, fork, rename, delete. Reading position is fine.
    if (isDemoSession(m[1]!) && m[2] !== "/seen") return reply.code(409).send({ error: "This is the built-in demo session. It is read only; replay it to see how it was built, or start a session of your own." });
    if (ARCHIVE_EXEMPT.has(m[2]!) || (req.method === "DELETE" && m[2] === "")) return;
    const s = db.select({ status: schema.sessions.status }).from(schema.sessions).where(eq(schema.sessions.id, m[1]!)).get();
    if (s?.status === "archived") return reply.code(409).send({ error: "This session is archived and read only. The owner can reopen it from the session menu." });
  });

  app.get("/api/v1/sessions", async (req, reply) => {
    const user = requireUser(req, reply);
    const rows = db
      .select({ s: schema.sessions, role: schema.participants.role })
      .from(schema.participants)
      .innerJoin(schema.sessions, eq(schema.participants.sessionId, schema.sessions.id))
      .where(eq(schema.participants.userId, user.id))
      .orderBy(desc(schema.sessions.updatedAt))
      .all();
    const mine = rows.map(({ s, role }) => ({ id: s.id, title: s.title, status: s.status, template: s.template, thumbnail: s.thumbnail, demo: s.demo > 0, role, policy: s.policy, payerMode: s.payerMode, pinnedModel: s.pinnedModel, provider: s.provider, createdAt: s.createdAt, updatedAt: s.updatedAt }));
    const demoId = demoSessionId();
    if (demoId && !mine.some((s) => s.id === demoId)) {
      const d = db.select().from(schema.sessions).where(eq(schema.sessions.id, demoId)).get();
      if (d) mine.push({ id: d.id, title: d.title, status: d.status, template: d.template, thumbnail: d.thumbnail, demo: true, role: "viewer", policy: d.policy, payerMode: d.payerMode, pinnedModel: d.pinnedModel, provider: d.provider, createdAt: d.createdAt, updatedAt: d.updatedAt });
    }
    return mine;
  });

  // Publish the design document (owner only): a public page with a frozen copy per version.
  app.post<{ Params: { id: string; artifactId: string }; Body: { note?: string } | undefined }>("/api/v1/sessions/:id/publish/:artifactId", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!sessionExists(req.params.id)) return reply.code(404).send({ error: "not found" });
    ownerOr403(req.params.id, user.id);
    const r = publishDocument(req.params.id, req.params.artifactId, user.id, req.body?.note);
    if (!r.ok) return reply.code(r.status).send({ error: r.error });
    return r;
  });

  app.post<{ Params: { id: string; artifactId: string } }>("/api/v1/sessions/:id/publish/:artifactId/revoke", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!sessionExists(req.params.id)) return reply.code(404).send({ error: "not found" });
    ownerOr403(req.params.id, user.id);
    const r = revokePublication(req.params.id, req.params.artifactId, user.id);
    if (!r.ok) return reply.code(r.status).send({ error: r.error });
    return r;
  });

  // A client draws a small SVG of the canvas (card rectangles by type, no content) and stores it here for the lists.
  app.put<{ Params: { id: string }; Body: { svg: string } }>("/api/v1/sessions/:id/thumbnail", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!sessionExists(req.params.id)) return reply.code(404).send({ error: "not found" });
    participantOr403(req.params.id, user.id);
    const svg = req.body?.svg ?? "";
    if (!svg.startsWith("<svg") || svg.length > 20_000 || /<script|<foreignObject|on\w+=|href=|xlink/i.test(svg)) return reply.code(400).send({ error: "a small plain SVG is expected" });
    db.update(schema.sessions).set({ thumbnail: svg }).where(eq(schema.sessions.id, req.params.id)).run();
    return { ok: true };
  });

  // Import a diagram in another notation into the model: preview, then merge, replace, or record as as-is.
  app.post<{ Params: { id: string }; Body: { text: string; notation?: "auto" | "mermaid" | "structurizr" | "plantuml"; mode?: "merge" | "replace" | "as_is"; apply?: boolean } }>("/api/v1/sessions/:id/model/import", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!sessionExists(req.params.id)) return reply.code(404).send({ error: "not found" });
    const me = participantOr403(req.params.id, user.id);
    if (me.role === "viewer" || me.role === "reviewer") return reply.code(403).send({ error: "only owners and editors change the model" });
    const text = (req.body?.text ?? "").trim();
    if (!text) return reply.code(400).send({ error: "paste a diagram first" });
    if (text.length > 200_000) return reply.code(400).send({ error: "that is too large to import" });
    const preview = parseNotation(text, req.body.notation);
    if (!preview) return reply.code(400).send({ error: "could not tell the notation; choose Mermaid, Structurizr or PlantUML" });
    if (!req.body.apply) return { preview };
    if (preview.components.length === 0) return reply.code(400).send({ error: "nothing to import", preview });
    const state = getState(req.params.id);
    const existing = liveArtifacts(state).find((a) => a.type === "arch_model");
    const cur = (existing?.current.content as ArchModelContent | undefined) ?? emptyModel();
    const mode = req.body.mode ?? "merge";
    const parsed = upsertRelationships(upsertComponents(upsertBoundaries(emptyModel(), preview.boundaries), preview.components, []), preview.relationships, []).model;
    let content: ArchModelContent;
    if (mode === "replace") content = { ...cur, components: parsed.components, relationships: parsed.relationships, boundaries: parsed.boundaries, sections: [{ id: "model", derivedFrom: [] }] };
    else if (mode === "as_is") {
      const asIs = { source: `import:${preview.notation}`, capturedAt: now(), components: parsed.components, relationships: parsed.relationships, boundaries: parsed.boundaries, notes: preview.notes };
      content = cur.components.length === 0 ? { ...cur, components: parsed.components, relationships: parsed.relationships, boundaries: parsed.boundaries, sections: [{ id: "model", derivedFrom: [] }], asIs } : { ...cur, asIs };
    } else content = upsertRelationships(upsertComponents(upsertBoundaries(cur, preview.boundaries), preview.components, []), preview.relationships, []).model;
    const r = requestChange({ sessionId: req.params.id, turnId: null, actorKind: "user", actorUserId: user.id, op: existing ? "update" : "create", artifactId: existing?.id ?? null, artifactType: "arch_model", title: existing?.title ?? "Architecture model", content, summary: `${content.components.length} components (imported from ${preview.notation})`, rationale: `Imported from ${preview.notation} by ${user.displayName || user.handle} (${mode})`, baseVersionNo: existing?.current.versionNo ?? null, causedBy: [], provenance: [{ sectionId: "model", derivedFrom: [] }] });
    if (r.status === "applied") {
      createCommit(req.params.id, user.id, null, `${user.displayName || user.handle} imported ${preview.components.length} components from ${preview.notation} (${mode})`);
      // The first model deserves a view, like the AI would have drawn one.
      if (!liveArtifacts(getState(req.params.id)).some((a) => a.type === "view" && (a.current.content as ViewContent).kind === "container")) {
        requestChange({ sessionId: req.params.id, turnId: null, actorKind: "user", actorUserId: user.id, op: "create", artifactId: null, artifactType: "view", title: "System architecture", content: { kind: "container", sections: [{ id: "body", derivedFrom: [] }] }, summary: "Container view of the architecture model", rationale: "Drawn after import", baseVersionNo: null, causedBy: [], provenance: [{ sectionId: "body", derivedFrom: [] }] });
      }
    }
    return { preview, ...r };
  });

  // Questions by hand: ask the group, answer or drop one. No AI turn; the answer reaches the AI in its next prompt.
  app.post<{ Params: { id: string }; Body: { text: string; addressedTo?: string[] } }>("/api/v1/sessions/:id/questions", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!sessionExists(req.params.id)) return reply.code(404).send({ error: "not found" });
    const me = participantOr403(req.params.id, user.id);
    if (me.role === "viewer") return reply.code(403).send({ error: "viewers cannot ask questions here" });
    const text = (req.body?.text ?? "").trim();
    if (!text) return reply.code(400).send({ error: "a question is needed" });
    const state = getState(req.params.id);
    const addressedTo = (Array.isArray(req.body.addressedTo) ? req.body.addressedTo : []).filter((u) => typeof u === "string" && state.participants[u]);
    const questionId = ulid();
    const label = nextQuestionLabel(state);
    appendEvent(req.params.id, { type: "question.raised", actorKind: "user", actorUserId: user.id, payload: { questionId, label, text, addressedTo } });
    return { questionId, label };
  });

  app.post<{ Params: { id: string; questionId: string }; Body: { outcome?: "answered" | "dropped"; answer?: string } }>("/api/v1/sessions/:id/questions/:questionId/resolve", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!sessionExists(req.params.id)) return reply.code(404).send({ error: "not found" });
    const me = participantOr403(req.params.id, user.id);
    if (me.role === "viewer") return reply.code(403).send({ error: "viewers cannot answer questions" });
    const state = getState(req.params.id);
    const q = state.questions[req.params.questionId];
    if (!q) return reply.code(404).send({ error: "no such question" });
    if (q.status !== "open") return reply.code(409).send({ error: `${q.label} is already ${q.status}` });
    const outcome = req.body?.outcome === "dropped" ? "dropped" : "answered";
    const answer = (req.body?.answer ?? "").trim();
    if (outcome === "answered" && !answer) return reply.code(400).send({ error: "an answer is needed" });
    appendEvent(req.params.id, { type: "question.resolved", actorKind: "user", actorUserId: user.id, payload: { questionId: q.id, outcome, ...(answer ? { answer } : {}) } });
    return { questionId: q.id, label: q.label, outcome };
  });

  // Assumptions by hand: add one (owned by me) or settle one. No AI turn.
  app.post<{ Params: { id: string }; Body: { statement: string; revisitAt?: string } }>("/api/v1/sessions/:id/assumptions", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!sessionExists(req.params.id)) return reply.code(404).send({ error: "not found" });
    const me = participantOr403(req.params.id, user.id);
    if (me.role === "viewer") return reply.code(403).send({ error: "viewers cannot record assumptions" });
    const statement = (req.body?.statement ?? "").trim().replace(/\.$/, "");
    if (!statement) return reply.code(400).send({ error: "a statement is needed" });
    if (req.body.revisitAt && !/^\d{4}-\d{2}-\d{2}/.test(req.body.revisitAt)) return reply.code(400).send({ error: "revisitAt must be an ISO date" });
    const state = getState(req.params.id);
    const assumptionId = ulid();
    const label = nextAssumptionLabel(state);
    appendEvent(req.params.id, { type: "assumption.recorded", actorKind: "user", actorUserId: user.id, payload: { assumptionId, label, statement, ownerUserId: user.id, ...(req.body.revisitAt ? { revisitAt: req.body.revisitAt.slice(0, 10) } : {}), evidence: [] } });
    return { assumptionId, label };
  });

  app.post<{ Params: { id: string; assumptionId: string }; Body: { outcome: "confirmed" | "refuted" | "decided"; decisionId?: string; note?: string } }>("/api/v1/sessions/:id/assumptions/:assumptionId/resolve", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!sessionExists(req.params.id)) return reply.code(404).send({ error: "not found" });
    const me = participantOr403(req.params.id, user.id);
    if (me.role === "viewer") return reply.code(403).send({ error: "viewers cannot settle assumptions" });
    const state = getState(req.params.id);
    const a = state.assumptions[req.params.assumptionId];
    if (!a) return reply.code(404).send({ error: "no such assumption" });
    if (a.status !== "open") return reply.code(400).send({ error: `${a.label} is already ${a.status}` });
    if (!["confirmed", "refuted", "decided"].includes(req.body?.outcome)) return reply.code(400).send({ error: "outcome must be confirmed, refuted or decided" });
    if (req.body.outcome === "decided" && req.body.decisionId && !state.decisions[req.body.decisionId]) return reply.code(400).send({ error: "no such decision" });
    appendEvent(req.params.id, { type: "assumption.resolved", actorKind: "user", actorUserId: user.id, payload: { assumptionId: a.id, outcome: req.body.outcome, ...(req.body.decisionId ? { decisionId: req.body.decisionId } : {}), ...(req.body.note ? { note: req.body.note.trim() } : {}) } });
    return { assumptionId: a.id, label: a.label, outcome: req.body.outcome };
  });

  // Contracts with their providers, consumers and whether they moved after the model.
  app.get<{ Params: { id: string } }>("/api/v1/sessions/:id/contracts", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!sessionExists(req.params.id)) return reply.code(404).send({ error: "not found" });
    participantOr403(req.params.id, user.id);
    return contractsOf(getState(req.params.id)).map((c) => ({ artifactId: c.artifact.id, title: c.artifact.title, versionNo: c.artifact.current.versionNo, format: c.content.format, attachedTo: c.content.attachedTo ?? null, provider: c.provider ?? null, consumers: c.consumers, changedAfterModel: c.changedAfterModel }));
  });

  // What depends on a component, as the Impact panel shows it, for scripts and digests.
  app.get<{ Params: { id: string; componentId: string } }>("/api/v1/sessions/:id/impact/:componentId", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!sessionExists(req.params.id)) return reply.code(404).send({ error: "not found" });
    participantOr403(req.params.id, user.id);
    const i = impactOf(getState(req.params.id), req.params.componentId);
    if (!i) return reply.code(404).send({ error: "no such component" });
    return { component: i.component, relationships: i.relationships.length, decisions: i.decisions.map((d) => d.label), constraints: i.constraints.map((k) => k.id), views: i.views.map((v) => v.title), alternatives: i.alternatives.flatMap((a) => a.candidates), mentions: i.mentions.map((m) => m.artifact.title), threads: i.threads.length, ifRemoved: i.ifRemoved, lines: impactLines(i) };
  });

  // The design checklist of a templated session, evaluated from the ledger (null without a template).
  app.get<{ Params: { id: string } }>("/api/v1/sessions/:id/checklist", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!sessionExists(req.params.id)) return reply.code(404).send({ error: "not found" });
    participantOr403(req.params.id, user.id);
    const c = completeness(getState(req.params.id));
    return c ? { template: { id: c.template.id, name: c.template.name }, items: c.items, done: c.done, total: c.total } : { template: null, items: [], done: 0, total: 0 };
  });

  // Copy a library entry (decision, component, constraint) into this session: no AI turn, same
  // governance as a hand edit, origin kept in importedFrom.
  app.post<{ Params: { id: string }; Body: { ref: ImportedFrom } }>("/api/v1/sessions/:id/library/import", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!sessionExists(req.params.id)) return reply.code(404).send({ error: "not found" });
    const me = participantOr403(req.params.id, user.id);
    if (me.role === "viewer" || me.role === "reviewer") return reply.code(403).send({ error: "only owners and editors copy things in; reviewers can ask the AI to" });
    const ref = req.body?.ref;
    if (!ref || typeof ref.sessionId !== "string" || typeof ref.refId !== "string" || !["decision", "component", "constraint", "document"].includes(ref.kind)) return reply.code(400).send({ error: "ref must be a library hit's importRef" });
    const r = importFromLibrary(req.params.id, user.id, ref);
    if (!r.ok) return reply.code(r.status).send({ error: r.error });
    return r;
  });

  // Rename: owner only. The ledger carries the change so open tabs pick it up live.
  app.patch<{ Params: { id: string }; Body: { title?: string } }>("/api/v1/sessions/:id", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!sessionExists(req.params.id)) return reply.code(404).send({ error: "not found" });
    ownerOr403(req.params.id, user.id);
    const title = (req.body?.title ?? "").trim().slice(0, 120);
    if (!title) return reply.code(400).send({ error: "a title is needed" });
    const s = db.select().from(schema.sessions).where(eq(schema.sessions.id, req.params.id)).get()!;
    if (s.title !== title) {
      db.update(schema.sessions).set({ title, updatedAt: now() }).where(eq(schema.sessions.id, req.params.id)).run();
      appendEvent(req.params.id, { type: "session.renamed", actorKind: "user", actorUserId: user.id, payload: { title, previous: s.title } });
    }
    return { id: s.id, title };
  });

  // Archive (read only, out of the digest) or reopen: owner only.
  app.post<{ Params: { id: string }; Body: { archived?: boolean } | undefined }>("/api/v1/sessions/:id/archive", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!sessionExists(req.params.id)) return reply.code(404).send({ error: "not found" });
    ownerOr403(req.params.id, user.id);
    const archived = req.body?.archived ?? true;
    const s = db.select().from(schema.sessions).where(eq(schema.sessions.id, req.params.id)).get()!;
    const status = archived ? "archived" : "active";
    if (s.status !== status) {
      if (archived) brokerFor(req.params.id).sendNow(); // nothing new can be posted; let a collecting batch go
      db.update(schema.sessions).set({ status, updatedAt: now() }).where(eq(schema.sessions.id, req.params.id)).run();
      appendEvent(req.params.id, { type: "session.archived", actorKind: "user", actorUserId: user.id, payload: { archived } });
    }
    return { id: s.id, status };
  });

  // Delete: owner only, and everything goes: ledger, cards, uploads on disk, layout, invites.
  // Forks made from this session keep their own copy; only their "forked from" link goes dead.
  app.delete<{ Params: { id: string } }>("/api/v1/sessions/:id", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!sessionExists(req.params.id)) return reply.code(404).send({ error: "not found" });
    ownerOr403(req.params.id, user.id);
    dropBroker(req.params.id);
    bus.publish(req.params.id, { kind: "ephemeral", event: { kind: "session.deleted", sessionId: req.params.id } });
    deleteSessionTx(req.params.id);
    invalidateState(req.params.id);
    fs.rmSync(path.join(config.filesDir, req.params.id), { recursive: true, force: true });
    return { ok: true };
  });

  app.post<{ Body: { title: string; policy?: Policy; payerMode?: "sponsor" | "speaker"; pinnedModel?: string; provider?: string; sponsorCredentialId?: string; template?: string } }>("/api/v1/sessions", async (req, reply) => {
    const user = requireUser(req, reply);
    const provider = req.body.provider ?? config.defaultProvider;
    if (req.body.template && !isTemplateId(req.body.template)) return reply.code(400).send({ error: `unknown template ${req.body.template}` });
    const template = req.body.template && isTemplateId(req.body.template) ? TEMPLATES[req.body.template] : null;
    const creds = listCredentials(user.id).filter((c) => c.provider === provider && c.status === "active");
    const sponsor = req.body.sponsorCredentialId ? creds.find((c) => c.id === req.body.sponsorCredentialId) : creds[0];
    if ((req.body.payerMode ?? "sponsor") === "sponsor" && !sponsor) {
      return reply.code(400).send({ error: `Connect a ${provider} credential first; sponsor mode needs one on the creator.` });
    }
    const pinnedModel = req.body.pinnedModel ?? (sponsor?.models.includes(config.defaultModel) ? config.defaultModel : sponsor?.models[0] ?? config.defaultModel);
    const id = ulid();
    const ts = now();
    db.insert(schema.sessions)
      .values({ id, title: req.body.title || "Untitled session", template: template?.id ?? null, policy: req.body.policy ?? "hybrid", payerMode: req.body.payerMode ?? "sponsor", pinnedModel, provider, sponsorCredentialId: sponsor?.id ?? null, createdBy: user.id, createdAt: ts, updatedAt: ts })
      .run();
    db.insert(schema.participants).values({ sessionId: id, userId: user.id, role: "owner", credentialId: sponsor?.id ?? null, color: pickColor(0), joinedAt: ts }).run();
    appendEvent(id, { type: "session.created", actorKind: "system", actorUserId: user.id, payload: { title: req.body.title, policy: req.body.policy ?? "hybrid", payerMode: req.body.payerMode ?? "sponsor", pinnedModel, ...(template ? { template: template.id } : {}) } });
    appendEvent(id, { type: "participant.joined", actorKind: "user", actorUserId: user.id, payload: { role: "owner", name: user.displayName || user.handle, color: pickColor(0), avatarUrl: user.avatarUrl ?? undefined } });
    // A template starts the constraints card with its defaults, set by the creator, who can amend or drop them.
    if (template && template.seedConstraints.length) {
      const content: ConstraintsContent = {
        constraints: template.seedConstraints.map((k, i) => ({ id: `C-${String(i + 1).padStart(2, "0")}`, statement: k.statement, kind: k.kind, category: k.category, ...(k.value ? { value: k.value } : {}), setBy: user.id, source: `template:${template.id}`, derivedFrom: [] })),
        sections: [{ id: "constraints", derivedFrom: [] }],
      };
      const r = requestChange({ sessionId: id, turnId: null, actorKind: "user", actorUserId: user.id, op: "create", artifactId: null, artifactType: "constraints", title: "Constraints", content, summary: `${content.constraints.length} constraints from the ${template.name} template`, rationale: `Defaults of the ${template.name} template`, baseVersionNo: null, causedBy: [], provenance: [{ sectionId: "constraints", derivedFrom: [] }] });
      if (r.status === "applied") createCommit(id, user.id, null, `${template.name} template: ${content.constraints.length} default constraints`);
    }
    return { id, template: template?.id ?? null };
  });

  app.get<{ Params: { id: string } }>("/api/v1/sessions/:id", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!sessionExists(req.params.id)) return reply.code(404).send({ error: "not found" });
    const me = participantOr403(req.params.id, user.id);
    const s = db.select().from(schema.sessions).where(eq(schema.sessions.id, req.params.id)).get()!;
    return {
      id: s.id,
      title: s.title,
      policy: s.policy,
      payerMode: s.payerMode,
      pinnedModel: s.pinnedModel,
      provider: s.provider,
      status: s.status,
      template: s.template,
      demo: s.demo > 0,
      createdBy: s.createdBy,
      forkedFrom: s.forkedFromSessionId ? { sessionId: s.forkedFromSessionId, commitId: s.forkedAtCommitId } : null,
      me: { role: me.role, consented: Boolean(me.consentedAt), hasCredential: Boolean(findCredentialForUser(user.id, s.provider)), lastSeenSeq: me.lastSeenSeq },
      collabToken: mintCollabToken(s.id, user.id),
      lastSeq: getState(s.id).lastSeq,
    };
  });

  app.get<{ Params: { id: string }; Querystring: { from_seq?: string } }>("/api/v1/sessions/:id/events", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!sessionExists(req.params.id)) return reply.code(404).send({ error: "not found" });
    participantOr403(req.params.id, user.id);
    return listEvents(req.params.id, Number(req.query.from_seq ?? 0));
  });

  app.post<{ Params: { id: string }; Body: { role?: Role } | undefined }>("/api/v1/sessions/:id/invites", async (req, reply) => {
    const user = requireUser(req, reply);
    participantOr403(req.params.id, user.id);
    const role: Role = req.body?.role === "reviewer" || req.body?.role === "viewer" ? req.body.role : "editor";
    const token = randomBytes(12).toString("base64url");
    db.insert(schema.invites).values({ token, sessionId: req.params.id, role, createdBy: user.id, createdAt: now() }).run();
    return { token, role, url: `${config.appUrl}/join/${token}` };
  });

  app.post<{ Params: { token: string } }>("/api/v1/invites/:token/accept", async (req, reply) => {
    const user = requireUser(req, reply);
    const inv = db.select().from(schema.invites).where(eq(schema.invites.token, req.params.token)).get();
    if (!inv) return reply.code(404).send({ error: "invite not found" });
    const existing = db.select().from(schema.participants).where(and(eq(schema.participants.sessionId, inv.sessionId), eq(schema.participants.userId, user.id))).get();
    if (!existing) {
      const count = db.select().from(schema.participants).where(eq(schema.participants.sessionId, inv.sessionId)).all().length;
      const color = pickColor(count);
      db.insert(schema.participants).values({ sessionId: inv.sessionId, userId: user.id, role: inv.role, credentialId: null, color, joinedAt: now() }).run();
      appendEvent(inv.sessionId, { type: "participant.joined", actorKind: "user", actorUserId: user.id, payload: { role: inv.role as Role, name: user.displayName || user.handle, color, avatarUrl: user.avatarUrl ?? undefined } });
    }
    return { sessionId: inv.sessionId };
  });

  app.post<{ Params: { id: string } }>("/api/v1/sessions/:id/consent", async (req, reply) => {
    const user = requireUser(req, reply);
    participantOr403(req.params.id, user.id);
    db.update(schema.participants).set({ consentedAt: now() }).where(and(eq(schema.participants.sessionId, req.params.id), eq(schema.participants.userId, user.id))).run();
    const s = db.select().from(schema.sessions).where(eq(schema.sessions.id, req.params.id)).get()!;
    appendEvent(req.params.id, { type: "participant.consented", actorKind: "user", actorUserId: user.id, payload: { providers: [s.provider] } });
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { text: string; mode?: "directive" | "note"; replyTo?: string; attachments?: string[]; anchor?: MessageAnchor } }>("/api/v1/sessions/:id/messages", async (req, reply) => {
    const user = requireUser(req, reply);
    const me = participantOr403(req.params.id, user.id);
    if (me.role === "viewer") return reply.code(403).send({ error: "viewers cannot post" });
    const mode = req.body.mode ?? "directive";
    if (mode === "directive" && !me.consentedAt) return reply.code(403).send({ error: "consent required before addressing the AI" });
    const text = String(req.body.text ?? "").trim();
    if (!text) return reply.code(400).send({ error: "empty message" });
    // Attachments are artifact ids of source cards created by this user's uploads.
    const state = getState(req.params.id);
    const attachments = (req.body.attachments ?? []).filter((id) => typeof id === "string" && state.artifacts[id] && !state.artifacts[id]!.deleted).slice(0, 8);
    const mentions = parseMentions(req.params.id, text);
    // Threads: a reply points at an earlier message and inherits what that thread is about;
    // an anchor names the card (and optionally the model component) the message is about.
    let replyTo: string | undefined;
    if (req.body.replyTo) {
      const parent = state.messages.find((m) => m.eventId === req.body.replyTo);
      if (!parent) return reply.code(400).send({ error: "replyTo is not a message in this session" });
      replyTo = parent.eventId;
    }
    let anchor = anchorOf(state, req.body.anchor);
    if (req.body.anchor && !anchor) return reply.code(400).send({ error: "anchor does not name a card in this session" });
    if (!anchor && replyTo) anchor = threadRootOf(state, replyTo)?.anchor;
    const ev = appendEvent(req.params.id, { type: "message.posted", actorKind: "user", actorUserId: user.id, payload: { text, mode, attachments, replyTo, ...(anchor ? { anchor } : {}), ...(mentions.length ? { mentions } : {}) } });
    if (mode === "directive") brokerFor(req.params.id).onDirective(ev);
    db.update(schema.sessions).set({ updatedAt: now() }).where(eq(schema.sessions.id, req.params.id)).run();
    return { eventId: ev.id, seq: ev.seq };
  });

  app.post<{ Params: { id: string; eventId: string } }>("/api/v1/sessions/:id/messages/:eventId/promote", async (req, reply) => {
    const user = requireUser(req, reply);
    participantOr403(req.params.id, user.id);
    const state = getState(req.params.id);
    const note = state.eventsById[req.params.eventId];
    if (!note || note.type !== "message.posted" || (note.payload as { mode: string }).mode !== "note") return reply.code(400).send({ error: "not a side-channel note" });
    const p = note.payload as { text: string; anchor?: MessageAnchor };
    // The promoted message carries what the thread is about, so "this" means something to the AI.
    const anchor = p.anchor ?? threadRootOf(state, note.id)?.anchor;
    const ev = appendEvent(req.params.id, { type: "message.posted", actorKind: "user", actorUserId: note.actorUserId, causedBy: [note.id], payload: { text: p.text, mode: "promoted", attachments: [], fromNoteEventId: note.id, ...(anchor ? { anchor } : {}) } });
    brokerFor(req.params.id).onDirective(ev);
    return { eventId: ev.id };
  });

  // Close or reopen a thread anchored to a card. Any participant can; the ledger says who did.
  app.post<{ Params: { id: string; eventId: string }; Body: { resolved?: boolean } }>("/api/v1/sessions/:id/messages/:eventId/resolve", async (req, reply) => {
    const user = requireUser(req, reply);
    const me = participantOr403(req.params.id, user.id);
    if (me.role === "viewer") return reply.code(403).send({ error: "viewers cannot resolve threads" });
    const state = getState(req.params.id);
    const root = state.messages.find((m) => m.eventId === req.params.eventId);
    if (!root || root.mode !== "note" || !root.anchor || root.replyTo) return reply.code(400).send({ error: "not the first message of a thread" });
    const resolved = req.body?.resolved ?? true;
    const ev = appendEvent(req.params.id, { type: "thread.resolved", actorKind: "user", actorUserId: user.id, causedBy: [root.eventId], payload: { rootEventId: root.eventId, resolved } });
    return { eventId: ev.id, resolved };
  });

  app.post<{ Params: { id: string } }>("/api/v1/sessions/:id/turns/send-now", async (req, reply) => {
    const user = requireUser(req, reply);
    participantOr403(req.params.id, user.id);
    brokerFor(req.params.id).sendNow();
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/api/v1/sessions/:id/turns/current/interrupt", async (req, reply) => {
    const user = requireUser(req, reply);
    participantOr403(req.params.id, user.id);
    const ok = await brokerFor(req.params.id).interrupt(user.id);
    return { interrupted: ok };
  });

  // Direct human edit of an artifact: goes through the same governance path as AI changes.
  app.post<{ Params: { id: string; artifactId: string }; Body: { content: unknown; title?: string; summary?: string; rationale?: string } }>("/api/v1/sessions/:id/artifacts/:artifactId/versions", async (req, reply) => {
    const user = requireUser(req, reply);
    const me = participantOr403(req.params.id, user.id);
    if (me.role === "viewer") return reply.code(403).send({ error: "viewers cannot edit" });
    const state = getState(req.params.id);
    const a = state.artifacts[req.params.artifactId];
    if (!a) return reply.code(404).send({ error: "artifact not found" });
    const outcome = requestChange({
      sessionId: req.params.id,
      turnId: null,
      actorKind: "user",
      actorUserId: user.id,
      op: "update",
      artifactId: a.id,
      artifactType: a.type,
      title: req.body.title ?? a.title,
      content: req.body.content,
      summary: req.body.summary ?? a.current.summary,
      rationale: req.body.rationale ?? "Direct edit",
      baseVersionNo: a.current.versionNo,
      causedBy: [],
      provenance: [{ sectionId: "edit", derivedFrom: [] }],
    });
    if (outcome.status === "invalid_content") return reply.code(400).send({ error: outcome.message });
    if (outcome.status === "applied") createCommit(req.params.id, user.id, null, `${user.displayName || user.handle} edited ${a.title}`);
    return outcome;
  });

  app.delete<{ Params: { id: string; artifactId: string }; Body: { rationale?: string } | undefined }>("/api/v1/sessions/:id/artifacts/:artifactId", async (req, reply) => {
    const user = requireUser(req, reply);
    const me = participantOr403(req.params.id, user.id);
    if (me.role === "viewer") return reply.code(403).send({ error: "viewers cannot delete" });
    const state = getState(req.params.id);
    const a = state.artifacts[req.params.artifactId];
    if (!a || a.deleted) return reply.code(404).send({ error: "artifact not found" });
    const outcome = requestChange({
      sessionId: req.params.id,
      turnId: null,
      actorKind: "user",
      actorUserId: user.id,
      op: "delete",
      artifactId: a.id,
      artifactType: a.type,
      title: a.title,
      content: a.current.content,
      summary: a.current.summary,
      rationale: req.body?.rationale ?? "Removed by hand",
      baseVersionNo: null,
      causedBy: [],
      provenance: a.current.provenance,
    });
    if (outcome.status === "applied") createCommit(req.params.id, user.id, null, `${user.displayName || user.handle} removed ${a.title}`);
    return outcome;
  });

  app.post<{ Params: { id: string }; Body: { type: ArtifactType; title: string; content: unknown; summary?: string } }>("/api/v1/sessions/:id/artifacts", async (req, reply) => {
    const user = requireUser(req, reply);
    const me = participantOr403(req.params.id, user.id);
    if (me.role === "viewer") return reply.code(403).send({ error: "viewers cannot create" });
    const outcome = requestChange({
      sessionId: req.params.id,
      turnId: null,
      actorKind: "user",
      actorUserId: user.id,
      op: "create",
      artifactId: null,
      artifactType: req.body.type,
      title: req.body.title,
      content: req.body.content,
      summary: req.body.summary ?? null,
      rationale: "Created by hand",
      baseVersionNo: null,
      causedBy: [],
      provenance: [{ sectionId: "body", derivedFrom: [] }],
    });
    if (outcome.status === "applied") createCommit(req.params.id, user.id, null, `${user.displayName || user.handle} added ${req.body.title}`);
    return outcome;
  });

  app.post<{ Params: { id: string; proposalId: string }; Body: { decision: "approve" | "reject"; comment?: string } }>("/api/v1/sessions/:id/proposals/:proposalId/resolve", async (req, reply) => {
    const user = requireUser(req, reply);
    participantOr403(req.params.id, user.id);
    try {
      return resolveProposal(req.params.id, req.params.proposalId, user.id, req.body.decision, req.body.comment);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  // Review and sign-off of the design document.
  app.post<{ Params: { id: string; artifactId: string }; Body: { reviewers: string[]; note?: string } }>("/api/v1/sessions/:id/review/:artifactId/request", async (req, reply) => {
    const user = requireUser(req, reply);
    const me = participantOr403(req.params.id, user.id);
    if (me.role === "viewer") return reply.code(403).send({ error: "viewers cannot request reviews" });
    const r = requestReview(req.params.id, req.params.artifactId, user.id, Array.isArray(req.body?.reviewers) ? req.body.reviewers : [], req.body?.note);
    if (!r.ok) return reply.code(r.status).send({ error: r.error });
    return { reviewers: r.reviewers };
  });
  app.post<{ Params: { id: string; artifactId: string } }>("/api/v1/sessions/:id/review/:artifactId/sign", async (req, reply) => {
    const user = requireUser(req, reply);
    const me = participantOr403(req.params.id, user.id);
    if (me.role === "viewer") return reply.code(403).send({ error: "viewers cannot sign" });
    const r = signOff(req.params.id, req.params.artifactId, user.id);
    if (!r.ok) return reply.code(r.status).send({ error: r.error });
    return { approved: r.approved, signed: r.signed, needed: r.needed, decisionLabel: r.decisionLabel ?? null };
  });
  app.post<{ Params: { id: string; artifactId: string }; Body: { reason?: string } | undefined }>("/api/v1/sessions/:id/review/:artifactId/withdraw", async (req, reply) => {
    const user = requireUser(req, reply);
    const me = participantOr403(req.params.id, user.id);
    if (me.role === "viewer") return reply.code(403).send({ error: "viewers cannot withdraw a review" });
    const r = withdrawReview(req.params.id, req.params.artifactId, user.id, req.body?.reason ?? "");
    if (!r.ok) return reply.code(r.status).send({ error: r.error });
    return { ok: true };
  });

  // Open the vote between the candidates on an alternatives card.
  app.post<{ Params: { id: string; artifactId: string } }>("/api/v1/sessions/:id/alternatives/:artifactId/decide", async (req, reply) => {
    const user = requireUser(req, reply);
    const me = participantOr403(req.params.id, user.id);
    if (me.role === "viewer") return reply.code(403).send({ error: "viewers cannot open decisions" });
    const r = openAlternativesDecision(req.params.id, req.params.artifactId, user.id);
    if ("error" in r) return reply.code(400).send({ error: r.error });
    return r;
  });

  app.post<{ Params: { id: string; artifactId: string }; Body: { optionId: string } }>("/api/v1/sessions/:id/decision-points/:artifactId/vote", async (req, reply) => {
    const user = requireUser(req, reply);
    const me = participantOr403(req.params.id, user.id);
    if (me.role === "viewer") return reply.code(403).send({ error: "viewers cannot vote" });
    const state = getState(req.params.id);
    const dp = state.artifacts[req.params.artifactId];
    if (!dp || dp.type !== "decision_point") return reply.code(404).send({ error: "decision point not found" });
    const content = dp.current.content as DecisionPointContent;
    if (content.resolvedOptionId) return reply.code(400).send({ error: "already resolved" });
    if (!content.options.some((o) => o.id === req.body.optionId)) return reply.code(400).send({ error: "unknown option" });
    appendEvent(req.params.id, { type: "decision.voted", actorKind: "user", actorUserId: user.id, causedBy: [dp.current.eventId], payload: { decisionPointArtifactId: dp.id, optionId: req.body.optionId } });

    // Resolution rule (hybrid): majority of editors; consensus: all editors.
    const after = getState(req.params.id);
    const votes = (after.artifacts[dp.id]!.current.content as DecisionPointContent).votes;
    const editors = Object.values(after.participants).filter((p) => p.role !== "viewer");
    const tally = new Map<string, number>();
    for (const v of Object.values(votes)) tally.set(v, (tally.get(v) ?? 0) + 1);
    const needed = after.policy === "consensus" ? editors.length : Math.floor(editors.length / 2) + 1;
    const winner = [...tally.entries()].find(([, n]) => n >= needed)?.[0];
    if (!winner) return { resolved: false, votes };

    appendEvent(req.params.id, { type: "decision.resolved", actorKind: "system", actorUserId: null, causedBy: [dp.current.eventId], payload: { decisionPointArtifactId: dp.id, optionId: winner, decisionId: null } });
    // A choice between alternatives is applied here, deterministically: no AI turn is needed.
    if (content.alternativesArtifactId) {
      const voters = Object.entries(votes).filter(([, v]) => v === winner).map(([u]) => u);
      const adopted = adoptAlternative(req.params.id, content.alternativesArtifactId, winner, voters, [dp.current.eventId]);
      if (!adopted.ok) return reply.code(500).send({ error: adopted.error });
      return { resolved: true, optionId: winner, adopted: true, decisionLabel: adopted.label };
    }
    const conflict = Object.values(after.conflicts).find((c) => c.decisionPointArtifactId === dp.id);
    const option = content.options.find((o) => o.id === winner)!;
    const voters = Object.entries(votes).filter(([, v]) => v === winner).map(([u]) => after.participants[u]?.name ?? u);
    const supersedes = conflict?.contradicts.decisionId ? ` It supersedes decision ${conflict.contradicts.decisionId}.` : "";
    const directive = appendEvent(req.params.id, {
      type: "message.posted",
      actorKind: "system",
      actorUserId: null,
      causedBy: conflict?.directiveEventIds.length ? [conflict.directiveEventIds[0]!] : [dp.current.eventId],
      payload: { text: `Decision point "${content.question}" was resolved with option "${option.title}" (voters: ${voters.join(", ")}).${supersedes} Record the decision and apply the outcome to the blocked artifacts.`, mode: "directive", attachments: [] },
    });
    brokerFor(req.params.id).onDirective(directive);
    return { resolved: true, optionId: winner };
  });

  // Two versions of the design side by side: the document text plus the session state each version
  // was written in. Either side may be in another session (a fork and its origin). Computed, no AI
  // turn; the AI is asked to say what matters only when requested.
  interface DocRef { sessionId: string; artifactId: string; versionNo: number }
  function docVersion(ref: DocRef) {
    if (!sessionExists(ref.sessionId)) return null;
    const state = getState(ref.sessionId);
    const a = state.artifacts[ref.artifactId];
    if (!a || a.deleted || a.type !== "design_doc") return null;
    const version = a.versions.find((v) => v.versionNo === ref.versionNo);
    if (!version) return null;
    const events = listEvents(ref.sessionId);
    const seq = events.find((e) => e.id === version.eventId)?.seq ?? Number.MAX_SAFE_INTEGER;
    return { artifact: a, version, state: reduceUpTo(ref.sessionId, events, seq), sessionTitle: state.title };
  }
  function compareDoc(from: DocRef, to: DocRef) {
    const A = docVersion(from);
    const B = docVersion(to);
    if (!A || !B) return { error: `no such version (${!A ? `v${from.versionNo} on the earlier side` : `v${to.versionNo} on the later side`})` };
    const cross = from.sessionId !== to.sessionId;
    const md = (v: typeof A.version) => (v.content as { markdown?: string }).markdown ?? "";
    const comparison = compareDesign(A.state, B.state, md(A.version), md(B.version), { from: { versionNo: A.version.versionNo, at: A.version.createdAt }, to: { versionNo: B.version.versionNo, at: B.version.createdAt } });
    const labels = cross ? { from: `${A.sessionTitle} v${from.versionNo}`, to: `${B.sessionTitle} v${to.versionNo}` } : undefined;
    const title = labels ? `Changes: ${labels.from} → ${labels.to}` : `Changes: ${B.artifact.title} v${from.versionNo} → v${to.versionNo}`;
    return { artifact: B.artifact, vFrom: A.version, vTo: B.version, comparison, markdown: comparisonMarkdown(comparison, B.artifact.title, labels), title, cross };
  }
  /** The design document this one descends from, when the session is a fork and the person can see the origin. */
  function originDoc(sessionId: string, doc: { title: string }, userId: string): { sessionId: string; sessionTitle: string; artifactId: string; versions: { versionNo: number; createdAt: string }[] } | null {
    const row = db.select({ from: schema.sessions.forkedFromSessionId }).from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get();
    if (!row?.from || !sessionExists(row.from)) return null;
    const isMember = db.select({ userId: schema.participants.userId }).from(schema.participants).where(and(eq(schema.participants.sessionId, row.from), eq(schema.participants.userId, userId))).get();
    if (!isMember) return null;
    const src = getState(row.from);
    const docs = liveArtifacts(src).filter((a) => a.type === "design_doc");
    const pick = docs.find((a) => a.title === doc.title) ?? (docs.length === 1 ? docs[0] : undefined);
    if (!pick) return null;
    return { sessionId: row.from, sessionTitle: src.title, artifactId: pick.id, versions: pick.versions.map((v) => ({ versionNo: v.versionNo, createdAt: v.createdAt })) };
  }
  function fromRef(req: { params: { id: string; artifactId: string } }, q: { fromSession?: string; fromArtifact?: string; from?: string | number }, userId: string, fallbackFrom: number): DocRef | { error: string } {
    const versionNo = Number(q.from) || fallbackFrom;
    if (!q.fromSession || q.fromSession === req.params.id) return { sessionId: req.params.id, artifactId: req.params.artifactId, versionNo };
    if (!sessionExists(q.fromSession)) return { error: "no such session on the earlier side" };
    const member = db.select({ userId: schema.participants.userId }).from(schema.participants).where(and(eq(schema.participants.sessionId, q.fromSession), eq(schema.participants.userId, userId))).get();
    if (!member) return { error: "you are not a participant of the earlier session" };
    let artifactId = q.fromArtifact;
    if (!artifactId) {
      const here = getState(req.params.id).artifacts[req.params.artifactId];
      const docs = liveArtifacts(getState(q.fromSession)).filter((a) => a.type === "design_doc");
      artifactId = (docs.find((a) => a.title === here?.title) ?? (docs.length === 1 ? docs[0] : undefined))?.id;
      if (!artifactId) return { error: "the earlier session has no matching design document; pass fromArtifact" };
    }
    return { sessionId: q.fromSession, artifactId, versionNo };
  }

  app.get<{ Params: { id: string; artifactId: string }; Querystring: { from?: string; to?: string; fromSession?: string; fromArtifact?: string } }>("/api/v1/sessions/:id/artifacts/:artifactId/compare", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!sessionExists(req.params.id)) return reply.code(404).send({ error: "not found" });
    participantOr403(req.params.id, user.id);
    const state = getState(req.params.id);
    const a = state.artifacts[req.params.artifactId];
    if (!a || a.deleted || a.type !== "design_doc") return reply.code(404).send({ error: "no such design document" });
    const toNo = Number(req.query.to) || a.current.versionNo;
    const pub = state.publications[a.id];
    const lastPub = pub?.status === "live" ? pub.versions[pub.versions.length - 1]?.docVersionNo : undefined;
    const from = fromRef(req, req.query, user.id, lastPub && lastPub < toNo ? lastPub : Math.max(1, toNo - 1));
    if ("error" in from) return reply.code(400).send({ error: from.error });
    const r = compareDoc(from, { sessionId: req.params.id, artifactId: a.id, versionNo: toNo });
    if ("error" in r) return reply.code(400).send({ error: r.error });
    return { comparison: r.comparison, markdown: r.markdown, title: r.title, cross: r.cross };
  });

  app.post<{ Params: { id: string; artifactId: string }; Body: { from: number; to?: number; narrate?: boolean; fromSession?: string; fromArtifact?: string } }>("/api/v1/sessions/:id/artifacts/:artifactId/compare", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!sessionExists(req.params.id)) return reply.code(404).send({ error: "not found" });
    const me = participantOr403(req.params.id, user.id);
    if (me.role === "viewer") return reply.code(403).send({ error: "viewers cannot add cards" });
    const state = getState(req.params.id);
    const a = state.artifacts[req.params.artifactId];
    if (!a || a.deleted || a.type !== "design_doc") return reply.code(404).send({ error: "no such design document" });
    const toNo = Number(req.body?.to) || a.current.versionNo;
    if (!Number(req.body?.from)) return reply.code(400).send({ error: "from is needed" });
    const from = fromRef(req, req.body ?? {}, user.id, 1);
    if ("error" in from) return reply.code(400).send({ error: from.error });
    const r = compareDoc(from, { sessionId: req.params.id, artifactId: a.id, versionNo: toNo });
    if ("error" in r) return reply.code(400).send({ error: r.error });
    const title = r.title;
    const existing = Object.values(state.artifacts).find((x) => x.type === "markdown" && !x.deleted && x.title === title);
    const out = requestChange({ sessionId: req.params.id, turnId: null, actorKind: "user", actorUserId: user.id, op: existing ? "update" : "create", artifactId: existing?.id ?? null, artifactType: "markdown", title, content: { markdown: r.markdown, sections: [{ id: "body", derivedFrom: [r.vTo.eventId] }] }, summary: r.cross ? `What changed between ${from.versionNo === r.vFrom.versionNo ? "" : ""}the original session's v${r.vFrom.versionNo} and this v${toNo}` : `What changed between v${r.vFrom.versionNo} and v${toNo} of ${a.title}`, rationale: "Comparison of two versions of the design document", baseVersionNo: existing?.current.versionNo ?? null, causedBy: [], force: true });
    if (out.status !== "applied") return reply.code(409).send({ error: `could not save the comparison: ${out.status}` });
    let eventId: string | undefined;
    if (req.body?.narrate) {
      if (!me.consentedAt) return reply.code(403).send({ error: "accept the note in the AI lane first (everything posted is sent to the AI provider); the card is saved" });
      const ev = appendEvent(req.params.id, { type: "message.posted", actorKind: "user", actorUserId: user.id, payload: { text: NARRATE_INSTRUCTION, mode: "directive", attachments: [out.artifactId], intent: "compare" } });
      brokerFor(req.params.id).onDirective(ev);
      brokerFor(req.params.id).sendNow();
      eventId = ev.id;
    }
    return { artifactId: out.artifactId, versionNo: out.versionNo, title, narrated: Boolean(req.body?.narrate), ...(eventId ? { eventId } : {}) };
  });

  // Compile the canvas into a design document. Runs as a normal AI turn funded by the requester
  // (or the sponsor) with a fixed instruction; the assembler includes every artifact in full.
  app.post<{ Params: { id: string } }>("/api/v1/sessions/:id/compile", async (req, reply) => {
    const user = requireUser(req, reply);
    const me = participantOr403(req.params.id, user.id);
    if (me.role === "viewer") return reply.code(403).send({ error: "viewers cannot compile" });
    if (!me.consentedAt) return reply.code(403).send({ error: "accept the note in the AI lane first (everything posted is sent to the AI provider); then compile" });
    const ev = appendEvent(req.params.id, {
      type: "message.posted",
      actorKind: "user",
      actorUserId: user.id,
      payload: {
        text: COMPILE_INSTRUCTION,
        mode: "directive",
        attachments: [],
        intent: "compile",
      },
    });
    brokerFor(req.params.id).onDirective(ev);
    brokerFor(req.params.id).sendNow();
    return { eventId: ev.id };
  });

  app.post<{ Params: { id: string }; Body: { commitId: string } }>("/api/v1/sessions/:id/revert", async (req, reply) => {
    const user = requireUser(req, reply);
    const me = participantOr403(req.params.id, user.id);
    if (me.role === "viewer") return reply.code(403).send({ error: "viewers cannot revert" });
    try {
      return revertTo(req.params.id, req.body.commitId, user.id);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  // Fork: a new session that starts from the current canvas (every live artifact as v1,
  // every non-superseded decision, participants re-invited). The original stays intact.
  app.post<{ Params: { id: string }; Body: { title?: string } }>("/api/v1/sessions/:id/fork", async (req, reply) => {
    const user = requireUser(req, reply);
    const me = participantOr403(req.params.id, user.id);
    if (me.role === "viewer") return reply.code(403).send({ error: "viewers cannot fork" });
    const src = db.select().from(schema.sessions).where(eq(schema.sessions.id, req.params.id)).get()!;
    const state = getState(req.params.id);
    const id = ulid();
    const ts = now();
    const bumped = src.title.match(/^(.*)\bv(\d+)\s*$/i);
    const title = req.body?.title?.trim() || (bumped ? `${bumped[1]}v${Number(bumped[2]) + 1}` : `${src.title} v2`);
    db.insert(schema.sessions)
      .values({ id, title, template: src.template, policy: src.policy, payerMode: src.payerMode, pinnedModel: src.pinnedModel, provider: src.provider, sponsorCredentialId: src.payerMode === "sponsor" ? (findCredentialForUser(user.id, src.provider)?.id ?? src.sponsorCredentialId) : null, forkedFromSessionId: src.id, forkedAtCommitId: state.headCommitId, createdBy: user.id, createdAt: ts, updatedAt: ts })
      .run();
    appendEvent(id, { type: "session.created", actorKind: "system", actorUserId: user.id, payload: { title, policy: src.policy as Policy, payerMode: src.payerMode as "sponsor" | "speaker", pinnedModel: src.pinnedModel, ...(src.template ? { template: src.template } : {}), forkedFrom: { sessionId: src.id, commitId: state.headCommitId, title: src.title } } });
    const parts = db.select().from(schema.participants).where(eq(schema.participants.sessionId, src.id)).all();
    for (const p of parts) {
      const role = p.userId === user.id ? "owner" : p.role === "owner" ? "editor" : p.role;
      // Same provider, same payer mode, same people: the consent given in the original holds here.
      db.insert(schema.participants).values({ sessionId: id, userId: p.userId, role, credentialId: null, color: p.color, consentedAt: p.consentedAt, joinedAt: ts }).run();
      const sp = state.participants[p.userId];
      appendEvent(id, { type: "participant.joined", actorKind: "user", actorUserId: p.userId, payload: { role: role as "owner" | "editor" | "viewer", name: sp?.name ?? p.userId, color: p.color, avatarUrl: sp?.avatarUrl } });
      if (p.consentedAt) appendEvent(id, { type: "participant.consented", actorKind: "user", actorUserId: p.userId, payload: { providers: [src.provider] } });
    }
    for (const a of Object.values(state.artifacts).filter((x) => !x.deleted && x.type !== "decision_point")) {
      appendEvent(id, {
        type: "artifact.applied",
        actorKind: a.current.authorKind,
        actorUserId: a.current.authorUserId,
        causedBy: [],
        payload: { artifactId: ulid(), artifactType: a.type, title: a.title, versionId: ulid(), versionNo: 1, op: "create", proposalId: null, content: a.current.content, summary: a.current.summary, authorKind: a.current.authorKind, authorUserId: a.current.authorUserId, provenance: a.current.provenance, contentHash: contentHash(a.current.content) },
      });
    }
    for (const d of Object.values(state.decisions).filter((x) => x.status !== "superseded").sort((x, y) => x.label.localeCompare(y.label))) {
      appendEvent(id, { type: "decision.recorded", actorKind: "system", actorUserId: null, causedBy: [], payload: { decisionId: ulid(), label: d.label, statement: d.statement, status: d.status, supersedes: null, agreedBy: d.agreedBy, evidence: [] } });
    }
    appendEvent(id, { type: "brief.updated", actorKind: "system", actorUserId: null, payload: { brief: `Forked from "${src.title}" (session ${src.id}) at commit ${state.headCommitId ?? "none"} on ${ts}. The canvas and agreed decisions were carried over; superseded decisions and resolved decision points were not.`, throughSeq: 0 } });
    createCommit(id, user.id, null, `Forked from ${src.title}`);
    return { id, title };
  });

  app.post<{ Params: { id: string; callId: string }; Body: { decision: "approved" | "denied"; reason?: string; remember?: boolean } }>("/api/v1/sessions/:id/external-calls/:callId/resolve", async (req, reply) => {
    const user = requireUser(req, reply);
    participantOr403(req.params.id, user.id);
    try {
      return resolveExternalCall(req.params.id, req.params.callId, user.id, req.body.decision === "approved" ? "approved" : "denied", req.body.reason, Boolean(req.body.remember));
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  // A deadline on an open decision point: when it passes without a majority the point expires and unblocks its cards.
  app.post<{ Params: { id: string; artifactId: string }; Body: { at?: string; minutes?: number } }>("/api/v1/sessions/:id/decision-points/:artifactId/deadline", async (req, reply) => {
    const user = requireUser(req, reply);
    const me = participantOr403(req.params.id, user.id);
    if (me.role === "viewer") return reply.code(403).send({ error: "viewers cannot set deadlines" });
    const state = getState(req.params.id);
    const dp = state.artifacts[req.params.artifactId];
    if (!dp || dp.type !== "decision_point" || dp.deleted) return reply.code(404).send({ error: "decision point not found" });
    const c = dp.current.content as DecisionPointContent;
    if (c.resolvedOptionId || c.expired) return reply.code(400).send({ error: "already closed" });
    const at = req.body?.at ? new Date(req.body.at) : new Date(Date.now() + Math.max(0.05, Number(req.body?.minutes ?? 60)) * 60_000);
    if (Number.isNaN(at.getTime())) return reply.code(400).send({ error: "bad deadline" });
    appendEvent(req.params.id, { type: "decision.deadline_set", actorKind: "user", actorUserId: user.id, causedBy: [dp.current.eventId], payload: { decisionPointArtifactId: dp.id, at: at.toISOString() } });
    scheduleExpiry(req.params.id, dp.id, at.toISOString());
    return { at: at.toISOString() };
  });

  app.post<{ Params: { id: string }; Body: { seq: number } }>("/api/v1/sessions/:id/seen", async (req, reply) => {
    const user = requireUser(req, reply);
    participantOr403(req.params.id, user.id);
    markSeen(req.params.id, user.id, Number(req.body?.seq ?? 0));
    return { ok: true };
  });

  app.get("/api/v1/digest", async (req, reply) => {
    const user = requireUser(req, reply);
    return { sessions: digestFor(user.id) };
  });

  // Refresh the brief by hand: folds everything but the last few messages. Costs one provider request.
  app.post<{ Params: { id: string } }>("/api/v1/sessions/:id/brief", async (req, reply) => {
    const user = requireUser(req, reply);
    const me = participantOr403(req.params.id, user.id);
    if (me.role === "viewer") return reply.code(403).send({ error: "viewers cannot refresh the brief" });
    return maybeCompact(req.params.id, { force: true });
  });

  app.get<{ Params: { id: string; artifactId: string }; Querystring: { v?: string } }>("/api/v1/sessions/:id/artifacts/:artifactId", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!sessionExists(req.params.id)) return reply.code(404).send({ error: "not found" });
    participantOr403(req.params.id, user.id);
    const state = getState(req.params.id);
    const a = state.artifacts[req.params.artifactId];
    if (!a || a.deleted) return reply.code(404).send({ error: "no such card" });
    const want = Number(req.query.v) || a.current.versionNo;
    const v = a.versions.find((x) => x.versionNo === want) ?? a.current;
    const markdown = a.type === "design_doc" || a.type === "markdown" ? (v.content as { markdown?: string }).markdown ?? "" : contentText(a.type, v.content);
    const review = state.reviews[a.id];
    const pub = db.select({ slug: schema.publications.slug, revokedAt: schema.publications.revokedAt }).from(schema.publications).where(and(eq(schema.publications.sessionId, req.params.id), eq(schema.publications.artifactId, a.id))).get();
    const session = db.select({ demo: schema.sessions.demo }).from(schema.sessions).where(eq(schema.sessions.id, req.params.id)).get();
    return {
      sessionId: req.params.id,
      sessionTitle: state.title,
      demo: (session?.demo ?? 0) > 0,
      origin: a.type === "design_doc" ? originDoc(req.params.id, a, user.id) : null,
      artifact: { id: a.id, title: a.title, type: a.type, versionNo: v.versionNo, authorName: `${v.authorKind === "ai" ? "AI for " : ""}${participantName(state, v.authorUserId)}`, createdAt: v.createdAt, markdown },
      versions: a.versions.map((x) => ({ versionNo: x.versionNo, authorName: `${x.authorKind === "ai" ? "AI for " : ""}${participantName(state, x.authorUserId)}`, createdAt: x.createdAt })),
      review: review ? { status: review.status, approvedVersionNo: review.approvedVersionNo, signerNames: review.status === "approved" ? review.reviewers.map((u) => participantName(state, u)) : [], decisionLabel: review.decisionId ? state.decisions[review.decisionId]?.label : undefined } : null,
      published: pub && !pub.revokedAt ? { slug: pub.slug } : null,
    };
  });

  app.get<{ Params: { id: string } }>("/api/v1/sessions/:id/adrs", async (req, reply) => {
    const user = requireUser(req, reply);
    participantOr403(req.params.id, user.id);
    return { files: allAdrs(getState(req.params.id)).map((f) => ({ filename: f.filename, markdown: f.markdown, label: f.decision.label, status: f.decision.status })) };
  });

  app.get<{ Params: { id: string }; Querystring: { format?: string } }>("/api/v1/sessions/:id/export", async (req, reply) => {
    const user = requireUser(req, reply);
    participantOr403(req.params.id, user.id);
    const state = getState(req.params.id);
    if (req.query.format === "json") return listEvents(req.params.id);
    if (req.query.format === "structurizr") {
      const model = liveArtifacts(state).find((a) => a.type === "arch_model")?.current.content as ArchModelContent | undefined;
      if (!model) return reply.code(404).send({ error: "no architecture model to export" });
      reply.header("Content-Type", "text/plain; charset=utf-8");
      reply.header("Content-Disposition", `attachment; filename="${state.title.replace(/[^\w-]+/g, "-") || "session"}.dsl"`);
      return toStructurizrDsl(model, state.title);
    }
    reply.header("Content-Type", "text/markdown; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="${state.title.replace(/[^\w-]+/g, "-") || "session"}.md"`);
    return exportMarkdown(state);
  });
}

// A valid anchor names a live card; a component anchor must exist in the architecture model.
function anchorOf(state: ReturnType<typeof getState>, raw: MessageAnchor | undefined): MessageAnchor | undefined {
  if (!raw || typeof raw.artifactId !== "string") return undefined;
  const art = state.artifacts[raw.artifactId];
  if (!art || art.deleted) return undefined;
  const anchor: MessageAnchor = { artifactId: raw.artifactId };
  if (raw.componentId) {
    const model = Object.values(state.artifacts).find((a) => a.type === "arch_model" && !a.deleted)?.current.content as ArchModelContent | undefined;
    if (!model?.components.some((c) => c.id === raw.componentId)) return undefined;
    anchor.componentId = raw.componentId;
  }
  return anchor;
}
