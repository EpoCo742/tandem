import { ulid } from "ulid";
import { nextDecisionLabel, type AlternativesContent, type ArchModelContent, type DecisionPointContent } from "@tandem/shared";
import { appendEvent, getState } from "./ledger.js";
import { createCommit, requestChange } from "./governance.js";

// Alternatives are candidate architectures on one card. Choosing between them is a vote, and
// the outcome is applied here, deterministically, without spending an AI turn: the chosen
// candidate's model becomes the session's architecture model, the losers stay on the card
// marked as not chosen, and the decision is recorded with every candidate as an option.

export function openAlternativesDecision(sessionId: string, artifactId: string, userId: string): { decisionPointArtifactId: string } | { error: string } {
  const state = getState(sessionId);
  const alt = state.artifacts[artifactId];
  if (!alt || alt.type !== "alternatives" || alt.deleted) return { error: "no such alternatives card" };
  const content = alt.current.content as AlternativesContent;
  if (content.chosen) return { error: "an alternative was already chosen" };
  const open = Object.values(state.artifacts).find((a) => a.type === "decision_point" && !a.deleted && (a.current.content as DecisionPointContent).alternativesArtifactId === artifactId && !(a.current.content as DecisionPointContent).resolvedOptionId && !(a.current.content as DecisionPointContent).expired);
  if (open) return { decisionPointArtifactId: open.id };
  if (content.candidates.length < 2) return { error: "a decision needs at least two candidates" };
  const structural = Object.values(state.artifacts).filter((a) => !a.deleted && (a.type === "arch_model" || a.type === "view")).map((a) => a.id);
  const dpId = ulid();
  const dp: DecisionPointContent = {
    question: content.question,
    context: `Choose one of the candidate architectures on "${alt.title}". The chosen candidate becomes the architecture model; the others stay on the card, marked as not chosen.`,
    options: content.candidates.map((c) => ({
      id: c.id,
      title: c.title,
      tradeoffs: [c.summary, c.pros.length ? `For: ${c.pros.join("; ")}` : "", c.cons.length ? `Against: ${c.cons.join("; ")}` : ""].filter(Boolean).join(" "),
      canvasImpact: "The architecture model is set from this candidate; every view follows.",
    })),
    votes: {},
    blocksArtifactIds: [...structural, artifactId],
    alternativesArtifactId: artifactId,
  };
  appendEvent(sessionId, {
    type: "artifact.applied",
    actorKind: "user",
    actorUserId: userId,
    causedBy: [alt.current.eventId],
    payload: {
      artifactId: dpId,
      artifactType: "decision_point",
      title: `Decision point: ${content.question}`,
      versionId: ulid(),
      versionNo: 1,
      op: "create",
      proposalId: null,
      content: dp,
      summary: content.question,
      authorKind: "user",
      authorUserId: userId,
      provenance: [{ sectionId: "question", derivedFrom: [alt.current.eventId] }],
      contentHash: "",
    },
  });
  createCommit(sessionId, userId, null, `Opened the decision on ${alt.title}`);
  return { decisionPointArtifactId: dpId };
}

export function adoptAlternative(sessionId: string, artifactId: string, candidateId: string, voters: string[], causedBy: string[]): { ok: true; label: string; modelVersionNo: number } | { ok: false; error: string } {
  const state = getState(sessionId);
  const alt = state.artifacts[artifactId];
  if (!alt || alt.type !== "alternatives") return { ok: false, error: "no such alternatives card" };
  const content = alt.current.content as AlternativesContent;
  const chosen = content.candidates.find((c) => c.id === candidateId);
  if (!chosen) return { ok: false, error: `no candidate ${candidateId}` };
  const actor = voters[0] ?? alt.ownerUserId;
  const derivedFrom = [...new Set([...causedBy, alt.current.eventId])];

  // The model: replace structure with the candidate's, keeping provenance of what carried over.
  const modelArt = Object.values(state.artifacts).find((a) => a.type === "arch_model" && !a.deleted);
  const previous = modelArt?.current.content as ArchModelContent | undefined;
  const carry = (id: string) => previous?.components.find((c) => c.id === id)?.derivedFrom ?? [];
  const model: ArchModelContent = {
    components: chosen.model.components.map((c) => ({ ...c, derivedFrom: [...new Set([...carry(c.id), ...c.derivedFrom, ...derivedFrom])] })),
    relationships: chosen.model.relationships.map((r) => ({ ...r, derivedFrom: [...new Set([...r.derivedFrom, ...derivedFrom])] })),
    boundaries: chosen.model.boundaries,
    sections: [{ id: "model", derivedFrom }],
  };
  const applied = requestChange({
    sessionId,
    turnId: null,
    actorKind: "user",
    actorUserId: actor,
    op: modelArt ? "update" : "create",
    artifactId: modelArt?.id ?? null,
    artifactType: "arch_model",
    title: modelArt?.title ?? "Architecture model",
    content: model,
    summary: `Architecture model set from alternative "${chosen.title}"`,
    rationale: `Chosen by vote: ${chosen.title}`,
    baseVersionNo: null,
    causedBy: derivedFrom,
    provenance: [{ sectionId: "model", derivedFrom }],
    force: true,
  });
  if (applied.status !== "applied") return { ok: false, error: `could not set the model: ${applied.status}` };
  if (!modelArt) {
    requestChange({ sessionId, turnId: null, actorKind: "user", actorUserId: actor, op: "create", artifactId: null, artifactType: "view", title: "System architecture", content: { kind: "container", sections: [{ id: "overview", derivedFrom }] }, summary: "Container view generated from the architecture model", rationale: "First view of the adopted model", baseVersionNo: null, causedBy: derivedFrom, force: true });
  }

  // The card: mark the winner; the others stay, folded, as what was considered.
  requestChange({
    sessionId,
    turnId: null,
    actorKind: "user",
    actorUserId: actor,
    op: "update",
    artifactId: alt.id,
    artifactType: "alternatives",
    title: alt.title,
    content: { ...content, chosen: candidateId },
    summary: `Chosen: ${chosen.title}`,
    rationale: `Chosen by vote: ${chosen.title}`,
    baseVersionNo: null,
    causedBy: derivedFrom,
    provenance: alt.current.provenance,
    force: true,
  });

  // The decision, with every candidate as an option considered.
  const label = nextDecisionLabel(getState(sessionId));
  const decisionId = ulid();
  appendEvent(sessionId, {
    type: "decision.recorded",
    actorKind: "user",
    actorUserId: actor,
    causedBy: derivedFrom,
    payload: {
      decisionId,
      label,
      statement: `Adopt "${chosen.title}": ${chosen.summary}`,
      status: "agreed",
      supersedes: null,
      agreedBy: voters,
      evidence: derivedFrom,
      about: chosen.model.components.map((c) => c.id),
      context: content.question,
      options: content.candidates.map((c) => ({ title: c.title, tradeoffs: [c.pros.length ? `For: ${c.pros.join("; ")}` : "", c.cons.length ? `Against: ${c.cons.join("; ")}` : ""].filter(Boolean).join(" "), chosen: c.id === candidateId })),
      consequences: `The architecture model was set from this candidate (v${applied.versionNo}); every view follows. ${chosen.constraintsAtRisk.length ? `Constraints at risk: ${chosen.constraintsAtRisk.join(", ")}.` : "No constraints at risk."}`,
    },
  });
  appendEvent(sessionId, {
    type: "alternative.adopted",
    actorKind: "user",
    actorUserId: actor,
    causedBy: derivedFrom,
    payload: { alternativesArtifactId: alt.id, candidateId, title: chosen.title, decisionLabel: label, byUserIds: voters, modelVersionNo: applied.versionNo },
  });
  createCommit(sessionId, actor, null, `Adopted alternative: ${chosen.title}`);
  return { ok: true, label, modelVersionNo: applied.versionNo };
}
