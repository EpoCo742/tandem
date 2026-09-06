import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import { addRule, listRules, NOTIFY_EVENTS, removeRule, sendThrough, setRuleEnabled, type NotifyEvent } from "../notify.js";

// A person's notification rules: where to be told, through which of their tools, about what.

export async function registerNotificationRoutes(app: FastifyInstance) {
  app.get("/api/v1/notifications", async (req, reply) => {
    const user = requireUser(req, reply);
    return { rules: listRules(user.id), events: NOTIFY_EVENTS };
  });

  app.post<{ Body: { mcpServerId: string; toolName: string; target?: Record<string, string>; events: NotifyEvent[] } }>("/api/v1/notifications", async (req, reply) => {
    const user = requireUser(req, reply);
    const b = req.body ?? ({} as { mcpServerId: string; toolName: string; target?: Record<string, string>; events: NotifyEvent[] });
    if (!b.mcpServerId || !b.toolName || !Array.isArray(b.events)) return reply.code(400).send({ error: "mcpServerId, toolName and events are needed" });
    const target = b.target && typeof b.target === "object" ? Object.fromEntries(Object.entries(b.target).filter(([, v]) => typeof v === "string").map(([k, v]) => [k, String(v)])) : {};
    try {
      return addRule(user.id, { mcpServerId: b.mcpServerId, toolName: b.toolName, target, events: b.events });
    } catch (e) {
      return reply.code((e as { statusCode?: number }).statusCode ?? 400).send({ error: (e as Error).message });
    }
  });

  app.post<{ Params: { id: string }; Body: { enabled: boolean } }>("/api/v1/notifications/:id/enable", async (req, reply) => {
    const user = requireUser(req, reply);
    setRuleEnabled(user.id, req.params.id, Boolean(req.body?.enabled));
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/api/v1/notifications/:id/test", async (req, reply) => {
    const user = requireUser(req, reply);
    const rule = listRules(user.id).find((r) => r.id === req.params.id);
    if (!rule) return reply.code(404).send({ error: "no such rule" });
    return sendThrough(rule, `Session Zero test: notifications through ${rule.serverName} / ${rule.toolName} work. You will hear about: ${rule.events.join(", ")}.`);
  });

  app.delete<{ Params: { id: string } }>("/api/v1/notifications/:id", async (req, reply) => {
    const user = requireUser(req, reply);
    removeRule(user.id, req.params.id);
    return { ok: true };
  });
}
