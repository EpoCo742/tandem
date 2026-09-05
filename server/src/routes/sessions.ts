import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { ulid } from "ulid";
import { randomBytes } from "node:crypto";
import { pickColor, type ArtifactType, type DecisionPointContent, type Policy } from "@tandem/shared";
import { db, now, schema } from "../db/index.js";
import { requireUser } from "../auth.js";
import { appendEvent, getState, listEvents, sessionExists } from "../ledger.js";
import { brokerFor } from "../turn/broker.js";
import { config } from "../config.js";
import { findCredentialForUser, listCredentials } from "../credentials.js";
import { contentHash, createCommit, requestChange, resolveProposal, revertTo } from "../governance.js";
import { maybeCompact } from "../context/compact.js";
import { resolveExternalCall } from "../external.js";
import { mintCollabToken } from "../crypto.js";
import { exportMarkdown } from "../export.js";

export const COMPILE_INSTRUCTION =
  "Compile the design document. Create (or update, if one exists) a design_doc artifact titled \"Design document\" that assembles everything on the canvas: Overview (what is being built, for whom), Architecture (embed every mermaid diagram as a fenced mermaid block, referencing the artifact by title), Data model (as Markdown tables: one table per entity with field, type and notes; never raw JSON), Sources (one or two sentences per uploaded file describing what it is and what was taken from it; never paste file contents), Decision log (every decision in the registry with status, who agreed, and what superseded what), and Open questions (proposed or contested decisions, unresolved decision points). Cite artifact ids in derivedFrom. Do not invent facts that are not on the canvas.";

function participantOr403(sessionId: string, userId: string) {
  const p = db.select().from(schema.participants).where(and(eq(schema.participants.sessionId, sessionId), eq(schema.participants.userId, userId))).get();
  if (!p) throw Object.assign(new Error("not a participant"), { statusCode: 403 });
  return p;
}

export async function registerSessionRoutes(app: FastifyInstance) {
  app.get("/api/v1/sessions", async (req, reply) => {
    const user = requireUser(req, reply);
    const rows = db
      .select({ s: schema.sessions })
      .from(schema.participants)
      .innerJoin(schema.sessions, eq(schema.participants.sessionId, schema.sessions.id))
      .where(eq(schema.participants.userId, user.id))
      .orderBy(desc(schema.sessions.updatedAt))
      .all();
    return rows.map(({ s }) => ({ id: s.id, title: s.title, policy: s.policy, payerMode: s.payerMode, pinnedModel: s.pinnedModel, provider: s.provider, createdAt: s.createdAt }));
  });

  app.post<{ Body: { title: string; policy?: Policy; payerMode?: "sponsor" | "speaker"; pinnedModel?: string; provider?: string; sponsorCredentialId?: string } }>("/api/v1/sessions", async (req, reply) => {
    const user = requireUser(req, reply);
    const provider = req.body.provider ?? config.defaultProvider;
    const creds = listCredentials(user.id).filter((c) => c.provider === provider && c.status === "active");
    const sponsor = req.body.sponsorCredentialId ? creds.find((c) => c.id === req.body.sponsorCredentialId) : creds[0];
    if ((req.body.payerMode ?? "sponsor") === "sponsor" && !sponsor) {
      return reply.code(400).send({ error: `Connect a ${provider} credential first; sponsor mode needs one on the creator.` });
    }
    const pinnedModel = req.body.pinnedModel ?? (sponsor?.models.includes(config.defaultModel) ? config.defaultModel : sponsor?.models[0] ?? config.defaultModel);
    const id = ulid();
    const ts = now();
    db.insert(schema.sessions)
      .values({ id, title: req.body.title || "Untitled session", policy: req.body.policy ?? "hybrid", payerMode: req.body.payerMode ?? "sponsor", pinnedModel, provider, sponsorCredentialId: sponsor?.id ?? null, createdBy: user.id, createdAt: ts, updatedAt: ts })
      .run();
    db.insert(schema.participants).values({ sessionId: id, userId: user.id, role: "owner", credentialId: sponsor?.id ?? null, color: pickColor(0), joinedAt: ts }).run();
    appendEvent(id, { type: "session.created", actorKind: "system", actorUserId: user.id, payload: { title: req.body.title, policy: req.body.policy ?? "hybrid", payerMode: req.body.payerMode ?? "sponsor", pinnedModel } });
    appendEvent(id, { type: "participant.joined", actorKind: "user", actorUserId: user.id, payload: { role: "owner", name: user.displayName || user.handle, color: pickColor(0), avatarUrl: user.avatarUrl ?? undefined } });
    return { id };
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
      createdBy: s.createdBy,
      forkedFrom: s.forkedFromSessionId ? { sessionId: s.forkedFromSessionId, commitId: s.forkedAtCommitId } : null,
      me: { role: me.role, consented: Boolean(me.consentedAt), hasCredential: Boolean(findCredentialForUser(user.id, s.provider)) },
      collabToken: mintCollabToken(s.id, user.id),
      lastSeq: getState(s.id).lastSeq,
    };
  });

  app.get<{ Params: { id: string }; Querystring: { from_seq?: string } }>("/api/v1/sessions/:id/events", async (req, reply) => {
    const user = requireUser(req, reply);
    participantOr403(req.params.id, user.id);
    return listEvents(req.params.id, Number(req.query.from_seq ?? 0));
  });

  app.post<{ Params: { id: string } }>("/api/v1/sessions/:id/invites", async (req, reply) => {
    const user = requireUser(req, reply);
    participantOr403(req.params.id, user.id);
    const token = randomBytes(12).toString("base64url");
    db.insert(schema.invites).values({ token, sessionId: req.params.id, role: "editor", createdBy: user.id, createdAt: now() }).run();
    return { token, url: `${config.appUrl}/join/${token}` };
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
      appendEvent(inv.sessionId, { type: "participant.joined", actorKind: "user", actorUserId: user.id, payload: { role: inv.role as "editor", name: user.displayName || user.handle, color, avatarUrl: user.avatarUrl ?? undefined } });
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

  app.post<{ Params: { id: string }; Body: { text: string; mode?: "directive" | "note"; replyTo?: string; attachments?: string[] } }>("/api/v1/sessions/:id/messages", async (req, reply) => {
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
    const ev = appendEvent(req.params.id, { type: "message.posted", actorKind: "user", actorUserId: user.id, payload: { text, mode, attachments, replyTo: req.body.replyTo } });
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
    const p = note.payload as { text: string };
    const ev = appendEvent(req.params.id, { type: "message.posted", actorKind: "user", actorUserId: note.actorUserId, causedBy: [note.id], payload: { text: p.text, mode: "promoted", attachments: [], fromNoteEventId: note.id } });
    brokerFor(req.params.id).onDirective(ev);
    return { eventId: ev.id };
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

  // Compile the canvas into a design document. Runs as a normal AI turn funded by the requester
  // (or the sponsor) with a fixed instruction; the assembler includes every artifact in full.
  app.post<{ Params: { id: string } }>("/api/v1/sessions/:id/compile", async (req, reply) => {
    const user = requireUser(req, reply);
    const me = participantOr403(req.params.id, user.id);
    if (me.role === "viewer") return reply.code(403).send({ error: "viewers cannot compile" });
    if (!me.consentedAt) return reply.code(403).send({ error: "consent required" });
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
      .values({ id, title, policy: src.policy, payerMode: src.payerMode, pinnedModel: src.pinnedModel, provider: src.provider, sponsorCredentialId: src.payerMode === "sponsor" ? (findCredentialForUser(user.id, src.provider)?.id ?? src.sponsorCredentialId) : null, forkedFromSessionId: src.id, forkedAtCommitId: state.headCommitId, createdBy: user.id, createdAt: ts, updatedAt: ts })
      .run();
    appendEvent(id, { type: "session.created", actorKind: "system", actorUserId: user.id, payload: { title, policy: src.policy as Policy, payerMode: src.payerMode as "sponsor" | "speaker", pinnedModel: src.pinnedModel, forkedFrom: { sessionId: src.id, commitId: state.headCommitId, title: src.title } } });
    const parts = db.select().from(schema.participants).where(eq(schema.participants.sessionId, src.id)).all();
    for (const p of parts) {
      const role = p.userId === user.id ? "owner" : p.role === "owner" ? "editor" : p.role;
      db.insert(schema.participants).values({ sessionId: id, userId: p.userId, role, credentialId: null, color: p.color, consentedAt: null, joinedAt: ts }).run();
      const sp = state.participants[p.userId];
      appendEvent(id, { type: "participant.joined", actorKind: "user", actorUserId: p.userId, payload: { role: role as "owner" | "editor" | "viewer", name: sp?.name ?? p.userId, color: p.color, avatarUrl: sp?.avatarUrl } });
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

  // Refresh the brief by hand: folds everything but the last few messages. Costs one provider request.
  app.post<{ Params: { id: string } }>("/api/v1/sessions/:id/brief", async (req, reply) => {
    const user = requireUser(req, reply);
    const me = participantOr403(req.params.id, user.id);
    if (me.role === "viewer") return reply.code(403).send({ error: "viewers cannot refresh the brief" });
    return maybeCompact(req.params.id, { force: true });
  });

  app.get<{ Params: { id: string }; Querystring: { format?: string } }>("/api/v1/sessions/:id/export", async (req, reply) => {
    const user = requireUser(req, reply);
    participantOr403(req.params.id, user.id);
    const state = getState(req.params.id);
    if (req.query.format === "json") return listEvents(req.params.id);
    reply.header("Content-Type", "text/markdown; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="${state.title.replace(/[^\w-]+/g, "-") || "session"}.md"`);
    return exportMarkdown(state);
  });
}
