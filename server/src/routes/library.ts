import type { FastifyInstance } from "fastify";
import type { LibraryKind } from "@tandem/shared";
import { requireUser } from "../auth.js";
import { searchLibrary } from "../library.js";
import { publishedDocument } from "../publish.js";

// The library (signed in) and the published pages (no sign-in; the slug is the secret).

export async function registerLibraryRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { q?: string; kind?: string; limit?: string; exclude?: string } }>("/api/v1/library", async (req, reply) => {
    const user = requireUser(req, reply);
    const kind = req.query.kind as LibraryKind | undefined;
    return searchLibrary(user.id, req.query.q ?? "", { kind: kind || undefined, limit: Number(req.query.limit) || undefined, excludeSessionId: req.query.exclude || undefined });
  });

  app.get<{ Params: { slug: string }; Querystring: { v?: string } }>("/api/v1/public/:slug", async (req, reply) => {
    const doc = publishedDocument(req.params.slug, Number(req.query.v) || undefined);
    if (!doc) return reply.code(404).send({ error: "no such published document" });
    if (doc.revoked) return reply.code(410).send({ error: "this document is no longer published", title: doc.title, revokedAt: doc.revokedAt });
    return doc;
  });

  // Raw Markdown for tools and people who prefer it: /p/<slug>.md, optionally ?v=2.
  app.get<{ Params: { slug: string }; Querystring: { v?: string } }>("/p/:slug.md", async (req, reply) => {
    const doc = publishedDocument(req.params.slug, Number(req.query.v) || undefined);
    if (!doc || doc.revoked) return reply.code(doc ? 410 : 404).type("text/plain").send(doc ? "This document is no longer published." : "No such published document.");
    const a = doc.version.approval;
    const head = [
      `<!-- published from Tandem: ${doc.sessionTitle}; version ${doc.version.no} (document v${doc.version.docVersionNo}), ${doc.version.publishedAt}, by ${doc.version.publishedBy}; ${a ? `approved (${a.decisionLabel}), signed off by ${a.signerNames.join(", ")}` : "not signed off"} -->`,
      "",
    ];
    return reply.type("text/markdown; charset=utf-8").send(head.join("\n") + doc.version.markdown);
  });
}
