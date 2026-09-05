import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import { deleteMcpServer, listMcpServers, normalizeConfig, parsePastedConfig, registerMcpServer, removeAllowRule, testMcpServer } from "../mcp.js";

export async function registerMcpRoutes(app: FastifyInstance) {
  app.get("/api/v1/mcp-servers", async (req, reply) => {
    const user = requireUser(req, reply);
    return { servers: listMcpServers(user.id) };
  });

  // Register and test in one go; the config never comes back out.
  app.post<{ Body: { name: string; config: unknown } }>("/api/v1/mcp-servers", async (req, reply) => {
    const user = requireUser(req, reply);
    try {
      const cfg = normalizeConfig(req.body?.config);
      const created = registerMcpServer(user.id, String(req.body?.name ?? ""), cfg);
      return await testMcpServer(user.id, created.id);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  // Paste an editor's mcp.json (or one server from it); every server in it is registered and tested.
  app.post<{ Body: { json: string; name?: string } }>("/api/v1/mcp-servers/import", async (req, reply) => {
    const user = requireUser(req, reply);
    let parsed: ReturnType<typeof parsePastedConfig>;
    try {
      parsed = parsePastedConfig(String(req.body?.json ?? ""), req.body?.name?.trim() || "server");
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
    const results = [];
    for (const { name, config } of parsed) {
      try {
        const created = registerMcpServer(user.id, name, config);
        results.push(await testMcpServer(user.id, created.id));
      } catch (e) {
        results.push({ name, status: "error", lastError: (e as Error).message, tools: [] });
      }
    }
    return { results };
  });

  app.post<{ Params: { id: string } }>("/api/v1/mcp-servers/:id/test", async (req, reply) => {
    const user = requireUser(req, reply);
    try {
      return await testMcpServer(user.id, req.params.id);
    } catch (e) {
      return reply.code(404).send({ error: (e as Error).message });
    }
  });

  app.delete<{ Params: { id: string; index: string } }>("/api/v1/mcp-servers/:id/allow/:index", async (req, reply) => {
    const user = requireUser(req, reply);
    try {
      removeAllowRule(user.id, req.params.id, Number(req.params.index));
      return { ok: true };
    } catch (e) {
      return reply.code(404).send({ error: (e as Error).message });
    }
  });

  app.delete<{ Params: { id: string } }>("/api/v1/mcp-servers/:id", async (req, reply) => {
    const user = requireUser(req, reply);
    deleteMcpServer(user.id, req.params.id);
    return { ok: true };
  });
}
