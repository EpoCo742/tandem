import { and, eq } from "drizzle-orm";
import type { DecisionPointContent, SessionState } from "@tandem/shared";
import { liveArtifacts, pendingProposals } from "@tandem/shared";
import { db, schema } from "./db/index.js";
import { appendEvent, getState } from "./ledger.js";

// Reach for people who are not in the room: deadlines that close a decision point instead of
// leaving it open forever, and a digest of what is waiting on a person and what changed since
// they last looked.

const timers = new Map<string, NodeJS.Timeout>();

function isOpen(state: SessionState, dpId: string): DecisionPointContent | null {
  const a = state.artifacts[dpId];
  if (!a || a.deleted || a.type !== "decision_point") return null;
  const c = a.current.content as DecisionPointContent;
  return c.resolvedOptionId || c.expired ? null : c;
}

/** Arm (or re-arm) the expiry of a decision point. Past deadlines expire at once. */
export function scheduleExpiry(sessionId: string, dpId: string, at: string) {
  const key = `${sessionId}:${dpId}`;
  const old = timers.get(key);
  if (old) clearTimeout(old);
  const delay = Math.max(0, new Date(at).getTime() - Date.now());
  const fire = () => {
    timers.delete(key);
    const state = getState(sessionId);
    const c = isOpen(state, dpId);
    if (!c || c.deadline !== at) return; // resolved meanwhile, or the deadline moved
    appendEvent(sessionId, { type: "decision.expired", actorKind: "system", actorUserId: null, causedBy: [state.artifacts[dpId]!.current.eventId], payload: { decisionPointArtifactId: dpId } });
  };
  timers.set(key, setTimeout(fire, Math.min(delay, 2_147_000_000)));
}

/** On startup: re-arm every open deadline, and expire the ones that passed while the server was down. */
export function rehydrateDeadlines() {
  const sessions = db.select({ id: schema.sessions.id }).from(schema.sessions).all();
  let armed = 0;
  for (const s of sessions) {
    const state = getState(s.id);
    for (const a of liveArtifacts(state)) {
      if (a.type !== "decision_point") continue;
      const c = isOpen(state, a.id);
      if (c?.deadline) {
        scheduleExpiry(s.id, a.id, c.deadline);
        armed += 1;
      }
    }
  }
  if (armed) console.log(`[tandem] re-armed ${armed} decision point deadline(s)`);
}

export function markSeen(sessionId: string, userId: string, seq: number) {
  const row = db.select().from(schema.participants).where(and(eq(schema.participants.sessionId, sessionId), eq(schema.participants.userId, userId))).get();
  if (!row) return;
  if (seq > row.lastSeenSeq) db.update(schema.participants).set({ lastSeenSeq: seq }).where(and(eq(schema.participants.sessionId, sessionId), eq(schema.participants.userId, userId))).run();
}

export interface DigestSession {
  sessionId: string;
  title: string;
  lastSeenSeq: number;
  lastSeq: number;
  waiting: {
    decisionPoints: { artifactId: string; question: string; deadline: string | null; options: { id: string; title: string }[]; votes: number; voters: number }[];
    proposals: { id: string; title: string; op: string; proposer: string; autoApplyAt: string | null }[];
    externalCalls: { id: string; summary: string; onBehalfOf: string }[];
    signoffs: { artifactId: string; title: string; versionNo: number; requestedBy: string; signed: number; needed: number }[];
  };
  since: {
    messages: number;
    aiReplies: number;
    decisions: string[];
    artifacts: string[];
    mentions: { eventId: string; from: string; text: string }[];
  };
  lastActivityAt: string;
}

/** Everything a person should know across their sessions, waiting items first. */
export function digestFor(userId: string): DigestSession[] {
  const rows = db.select().from(schema.participants).where(eq(schema.participants.userId, userId)).all();
  const out: DigestSession[] = [];
  for (const row of rows) {
    const state = getState(row.sessionId);
    if (!state.participants[userId]) continue;
    const name = (id: string | null) => (id ? state.participants[id]?.name ?? id : "AI");
    const editors = Object.values(state.participants).filter((p) => p.role !== "viewer");
    const decisionPoints = liveArtifacts(state)
      .filter((a) => a.type === "decision_point")
      .map((a) => ({ a, c: isOpen(state, a.id) }))
      .filter((x): x is { a: (typeof x)["a"]; c: DecisionPointContent } => Boolean(x.c) && !x.c!.votes?.[userId])
      .map(({ a, c }) => ({ artifactId: a.id, question: c.question, deadline: c.deadline ?? null, options: c.options.map((o) => ({ id: o.id, title: o.title })), votes: Object.keys(c.votes ?? {}).length, voters: editors.length }));
    const proposals = pendingProposals(state)
      .filter((p) => p.requiresApprovalFrom.includes(userId))
      .map((p) => ({ id: p.id, title: p.title, op: p.op, proposer: p.turnId ? `AI for ${name(p.proposerUserId)}` : name(p.proposerUserId), autoApplyAt: p.autoApplyAt }));
    const externalCalls = Object.values(state.externalCalls)
      .filter((c) => c.status === "pending" && c.ownerUserId === userId)
      .map((c) => ({ id: c.id, summary: c.summary, onBehalfOf: name(c.onBehalfOf) }));
    const signoffs = Object.values(state.reviews)
      .filter((r) => r.status === "in_review" && r.reviewers.includes(userId) && !r.signoffs[userId])
      .map((r) => ({ artifactId: r.artifactId, title: state.artifacts[r.artifactId]?.title ?? "Design document", versionNo: r.requestedVersionNo, requestedBy: name(r.requestedBy), signed: Object.keys(r.signoffs).length, needed: r.reviewers.length }));
    const fresh = state.messages.filter((m) => m.seq > row.lastSeenSeq);
    const since = {
      messages: fresh.filter((m) => m.kind === "user" && m.userId !== userId).length,
      aiReplies: fresh.filter((m) => m.kind === "ai").length,
      decisions: Object.values(state.decisions).filter((d) => (state.eventsById[d.eventId]?.seq ?? 0) > row.lastSeenSeq).map((d) => `${d.label} ${d.statement}`.slice(0, 120)),
      artifacts: [...new Set(liveArtifacts(state).filter((a) => (state.eventsById[a.current.eventId]?.seq ?? 0) > row.lastSeenSeq).map((a) => a.title))],
      mentions: fresh.filter((m) => m.kind === "user" && m.mentions?.includes(userId) && m.userId !== userId).map((m) => ({ eventId: m.eventId, from: name(m.userId), text: m.text.slice(0, 160) })),
    };
    const lastActivityAt = state.messages.length ? state.messages[state.messages.length - 1]!.createdAt : "";
    out.push({ sessionId: row.sessionId, title: state.title, lastSeenSeq: row.lastSeenSeq, lastSeq: state.lastSeq, waiting: { decisionPoints, proposals, externalCalls, signoffs }, since, lastActivityAt });
  }
  const weight = (d: DigestSession) => d.waiting.decisionPoints.length + d.waiting.proposals.length + d.waiting.externalCalls.length + d.waiting.signoffs.length;
  return out.sort((a, b) => weight(b) - weight(a) || b.lastActivityAt.localeCompare(a.lastActivityAt));
}

/** Resolve "@handle" and "@Name" in a message to participant ids. */
export function parseMentions(sessionId: string, text: string): string[] {
  if (!text.includes("@")) return [];
  const state = getState(sessionId);
  const ids = Object.keys(state.participants);
  if (!ids.length) return [];
  const users = db.select({ id: schema.users.id, handle: schema.users.handle }).from(schema.users).all().filter((u) => ids.includes(u.id));
  const found = new Set<string>();
  const lower = text.toLowerCase();
  for (const u of users) {
    const p = state.participants[u.id]!;
    const first = p.name.split(/\s+/)[0]?.toLowerCase() ?? "";
    for (const token of [u.handle.toLowerCase(), first, p.name.toLowerCase()]) {
      if (token && new RegExp(`@${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "i").test(lower)) found.add(u.id);
    }
  }
  return [...found];
}
