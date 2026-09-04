import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import { deleteCredential, listCredentials, storeCredential } from "../credentials.js";
import { providerIds } from "../providers/index.js";
import { config } from "../config.js";

export async function registerCredentialRoutes(app: FastifyInstance) {
  app.get("/api/v1/credentials", async (req, reply) => {
    const user = requireUser(req, reply);
    return { credentials: listCredentials(user.id), providers: providerIds(), defaultProvider: config.defaultProvider, defaultModel: config.defaultModel };
  });

  app.post<{ Body: { provider: string; token: string; label?: string } }>("/api/v1/credentials", async (req, reply) => {
    const user = requireUser(req, reply);
    const provider = req.body.provider;
    const token = provider === "fake" ? "fake" : String(req.body.token ?? "").trim();
    if (!token) return reply.code(400).send({ error: "token required" });
    try {
      const view = await storeCredential(user.id, provider, token, req.body.label ?? (provider === "copilot" ? "GitHub token" : provider));
      return view;
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.delete<{ Params: { id: string } }>("/api/v1/credentials/:id", async (req, reply) => {
    const user = requireUser(req, reply);
    deleteCredential(user.id, req.params.id);
    return { ok: true };
  });
}
