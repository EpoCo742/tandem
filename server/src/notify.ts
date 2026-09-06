import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import { participantName, type AnyLedgerEvent, type DecisionPointContent, type Payloads } from "@tandem/shared";
import { db, now, schema } from "./db/index.js";
import { bus } from "./bus.js";
import { getState } from "./ledger.js";
import { callMcpTool, loadMcpServer } from "./mcp.js";
import { config } from "./config.js";

// Notifications through a person's own tools. A rule says: when one of these things happens to
// me, call this write tool on this MCP server of mine with this target (a channel, a user).
// Setting the rule is the approval, so the call is not gated again; every send is logged on the
// rule. Nothing is written to the session ledger: a notification is a side effect for one person.

export type NotifyEvent = "decision_point" | "proposal" | "signoff" | "approved" | "mention" | "violation";
export const NOTIFY_EVENTS: { id: NotifyEvent; label: string }[] = [
  { id: "decision_point", label: "a decision point is raised" },
  { id: "proposal", label: "a proposal waits on me" },
  { id: "signoff", label: "my sign-off is requested" },
  { id: "approved", label: "a design document is approved" },
  { id: "mention", label: "someone mentions me" },
  { id: "violation", label: "a data flow breaks a constraint" },
];

export interface NotificationRule {
  id: string;
  userId: string;
  mcpServerId: string;
  serverName: string;
  toolName: string;
  target: Record<string, string>;
  events: NotifyEvent[];
  enabled: boolean;
  createdAt: string;
  lastSentAt: string | null;
  lastError: string | null;
}

function rowToRule(r: typeof schema.notificationRules.$inferSelect): NotificationRule {
  const server = db.select({ name: schema.mcpServers.name }).from(schema.mcpServers).where(eq(schema.mcpServers.id, r.mcpServerId)).get();
  return { id: r.id, userId: r.userId, mcpServerId: r.mcpServerId, serverName: server?.name ?? "(removed)", toolName: r.toolName, target: JSON.parse(r.target) as Record<string, string>, events: JSON.parse(r.events) as NotifyEvent[], enabled: Boolean(r.enabled), createdAt: r.createdAt, lastSentAt: r.lastSentAt, lastError: r.lastError };
}

export function listRules(userId: string): NotificationRule[] {
  return db.select().from(schema.notificationRules).where(eq(schema.notificationRules.userId, userId)).all().map(rowToRule);
}

export function addRule(userId: string, input: { mcpServerId: string; toolName: string; target: Record<string, string>; events: NotifyEvent[] }): NotificationRule {
  const server = loadMcpServer(userId, input.mcpServerId);
  if (!server) throw Object.assign(new Error("no such MCP server of yours"), { statusCode: 404 });
  const tool = server.tools.find((t) => t.name === input.toolName);
  if (!tool) throw Object.assign(new Error(`the server has no tool ${input.toolName}; test it first`), { statusCode: 400 });
  if (tool.readOnly) throw Object.assign(new Error("pick a tool that sends something; that one is read-only"), { statusCode: 400 });
  const events = input.events.filter((e) => NOTIFY_EVENTS.some((x) => x.id === e));
  if (events.length === 0) throw Object.assign(new Error("choose at least one event"), { statusCode: 400 });
  const id = ulid();
  db.insert(schema.notificationRules).values({ id, userId, mcpServerId: input.mcpServerId, toolName: input.toolName, target: JSON.stringify(input.target ?? {}), events: JSON.stringify(events), enabled: 1, createdAt: now(), lastSentAt: null, lastError: null }).run();
  return listRules(userId).find((r) => r.id === id)!;
}

export function removeRule(userId: string, id: string) {
  db.delete(schema.notificationRules).where(and(eq(schema.notificationRules.id, id), eq(schema.notificationRules.userId, userId))).run();
}

export function setRuleEnabled(userId: string, id: string, enabled: boolean) {
  db.update(schema.notificationRules).set({ enabled: enabled ? 1 : 0 }).where(and(eq(schema.notificationRules.id, id), eq(schema.notificationRules.userId, userId))).run();
}

/** Send one message through a rule. Used by the trigger below and by the "test" button. */
export async function sendThrough(rule: NotificationRule, text: string): Promise<{ ok: boolean; text: string }> {
  const server = loadMcpServer(rule.userId, rule.mcpServerId);
  if (!server) {
    db.update(schema.notificationRules).set({ lastError: "MCP server removed" }).where(eq(schema.notificationRules.id, rule.id)).run();
    return { ok: false, text: "MCP server removed" };
  }
  try {
    const r = await callMcpTool(server.config, rule.toolName, { ...rule.target, text, message: text });
    db.update(schema.notificationRules).set({ lastSentAt: now(), lastError: r.ok ? null : r.text.slice(0, 300) }).where(eq(schema.notificationRules.id, rule.id)).run();
    return r;
  } catch (e) {
    db.update(schema.notificationRules).set({ lastError: (e as Error).message.slice(0, 300) }).where(eq(schema.notificationRules.id, rule.id)).run();
    return { ok: false, text: (e as Error).message };
  }
}

const link = (sessionId: string, path = "") => `${config.appUrl.replace(/\/$/, "")}/s/${sessionId}${path}`;

/** Who should hear about an event, and what to tell them. The actor never hears about their own action. */
function messagesFor(ev: AnyLedgerEvent): { userId: string; kind: NotifyEvent; text: string }[] {
  const state = getState(ev.sessionId);
  const title = state.title || "a session";
  const who = ev.actorUserId ? participantName(state, ev.actorUserId) : "The AI";
  const everyone = Object.keys(state.participants);
  const out: { userId: string; kind: NotifyEvent; text: string }[] = [];
  const push = (users: string[], kind: NotifyEvent, text: string) => {
    for (const u of new Set(users)) if (u !== ev.actorUserId && state.participants[u]) out.push({ userId: u, kind, text });
  };
  switch (ev.type) {
    case "artifact.applied": {
      const p = ev.payload as Payloads["artifact.applied"];
      if (p.artifactType === "decision_point" && p.op === "create") {
        const c = p.content as DecisionPointContent;
        push(everyone.filter((u) => state.participants[u]!.role !== "viewer"), "decision_point", `[${title}] Decision point: ${c.question} — vote at ${link(ev.sessionId, `/vote/${p.artifactId}`)}`);
      }
      break;
    }
    case "proposal.created": {
      const p = ev.payload as Payloads["proposal.created"];
      push(p.requiresApprovalFrom, "proposal", `[${title}] ${who} proposes to ${p.op} "${p.title}" and it waits on you: ${link(ev.sessionId)}`);
      break;
    }
    case "review.requested": {
      const p = ev.payload as Payloads["review.requested"];
      push(p.reviewers, "signoff", `[${title}] ${who} asks you to sign off "${state.artifacts[p.artifactId]?.title ?? "the design document"}" v${p.versionNo}: ${link(ev.sessionId)}`);
      break;
    }
    case "review.approved": {
      const p = ev.payload as Payloads["review.approved"];
      push(everyone, "approved", `[${title}] "${state.artifacts[p.artifactId]?.title ?? "The design document"}" v${p.versionNo} is approved (${p.decisionLabel}), signed off by ${p.signers.map((u) => participantName(state, u)).join(", ")}: ${link(ev.sessionId)}`);
      break;
    }
    case "message.posted": {
      const p = ev.payload as Payloads["message.posted"];
      if (p.mentions?.length) push(p.mentions, "mention", `[${title}] ${who}: ${p.text.slice(0, 200)} — ${link(ev.sessionId)}`);
      break;
    }
    case "flow.violation": {
      const p = ev.payload as Payloads["flow.violation"];
      push(everyone.filter((u) => state.participants[u]!.role !== "viewer"), "violation", `[${title}] A data flow breaks ${[...new Set(p.violations.map((v) => v.constraintId))].join(", ")}: ${p.violations.map((v) => v.reason).join("; ")} — ${link(ev.sessionId)}`);
      break;
    }
    default:
      break;
  }
  return out;
}

const inFlight = new Set<string>();

/** Start listening to every session's ledger. Idempotent. */
export function startNotifier() {
  bus.subscribeAll((msg) => {
    if (msg.kind !== "event") return;
    const targets = messagesFor(msg.event);
    if (targets.length === 0) return;
    for (const t of targets) {
      for (const rule of listRules(t.userId)) {
        if (!rule.enabled || !rule.events.includes(t.kind)) continue;
        const key = `${rule.id}:${msg.event.id}`;
        if (inFlight.has(key)) continue;
        inFlight.add(key);
        void sendThrough(rule, t.text).finally(() => inFlight.delete(key));
      }
    }
  });
}
