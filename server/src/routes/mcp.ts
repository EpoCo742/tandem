import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import { deleteMcpServer, listMcpServers, normalizeConfig, registerMcpServer, testMcpServer } from "../mcp.js";

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

  app.post<{ Params: { id: string } }>("/api/v1/mcp-servers/:id/test", async (req, reply) => {
    const user = requireUser(req, reply);
    try {
      return await testMcpServer(user.id, req.params.id);
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
