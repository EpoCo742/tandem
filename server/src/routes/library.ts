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

  // A preview image for link unfurls: title, session, status. Plain SVG, no fonts to fetch.
  app.get<{ Params: { slug: string } }>("/p/:slug/preview.svg", async (req, reply) => {
    const doc = publishedDocument(req.params.slug);
    if (!doc || doc.revoked) return reply.code(404).type("text/plain").send("no such published document");
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
    const a = doc.version.approval;
    const wrap = (s: string, n: number) => { const words = s.split(" "); const lines: string[] = []; let cur = ""; for (const w of words) { if ((cur + " " + w).trim().length > n) { lines.push(cur.trim()); cur = w; } else cur = cur + " " + w; } if (cur.trim()) lines.push(cur.trim()); return lines.slice(0, 3); };
    const title = wrap(doc.title, 34);
    const status = a ? `Approved · ${a.decisionLabel} · signed off by ${a.signerNames.join(", ")}` : "Not signed off";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#171F26"/><rect x="0" y="0" width="14" height="630" fill="${a ? "#2e9e5b" : "#7C8893"}"/><text x="80" y="120" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="28" fill="#AEB9C3">${esc(doc.sessionTitle)}</text>${title.map((t, i) => `<text x="80" y="${210 + i * 64}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="56" font-weight="700" fill="#E6EBEF">${esc(t)}</text>`).join("")}<text x="80" y="470" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="26" fill="${a ? "#2e9e5b" : "#AEB9C3"}">${esc(status)}</text><text x="80" y="520" font-family="Consolas, monospace" font-size="22" fill="#7C8893">version ${doc.version.no} · ${esc(new Date(doc.version.publishedAt).toISOString().slice(0, 10))} · published from Session Zero</text><g transform="translate(1020 470) scale(1.6)"><circle cx="36" cy="36" r="16" fill="none" stroke="#AEB9C3" stroke-width="5.5"/><circle cx="36" cy="9" r="5.5" fill="#3FB4C3"/><circle cx="36" cy="63" r="5.5" fill="#3FB4C3"/><circle cx="9" cy="36" r="5.5" fill="#3FB4C3"/><circle cx="63" cy="36" r="5.5" fill="#E9A63A"/></g></svg>`;
    return reply.type("image/svg+xml").header("cache-control", "public, max-age=300").send(svg);
  });

  // Raw Markdown for tools and people who prefer it: /p/<slug>.md, optionally ?v=2.
  app.get<{ Params: { slug: string }; Querystring: { v?: string } }>("/p/:slug.md", async (req, reply) => {
    const doc = publishedDocument(req.params.slug, Number(req.query.v) || undefined);
    if (!doc || doc.revoked) return reply.code(doc ? 410 : 404).type("text/plain").send(doc ? "This document is no longer published." : "No such published document.");
    const a = doc.version.approval;
    const head = [
      `<!-- published from Session Zero: ${doc.sessionTitle}; version ${doc.version.no} (document v${doc.version.docVersionNo}), ${doc.version.publishedAt}, by ${doc.version.publishedBy}; ${a ? `approved (${a.decisionLabel}), signed off by ${a.signerNames.join(", ")}` : "not signed off"} -->`,
      "",
    ];
    return reply.type("text/markdown; charset=utf-8").send(head.join("\n") + doc.version.markdown);
  });
}
