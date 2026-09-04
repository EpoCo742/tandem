import { and, asc, eq, gt, sql } from "drizzle-orm";
import { ulid } from "ulid";
import type { ActorKind, AnyLedgerEvent, EventType, LedgerEvent, Payloads } from "@tandem/shared";
import { reduce, reduceAll, type SessionState } from "@tandem/shared";
import { db, now, schema, sqlite } from "./db/index.js";
import { bus } from "./bus.js";

// The ledger is the source of truth. appendEvent is the only writer; the
// per-session read model is kept warm in memory and rebuilt from the table on demand.

const stateCache = new Map<string, SessionState>();

export interface AppendInput<T extends EventType> {
  type: T;
  actorKind: ActorKind;
  actorUserId: string | null;
  causedBy?: string[];
  turnId?: string | null;
  payload: Payloads[T];
}

// Prepared lazily: migrations run after import.
let stmts: { insert: ReturnType<typeof sqlite.prepare>; nextSeq: ReturnType<typeof sqlite.prepare> } | null = null;
function prepared() {
  if (!stmts) {
    stmts = {
      insert: sqlite.prepare(
        `insert into events (session_id, seq, id, type, actor_kind, actor_user_id, caused_by, turn_id, payload, created_at)
         values (@sessionId, @seq, @id, @type, @actorKind, @actorUserId, @causedBy, @turnId, @payload, @createdAt)`,
      ),
      nextSeq: sqlite.prepare(`select coalesce(max(seq), 0) + 1 as seq from events where session_id = ?`),
    };
  }
  return stmts;
}

const appendTx = sqlite.transaction((sessionId: string, row: Omit<AnyLedgerEvent, "seq">): AnyLedgerEvent => {
  const { seq } = prepared().nextSeq.get(sessionId) as { seq: number };
  prepared().insert.run({
    sessionId,
    seq,
    id: row.id,
    type: row.type,
    actorKind: row.actorKind,
    actorUserId: row.actorUserId,
    causedBy: JSON.stringify(row.causedBy),
    turnId: row.turnId,
    payload: JSON.stringify(row.payload),
    createdAt: row.createdAt,
  });
  return { ...row, seq } as AnyLedgerEvent;
});

export function appendEvent<T extends EventType>(sessionId: string, input: AppendInput<T>): LedgerEvent<T> {
  const row = {
    id: ulid(),
    sessionId,
    type: input.type,
    actorKind: input.actorKind,
    actorUserId: input.actorUserId,
    causedBy: input.causedBy ?? [],
    turnId: input.turnId ?? null,
    payload: input.payload,
    createdAt: now(),
  };
  const ev = appendTx(sessionId, row as Omit<AnyLedgerEvent, "seq">);
  const cached = stateCache.get(sessionId);
  if (cached) stateCache.set(sessionId, reduce(cached, ev));
  bus.publish(sessionId, { kind: "event", event: ev });
  return ev as LedgerEvent<T>;
}

function rowToEvent(r: typeof schema.events.$inferSelect): AnyLedgerEvent {
  return {
    id: r.id,
    sessionId: r.sessionId,
    seq: r.seq,
    type: r.type,
    actorKind: r.actorKind,
    actorUserId: r.actorUserId,
    causedBy: JSON.parse(r.causedBy),
    turnId: r.turnId,
    payload: JSON.parse(r.payload),
    createdAt: r.createdAt,
  } as AnyLedgerEvent;
}

export function listEvents(sessionId: string, fromSeq = 0): AnyLedgerEvent[] {
  const rows = db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.sessionId, sessionId), gt(schema.events.seq, fromSeq)))
    .orderBy(asc(schema.events.seq))
    .all();
  return rows.map(rowToEvent);
}

export function getEvent(sessionId: string, id: string): AnyLedgerEvent | undefined {
  const row = db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.sessionId, sessionId), eq(schema.events.id, id)))
    .get();
  return row ? rowToEvent(row) : undefined;
}

export function getState(sessionId: string): SessionState {
  let s = stateCache.get(sessionId);
  if (!s) {
    s = reduceAll(sessionId, listEvents(sessionId));
    stateCache.set(sessionId, s);
  }
  return s;
}

export function invalidateState(sessionId: string) {
  stateCache.delete(sessionId);
}

export function sessionExists(sessionId: string): boolean {
  const r = sqlite.prepare(`select 1 from sessions where id = ?`).get(sessionId);
  return Boolean(r);
}

export { sql };
