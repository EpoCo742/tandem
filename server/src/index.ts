import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyWebsocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import fastifyMultipart from "@fastify/multipart";
import { registerUploadRoutes } from "./uploads.js";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { runMigrations } from "./db/index.js";
import { registerAuthRoutes } from "./auth.js";
import { registerCredentialRoutes } from "./routes/credentials.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerMcpRoutes } from "./routes/mcp.js";
import { registerLedgerSocket } from "./ws.js";
import { registerCollabSocket, hocuspocus } from "./collab.js";

async function main() {
  runMigrations();
  const app = Fastify({ logger: { level: config.isProd ? "info" : "info" } });
  await app.register(fastifyCookie, { secret: config.sessionSecret });
  await app.register(fastifyWebsocket, { options: { maxPayload: 4 * 1024 * 1024 } });
  await app.register(fastifyMultipart);

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    reply.code(status).send({ error: err.message });
  });

  await registerAuthRoutes(app);
  await registerCredentialRoutes(app);
  await registerSessionRoutes(app);
  await registerMcpRoutes(app);
  await registerUploadRoutes(app);
  await registerLedgerSocket(app);
  await registerCollabSocket(app);

  app.get("/api/health", async () => ({ ok: true, provider: config.defaultProvider, devAuth: config.devAuth }));

  // Serve the built SPA when present (demo / container mode).
  if (fs.existsSync(path.join(config.webDist, "index.html"))) {
    // wildcard serving resolves files at request time, so a rebuilt web/dist is picked up without a restart
    await app.register(fastifyStatic, { root: config.webDist, prefix: "/", cacheControl: true, maxAge: 0 });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api") || req.url.startsWith("/auth")) return reply.code(404).send({ error: "not found" });
      return reply.sendFile("index.html");
    });
  } else {
    app.log.info(`No web build at ${config.webDist}; run the Vite dev server for the UI.`);
  }

  const shutdown = async () => {
    app.log.info("shutting down");
    hocuspocus.flushPendingStores();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await app.listen({ port: config.port, host: "0.0.0.0" });
  app.log.info(`Tandem POC on ${config.appUrl} (provider ${config.defaultProvider}, dev auth ${config.devAuth ? "on" : "off"})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
