import { ulid } from "ulid";
import { eq } from "drizzle-orm";
import type { AnyLedgerEvent, LedgerEvent, TurnStatus } from "@tandem/shared";
import { appendEvent, getState } from "../ledger.js";
import { bus } from "../bus.js";
import { db, schema } from "../db/index.js";
import { config } from "../config.js";
import { assembleContext } from "../context/assemble.js";
import { getProvider } from "../providers/index.js";
import { buildToolBindings } from "../tools/executor.js";
import { createCommit } from "../governance.js";
import { findCredentialForUser, loadRawCredential, type RawCredential } from "../credentials.js";
import { maybeCompact } from "../context/compact.js";
import { serversForUser } from "../mcp.js";
import { gateExternalCall, recordExternalResult } from "../external.js";

// One broker per active session. Serializes AI turns: collect a batch, run one turn,
// apply, commit. Directives that arrive mid-turn queue for the next batch.

type State = "idle" | TurnStatus;

class SessionBroker {
  private state: State = "idle";
  private batch: LedgerEvent<"message.posted">[] = [];
  private queued: LedgerEvent<"message.posted">[] = [];
  private timer: NodeJS.Timeout | null = null;
  private batchOpenedAt = 0;
  private abort: AbortController | null = null;
  private currentTurnId: string | null = null;
  private currentPayer: string | null = null;

  constructor(private readonly sessionId: string) {}

  private publishState() {
    bus.publish(this.sessionId, {
      kind: "ephemeral",
      event: { kind: "turn.state", sessionId: this.sessionId, state: this.state, queued: this.queued.length + this.batch.length, turnId: this.currentTurnId, payerUserId: this.currentPayer },
    });
  }

  onDirective(ev: LedgerEvent<"message.posted">) {
    if (this.state === "idle" || this.state === "collecting") {
      if (this.state === "idle") {
        this.state = "collecting";
        this.batchOpenedAt = Date.now();
      }
      this.batch.push(ev);
      this.armTimer(config.batchWindowMs);
    } else {
      this.queued.push(ev);
    }
    this.publishState();
  }

  extendWindow() {
    if (this.state !== "collecting" || !this.timer) return;
    const elapsed = Date.now() - this.batchOpenedAt;
    if (elapsed + config.batchWindowMs <= config.batchMaxWindowMs) this.armTimer(config.batchWindowMs);
  }

  sendNow() {
    if (this.state === "collecting") this.closeBatch();
  }

  async interrupt(userId: string) {
    if (this.state !== "generating" || !this.abort || !this.currentTurnId) return false;
    appendEvent(this.sessionId, { type: "turn.interrupted", actorKind: "user", actorUserId: userId, turnId: this.currentTurnId, payload: { turnId: this.currentTurnId, partialTextKept: true } });
    this.abort.abort();
    return true;
  }

  private armTimer(ms: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.closeBatch(), ms);
  }

  private closeBatch() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const batch = this.batch;
    this.batch = [];
    void this.run(batch);
  }

  private selectPayer(batch: LedgerEvent<"message.posted">[]): { payerUserId: string; credential: RawCredential; onBehalfOf: string } {
    const session = db.select().from(schema.sessions).where(eq(schema.sessions.id, this.sessionId)).get();
    if (!session) throw new Error("session missing");
    const firstHuman = batch.find((b) => b.actorKind === "user")?.actorUserId ?? null;
    const state = getState(this.sessionId);
    // Synthetic system directives (decision point resolutions) act for the user named in causedBy, else the creator.
    const onBehalfOf = firstHuman ?? state.eventsById[batch[0]?.causedBy[0] ?? ""]?.actorUserId ?? session.createdBy;
    if (session.payerMode === "sponsor") {
      // The pinned credential can disappear (revoked or re-connected under the same label); fall back to the creator's current one.
      const cred = (session.sponsorCredentialId ? loadRawCredential(session.sponsorCredentialId) : null) ?? findCredentialForUser(session.createdBy, session.provider);
      if (!cred) throw new Error("The session sponsor has no active credential for " + session.provider);
      return { payerUserId: cred.userId, credential: cred, onBehalfOf };
    }
    const speakerCred = findCredentialForUser(onBehalfOf, session.provider);
    if (speakerCred) return { payerUserId: onBehalfOf, credential: speakerCred, onBehalfOf };
    for (const p of Object.values(state.participants)) {
      const c = findCredentialForUser(p.userId, session.provider);
      if (c) return { payerUserId: p.userId, credential: c, onBehalfOf };
    }
    throw new Error(`No participant has a credential for ${session.provider}`);
  }

  private async run(batch: LedgerEvent<"message.posted">[]) {
    if (batch.length === 0) {
      this.state = "idle";
      this.publishState();
      return this.drain();
    }
    const turnId = ulid();
    this.currentTurnId = turnId;
    this.state = "screening";
    this.publishState();
    const session = db.select().from(schema.sessions).where(eq(schema.sessions.id, this.sessionId)).get()!;
    let payer: ReturnType<SessionBroker["selectPayer"]>;
    try {
      payer = this.selectPayer(batch);
    } catch (e) {
      appendEvent(this.sessionId, { type: "turn.failed", actorKind: "system", actorUserId: null, turnId, payload: { turnId, error: (e as Error).message } });
      this.state = "idle";
      this.publishState();
      return this.drain();
    }
    this.currentPayer = payer.payerUserId;
    const batchEventIds = batch.map((b) => b.id);
    appendEvent(this.sessionId, {
      type: "turn.started",
      actorKind: "ai",
      actorUserId: payer.onBehalfOf,
      turnId,
      causedBy: batchEventIds,
      payload: { payerUserId: payer.payerUserId, provider: payer.credential.provider, modelRequested: session.pinnedModel, batchEventIds, onBehalfOf: payer.onBehalfOf },
    });

    // Model pin: degrade to the closest available model on the payer's credential.
    let model = session.pinnedModel;
    const models = payer.credential.models;
    if (models.length && !models.includes(model)) {
      const fallback = pickClosest(model, models);
      appendEvent(this.sessionId, { type: "turn.model_degraded", actorKind: "system", actorUserId: null, turnId, payload: { requested: model, used: fallback, reason: `not available on ${payer.payerUserId}'s ${payer.credential.provider} credential` } });
      model = fallback;
    }

    const state = getState(this.sessionId);
    const notes: string[] = [];
    const blocked = Object.values(state.artifacts).filter((a) => a.blockedByDecisionPoint && !a.deleted);
    if (blocked.length) notes.push(`These artifacts are blocked by open decision points and must not be changed: ${blocked.map((a) => `${a.id} (${a.title})`).join(", ")}. If the batch resolves the decision point, apply the outcome.`);
    const mcpServers = serversForUser(payer.onBehalfOf);
    const context = assembleContext(state, batch as AnyLedgerEvent[], notes, mcpServers);
    const tools = buildToolBindings({
      sessionId: this.sessionId,
      turnId,
      onBehalfOf: payer.onBehalfOf,
      batchEventIds,
    });

    this.state = "generating";
    this.publishState();
    this.abort = new AbortController();
    const provider = getProvider(payer.credential.provider);
    let streamed = "";
    try {
      const result = await provider.runTurn({
        sessionId: this.sessionId,
        turnId,
        model,
        token: payer.credential.token,
        context,
        tools,
        mcpServers,
        external: {
          ask: (server, toolName, args, readOnly) => gateExternalCall({ sessionId: this.sessionId, turnId, onBehalfOf: payer.onBehalfOf, ownerUserId: server.ownerUserId, serverName: server.name, toolName, args, readOnly, causedBy: batchEventIds }),
          done: (callId, ok, summary) => recordExternalResult(this.sessionId, turnId, callId, ok, summary),
        },
        signal: this.abort.signal,
        timeoutMs: config.turnTimeoutMs,
        onDelta: (text) => {
          streamed += text;
          bus.publish(this.sessionId, { kind: "ephemeral", event: { kind: "ai.delta", sessionId: this.sessionId, turnId, text } });
        },
        onToolProgress: (tool, status, artifactId) => bus.publish(this.sessionId, { kind: "ephemeral", event: { kind: "ai.tool_progress", sessionId: this.sessionId, turnId, tool, status, artifactId } }),
      });
      this.state = "applying";
      this.publishState();
      const interrupted = this.abort.signal.aborted;
      appendEvent(this.sessionId, {
        type: "ai.message",
        actorKind: "ai",
        actorUserId: payer.onBehalfOf,
        turnId,
        causedBy: batchEventIds,
        payload: {
          text: result.text || streamed || (interrupted ? "(interrupted before any text)" : "(no text)"),
          addressedTo: [...new Set(batch.map((b) => b.actorUserId).filter((x): x is string => Boolean(x)))],
          toolCallsCount: result.toolCallsCount,
          partial: interrupted || undefined,
          onBehalfOf: payer.onBehalfOf,
          provider: payer.credential.provider,
          model: result.modelUsed,
          payerUserId: payer.payerUserId,
        },
      });
      this.state = "committed";
      createCommit(this.sessionId, null, turnId, `Turn for ${state.participants[payer.onBehalfOf]?.name ?? payer.onBehalfOf}`);
      appendEvent(this.sessionId, { type: "turn.completed", actorKind: "system", actorUserId: null, turnId, payload: { turnId, usage: result.usage, modelUsed: result.modelUsed } });
      // Fold anything that has left the transcript window into the brief; runs off the turn path.
      void maybeCompact(this.sessionId).then((r) => {
        if (r.status === "failed") console.warn(`[tandem] compaction failed for ${this.sessionId}: ${r.error}`);
      });
    } catch (e) {
      const interrupted = this.abort.signal.aborted;
      if (interrupted && streamed) {
        appendEvent(this.sessionId, {
          type: "ai.message",
          actorKind: "ai",
          actorUserId: payer.onBehalfOf,
          turnId,
          causedBy: batchEventIds,
          payload: { text: streamed, addressedTo: [], toolCallsCount: 0, partial: true, onBehalfOf: payer.onBehalfOf, provider: payer.credential.provider, model, payerUserId: payer.payerUserId },
        });
        createCommit(this.sessionId, null, turnId, "Interrupted turn");
      } else {
        appendEvent(this.sessionId, { type: "turn.failed", actorKind: "system", actorUserId: null, turnId, payload: { turnId, error: (e as Error).message } });
      }
    } finally {
      this.abort = null;
      this.currentTurnId = null;
      this.currentPayer = null;
      this.state = "idle";
      this.publishState();
      this.drain();
    }
  }

  private drain() {
    if (this.queued.length === 0) return;
    const next = this.queued;
    this.queued = [];
    this.state = "collecting";
    this.batchOpenedAt = Date.now();
    this.batch = next;
    this.armTimer(200);
    this.publishState();
  }
}

export function pickClosest(requested: string, available: string[]): string {
  const family = requested.match(/opus|sonnet|haiku|gpt-5|gpt-4|gemini|o[34]/i)?.[0]?.toLowerCase();
  if (family) {
    const same = available.find((m) => m.toLowerCase().includes(family));
    if (same) return same;
  }
  const order = ["opus", "sonnet", "gpt-5", "gemini", "haiku", "gpt-4"];
  for (const f of order) {
    const m = available.find((x) => x.toLowerCase().includes(f));
    if (m) return m;
  }
  return available[0]!;
}

const brokers = new Map<string, SessionBroker>();

export function brokerFor(sessionId: string): SessionBroker {
  let b = brokers.get(sessionId);
  if (!b) {
    b = new SessionBroker(sessionId);
    brokers.set(sessionId, b);
  }
  return b;
}
