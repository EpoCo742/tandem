import { ulid } from "ulid";
import { nextDecisionLabel, type MarkdownContent } from "@tandem/shared";
import { appendEvent, getState } from "./ledger.js";
import { createCommit } from "./governance.js";
import { livePublications, publishDocument } from "./publish.js";

// Review and sign-off for the design document. The document has a status (draft, in review,
// approved) derived by the reducer from these events; sign-offs are named, and approval is
// recorded as a decision agreed by the signers. Any change to the canvas after approval moves
// the document back to draft (the reducer does that, with a note of what changed).

type Outcome<T> = ({ ok: true } & T) | { ok: false; status: number; error: string };

export function requestReview(sessionId: string, artifactId: string, userId: string, reviewers: string[], note?: string): Outcome<{ reviewers: string[] }> {
  const state = getState(sessionId);
  const doc = state.artifacts[artifactId];
  if (!doc || doc.type !== "design_doc" || doc.deleted) return { ok: false, status: 404, error: "no such design document" };
  const review = state.reviews[artifactId];
  if (review?.status === "in_review") return { ok: false, status: 400, error: "already in review" };
  const named = [...new Set(reviewers)].filter((u) => state.participants[u] && state.participants[u]!.role !== "viewer");
  if (named.length === 0) return { ok: false, status: 400, error: "name at least one reviewer who can sign" };
  appendEvent(sessionId, { type: "review.requested", actorKind: "user", actorUserId: userId, causedBy: [doc.current.eventId], payload: { artifactId, reviewers: named, versionNo: doc.current.versionNo, ...(note ? { note } : {}) } });
  return { ok: true, reviewers: named };
}

export function signOff(sessionId: string, artifactId: string, userId: string): Outcome<{ approved: boolean; signed: number; needed: number; decisionLabel?: string }> {
  const state = getState(sessionId);
  const doc = state.artifacts[artifactId];
  if (!doc || doc.type !== "design_doc" || doc.deleted) return { ok: false, status: 404, error: "no such design document" };
  const review = state.reviews[artifactId];
  if (!review || review.status !== "in_review") return { ok: false, status: 400, error: "the document is not in review" };
  if (!review.reviewers.includes(userId)) return { ok: false, status: 403, error: "you are not one of the named reviewers" };
  if (review.signoffs[userId]) return { ok: false, status: 400, error: "already signed" };
  const signEv = appendEvent(sessionId, { type: "review.signed", actorKind: "user", actorUserId: userId, causedBy: [doc.current.eventId], payload: { artifactId, versionNo: doc.current.versionNo, commitId: state.headCommitId } });
  const after = getState(sessionId).reviews[artifactId]!;
  const signed = Object.keys(after.signoffs).length;
  const needed = after.reviewers.length;
  if (signed < needed) return { ok: true, approved: false, signed, needed };

  // Everyone named has signed: the approval is a decision agreed by the signers.
  const signers = after.reviewers;
  const names = (u: string) => state.participants[u]?.name ?? u;
  const when = (u: string) => new Date(after.signoffs[u]!.at).toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC";
  const label = nextDecisionLabel(getState(sessionId));
  const decisionId = ulid();
  const evidence = [...Object.values(after.signoffs).map((s) => s.eventId), signEv.id].filter((v, i, arr) => arr.indexOf(v) === i);
  const title = (doc.current.content as MarkdownContent).markdown.match(/^# (.+)$/m)?.[1] ?? doc.title;
  appendEvent(sessionId, {
    type: "decision.recorded",
    actorKind: "user",
    actorUserId: userId,
    causedBy: evidence,
    payload: {
      decisionId,
      label,
      statement: `Design document "${title}" v${doc.current.versionNo} is approved`,
      status: "agreed",
      supersedes: null,
      agreedBy: signers,
      evidence,
      about: [],
      context: `Review requested by ${names(after.requestedBy)}. Signed off by ${signers.map((u) => `${names(u)} (${when(u)})`).join(", ")}.`,
      options: [{ title: "Approve as written", chosen: true }, { title: "Send back for changes", tradeoffs: "Any reviewer could have withheld a signature and raised the issue in a thread." }],
      consequences: `v${doc.current.versionNo} is the agreed design. Any change to the canvas after this moves the document back to draft, with a note of what changed, and it has to be signed off again.`,
    },
  });
  appendEvent(sessionId, { type: "review.approved", actorKind: "system", actorUserId: null, causedBy: evidence, payload: { artifactId, versionNo: doc.current.versionNo, decisionId, decisionLabel: label, signers } });
  createCommit(sessionId, userId, null, `Design document v${doc.current.versionNo} approved (${label})`);
  // A document that is already out there gets its approved version published as a matter of course.
  if (livePublications(sessionId).some((p) => p.artifactId === artifactId)) publishDocument(sessionId, artifactId, null, `Published on approval (${label})`);
  return { ok: true, approved: true, signed, needed, decisionLabel: label };
}

export function withdrawReview(sessionId: string, artifactId: string, userId: string, reason: string): Outcome<{ withdrawn: true }> {
  const state = getState(sessionId);
  const doc = state.artifacts[artifactId];
  if (!doc || doc.type !== "design_doc" || doc.deleted) return { ok: false, status: 404, error: "no such design document" };
  const review = state.reviews[artifactId];
  if (!review || review.status === "draft") return { ok: false, status: 400, error: "nothing to withdraw" };
  appendEvent(sessionId, { type: "review.withdrawn", actorKind: "user", actorUserId: userId, causedBy: [doc.current.eventId], payload: { artifactId, reason: reason || "withdrawn" } });
  return { ok: true, withdrawn: true };
}
