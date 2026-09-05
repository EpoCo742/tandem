import { eq } from "drizzle-orm";
import type { ChatMessage } from "@tandem/shared";
import { participantName } from "@tandem/shared";
import { appendEvent, getState } from "../ledger.js";
import { db, schema } from "../db/index.js";
import { config } from "../config.js";
import { getProvider } from "../providers/index.js";
import type { SummaryMessage, SummaryRequest } from "../providers/types.js";
import { findCredentialForUser, loadRawCredential, type RawCredential } from "../credentials.js";
import { TRANSCRIPT_WINDOW } from "./assemble.js";

// Compaction keeps long sessions inside the prompt budget without losing who said what.
// Messages that have fallen out of the transcript window are folded into a running brief
// that names the speaker and the event id of every point, so attribution survives the cut.
// The brief is stored as a ledger event and rendered at the top of every later prompt.

const inFlight = new Set<string>();
const FORCE_KEEP = 6; // messages left uncompacted on a manual "refresh brief"

function credentialFor(sessionId: string): RawCredential | null {
  const session = db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get();
  if (!session) return null;
  if (session.sponsorCredentialId) {
    const c = loadRawCredential(session.sponsorCredentialId);
    if (c) return c;
  }
  const creator = findCredentialForUser(session.createdBy, session.provider);
  if (creator) return creator;
  const state = getState(sessionId);
  for (const p of Object.values(state.participants)) {
    const c = findCredentialForUser(p.userId, session.provider);
    if (c) return c;
  }
  return null;
}

function toSummaryMessages(sessionId: string, msgs: ChatMessage[]): SummaryMessage[] {
  const state = getState(sessionId);
  return msgs.map((m) => ({
    eventId: m.eventId,
    seq: m.seq,
    kind: m.kind,
    speaker: m.kind === "user" ? (m.userId ? participantName(state, m.userId) : "System") : m.kind === "ai" ? `AI for ${participantName(state, m.onBehalfOf)}` : m.kind === "clarification" ? "AI (question)" : "System",
    text: m.text,
  }));
}

export interface CompactOutcome {
  status: "compacted" | "nothing_to_compact" | "no_credential" | "busy" | "disabled" | "failed";
  throughSeq?: number;
  folded?: number;
  error?: string;
}

/**
 * Fold messages that are out of the transcript window into the brief. Automatic runs wait
 * until at least `config.compactAfter` messages are outside the window; a forced run folds
 * everything but the last few messages regardless.
 */
export async function maybeCompact(sessionId: string, opts: { force?: boolean } = {}): Promise<CompactOutcome> {
  if (!opts.force && config.compactAfter <= 0) return { status: "disabled" };
  if (inFlight.has(sessionId)) return { status: "busy" };
  const state = getState(sessionId);
  const transcript = state.messages.filter((m) => !(m.kind === "user" && m.mode === "note"));
  const keep = opts.force ? FORCE_KEEP : TRANSCRIPT_WINDOW;
  const cutoff = Math.max(0, transcript.length - keep);
  const older = transcript.slice(0, cutoff).filter((m) => m.seq > state.briefThroughSeq);
  if (older.length === 0 || (!opts.force && older.length < config.compactAfter)) return { status: "nothing_to_compact" };

  const cred = credentialFor(sessionId);
  if (!cred) return { status: "no_credential" };
  const session = db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get()!;
  const provider = getProvider(cred.provider);
  if (!provider.summarize) return { status: "disabled" };

  inFlight.add(sessionId);
  try {
    const throughSeq = older[older.length - 1]!.seq;
    const decisions = Object.values(state.decisions)
      .filter((d) => {
        const ev = state.eventsById[d.eventId];
        return ev && ev.seq > state.briefThroughSeq && ev.seq <= throughSeq;
      })
      .map((d) => ({ label: d.label, statement: d.statement, status: d.status, by: d.agreedBy.map((u) => participantName(state, u)).join(", ") }));
    const model = cred.models.includes(session.pinnedModel) || cred.models.length === 0 ? session.pinnedModel : cred.models[0]!;
    const req: SummaryRequest = {
      sessionId,
      model,
      token: cred.token,
      title: state.title,
      previousBrief: state.brief,
      messages: toSummaryMessages(sessionId, older),
      decisions,
      timeoutMs: Math.min(config.turnTimeoutMs, 120_000),
    };
    const brief = (await provider.summarize(req)).trim();
    if (!brief) return { status: "failed", error: "empty brief" };
    appendEvent(sessionId, {
      type: "brief.updated",
      actorKind: "system",
      actorUserId: null,
      payload: { brief, throughSeq, payerUserId: cred.userId, provider: cred.provider, model, folded: older.length },
    });
    return { status: "compacted", throughSeq, folded: older.length };
  } catch (e) {
    return { status: "failed", error: (e as Error).message };
  } finally {
    inFlight.delete(sessionId);
  }
}
