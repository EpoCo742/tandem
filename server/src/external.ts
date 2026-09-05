import { ulid } from "ulid";
import { appendEvent, getState } from "./ledger.js";
import { config } from "./config.js";

// Governance for outbound actions: anything an MCP tool does in another system.
// Reads run at once. Writes are proposed to the person who owns the tool and wait for
// their approval; a timeout denies rather than approves, because an external write
// cannot be reverted by a forward commit the way a canvas change can.

interface Pending {
  resolve: (decision: "approved" | "denied") => void;
  timer: NodeJS.Timeout;
}
const pending = new Map<string, Pending>();

export interface ExternalCallRequest {
  sessionId: string;
  turnId: string | null;
  onBehalfOf: string;
  ownerUserId: string;
  serverName: string;
  toolName: string;
  args: unknown;
  readOnly: boolean;
  causedBy: string[];
}

export function describeCall(serverName: string, toolName: string, args: unknown): string {
  const a = (args ?? {}) as Record<string, unknown>;
  const bits = Object.entries(a)
    .filter(([, v]) => typeof v === "string" || typeof v === "number")
    .slice(0, 4)
    .map(([k, v]) => `${k}=${String(v).slice(0, 60)}`);
  return `${serverName}.${toolName}${bits.length ? ` (${bits.join(", ")})` : ""}`;
}

/** Ask permission for an outbound call. Resolves when a person decides, or the timeout denies it. */
export function gateExternalCall(req: ExternalCallRequest): Promise<{ callId: string; decision: "approved" | "denied" }> {
  const callId = ulid();
  const summary = describeCall(req.serverName, req.toolName, req.args);
  appendEvent(req.sessionId, {
    type: "external.call_proposed",
    actorKind: "ai",
    actorUserId: req.onBehalfOf,
    turnId: req.turnId,
    causedBy: req.causedBy,
    payload: { callId, ownerUserId: req.ownerUserId, serverName: req.serverName, toolName: req.toolName, args: req.args ?? null, readOnly: req.readOnly, summary, onBehalfOf: req.onBehalfOf },
  });
  if (req.readOnly) {
    appendEvent(req.sessionId, { type: "external.call_resolved", actorKind: "system", actorUserId: null, turnId: req.turnId, payload: { callId, decision: "approved", reason: "read-only tool" } });
    return Promise.resolve({ callId, decision: "approved" });
  }
  return new Promise((resolve) => {
    const ms = Math.max(30, config.approvalTimeoutS) * 1000;
    const timer = setTimeout(() => {
      pending.delete(callId);
      appendEvent(req.sessionId, { type: "external.call_resolved", actorKind: "system", actorUserId: null, turnId: req.turnId, payload: { callId, decision: "denied", reason: `no decision within ${ms / 1000}s` } });
      resolve({ callId, decision: "denied" });
    }, ms);
    pending.set(callId, { resolve: (decision) => { clearTimeout(timer); pending.delete(callId); resolve({ callId, decision }); }, timer });
  });
}

/** A person decides. Only the tool's owner (or the session owner) may. */
export function resolveExternalCall(sessionId: string, callId: string, userId: string, decision: "approved" | "denied", reason?: string) {
  const state = getState(sessionId);
  const call = state.externalCalls[callId];
  if (!call) throw new Error("no such call");
  if (call.status !== "pending") throw new Error(`call is already ${call.status}`);
  const me = state.participants[userId];
  if (call.ownerUserId !== userId && me?.role !== "owner") throw new Error("only the tool's owner can decide");
  appendEvent(sessionId, { type: "external.call_resolved", actorKind: "user", actorUserId: userId, payload: { callId, decision, reason } });
  pending.get(callId)?.resolve(decision);
  return { callId, decision };
}

export function recordExternalResult(sessionId: string, turnId: string | null, callId: string, ok: boolean, summary: string) {
  appendEvent(sessionId, { type: "external.call_completed", actorKind: "system", actorUserId: null, turnId, payload: { callId, ok, summary: summary.slice(0, 2000) } });
}
