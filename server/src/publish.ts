import { randomBytes } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { ulid } from "ulid";
import { participantName, type MarkdownContent } from "@tandem/shared";
import { db, now, schema } from "./db/index.js";
import { appendEvent, getState } from "./ledger.js";
import { config } from "./config.js";

// Publishing a design document gives it a stable public URL and a frozen copy per version.
// The frozen copy is the point: the session keeps changing, the published page does not, and
// each version says who signed it (or that nobody has). Publish and revoke are ledger events
// too, so the card and the lane show them and the library index picks the session up.

type Outcome<T> = ({ ok: true } & T) | { ok: false; status: number; error: string };

export const publicUrl = (slug: string) => `${config.appUrl.replace(/\/$/, "")}/p/${slug}`;

const newSlug = () => randomBytes(8).toString("base64url").replace(/[-_]/g, "x").slice(0, 10).toLowerCase();

export function publishDocument(sessionId: string, artifactId: string, userId: string | null, note?: string): Outcome<{ slug: string; url: string; publicationVersionNo: number; docVersionNo: number; approved: { decisionLabel: string; signers: string[] } | null }> {
  const state = getState(sessionId);
  const doc = state.artifacts[artifactId];
  if (!doc || doc.type !== "design_doc" || doc.deleted) return { ok: false, status: 404, error: "no such design document" };
  const markdown = (doc.current.content as MarkdownContent).markdown ?? "";
  if (!markdown.trim()) return { ok: false, status: 400, error: "the document is empty" };
  const review = state.reviews[artifactId];
  const approved = review?.status === "approved" && review.approvedVersionNo === doc.current.versionNo && review.decisionId && state.decisions[review.decisionId]
    ? { decisionLabel: state.decisions[review.decisionId]!.label, signers: review.reviewers }
    : null;
  const ts = now();
  let pub = db.select().from(schema.publications).where(and(eq(schema.publications.sessionId, sessionId), eq(schema.publications.artifactId, artifactId))).get();
  const title = markdown.match(/^# (.+)$/m)?.[1]?.trim() || doc.title;
  if (!pub) {
    pub = { id: ulid(), sessionId, artifactId, slug: newSlug(), title, ownerUserId: userId ?? state.participants[Object.keys(state.participants)[0]!]?.userId ?? "", revokedAt: null, createdAt: ts, updatedAt: ts };
    db.insert(schema.publications).values(pub).run();
  } else {
    const last = db.select().from(schema.publicationVersions).where(eq(schema.publicationVersions.publicationId, pub.id)).orderBy(asc(schema.publicationVersions.no)).all().pop();
    const lastApproval = last?.approval ? (JSON.parse(last.approval) as { decisionLabel: string }).decisionLabel : null;
    if (last && !pub.revokedAt && last.docVersionNo === doc.current.versionNo && last.markdown === markdown && lastApproval === (approved?.decisionLabel ?? null)) {
      return { ok: false, status: 400, error: `v${doc.current.versionNo} is already published as version ${last.no}` };
    }
    db.update(schema.publications).set({ title, revokedAt: null, updatedAt: ts }).where(eq(schema.publications.id, pub.id)).run();
  }
  const versions = db.select({ no: schema.publicationVersions.no }).from(schema.publicationVersions).where(eq(schema.publicationVersions.publicationId, pub.id)).all();
  const no = versions.reduce((m, v) => Math.max(m, v.no), 0) + 1;
  const signerNames = approved ? approved.signers.map((u) => participantName(state, u)) : [];
  db.insert(schema.publicationVersions)
    .values({ id: ulid(), publicationId: pub.id, no, docVersionNo: doc.current.versionNo, commitId: state.headCommitId, title, markdown, publishedBy: userId, publishedByName: userId ? participantName(state, userId) : "system", publishedAt: ts, note: note ?? null, approval: approved ? JSON.stringify({ ...approved, signerNames }) : null })
    .run();
  appendEvent(sessionId, {
    type: "doc.published",
    actorKind: userId ? "user" : "system",
    actorUserId: userId,
    causedBy: [doc.current.eventId],
    payload: { publicationId: pub.id, artifactId, slug: pub.slug, docVersionNo: doc.current.versionNo, publicationVersionNo: no, approved, ...(note ? { note } : {}) },
  });
  return { ok: true, slug: pub.slug, url: publicUrl(pub.slug), publicationVersionNo: no, docVersionNo: doc.current.versionNo, approved };
}

export function revokePublication(sessionId: string, artifactId: string, userId: string): Outcome<{ revoked: true }> {
  const pub = db.select().from(schema.publications).where(and(eq(schema.publications.sessionId, sessionId), eq(schema.publications.artifactId, artifactId))).get();
  if (!pub || pub.revokedAt) return { ok: false, status: 404, error: "not published" };
  db.update(schema.publications).set({ revokedAt: now(), updatedAt: now() }).where(eq(schema.publications.id, pub.id)).run();
  appendEvent(sessionId, { type: "doc.unpublished", actorKind: "user", actorUserId: userId, payload: { publicationId: pub.id, artifactId, slug: pub.slug } });
  return { ok: true, revoked: true };
}

/** Everything a public page needs; null when the slug is unknown or revoked (the caller decides between 404 and 410). */
export function publishedDocument(slug: string, versionNo?: number) {
  const pub = db.select().from(schema.publications).where(eq(schema.publications.slug, slug)).get();
  if (!pub) return null;
  const session = db.select({ title: schema.sessions.title }).from(schema.sessions).where(eq(schema.sessions.id, pub.sessionId)).get();
  const versions = db.select().from(schema.publicationVersions).where(eq(schema.publicationVersions.publicationId, pub.id)).orderBy(asc(schema.publicationVersions.no)).all();
  const chosen = versionNo ? versions.find((v) => v.no === versionNo) : versions[versions.length - 1];
  if (!chosen) return null;
  const parse = (s: string | null) => (s ? (JSON.parse(s) as { decisionLabel: string; signers: string[]; signerNames: string[] }) : null);
  return {
    slug,
    title: pub.title,
    sessionTitle: session?.title ?? "",
    revoked: Boolean(pub.revokedAt),
    revokedAt: pub.revokedAt,
    versions: versions.map((v) => ({ no: v.no, docVersionNo: v.docVersionNo, publishedAt: v.publishedAt, publishedBy: v.publishedByName, note: v.note, approval: parse(v.approval) })),
    version: { no: chosen.no, docVersionNo: chosen.docVersionNo, publishedAt: chosen.publishedAt, publishedBy: chosen.publishedByName, note: chosen.note, approval: parse(chosen.approval), markdown: chosen.markdown },
  };
}

/** Live publications of a session, for the library index (a session with one is public). */
export function livePublications(sessionId: string) {
  return db.select().from(schema.publications).where(eq(schema.publications.sessionId, sessionId)).all().filter((p) => !p.revokedAt);
}

export function latestPublishedMarkdown(publicationId: string): { title: string; markdown: string; publishedAt: string; approval: string | null } | null {
  const v = db.select().from(schema.publicationVersions).where(eq(schema.publicationVersions.publicationId, publicationId)).orderBy(asc(schema.publicationVersions.no)).all().pop();
  return v ? { title: v.title, markdown: v.markdown, publishedAt: v.publishedAt, approval: v.approval } : null;
}
