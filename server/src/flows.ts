import { ulid } from "ulid";
import { liveArtifacts, violationsOf, type ConstraintsContent, type DecisionPointContent, type Violation } from "@tandem/shared";
import { appendEvent, getState } from "./ledger.js";

// After any change to the model or the constraints card, compare the flow violations before and
// after. New ones are recorded in the ledger (the lane shows them) and, under the hybrid policy,
// raise a decision point naming the constraint, the way the AI would have, but with no turn.

const key = (v: Violation) => `${v.constraintId}|${v.relationshipId}`;

export function enforceFlows(sessionId: string, before: Violation[], actorUserId: string, changedArtifactId: string) {
  const state = getState(sessionId);
  const seen = new Set(before.map(key));
  const fresh = violationsOf(state).filter((v) => !seen.has(key(v)));
  if (fresh.length === 0) return;
  const live = liveArtifacts(state);
  const model = live.find((a) => a.type === "arch_model");
  const constraints = live.find((a) => a.type === "constraints")?.current.content as ConstraintsContent | undefined;
  const constraintIds = [...new Set(fresh.map((v) => v.constraintId))];
  // One open decision point per constraint is enough; do not pile on while people are voting.
  const alreadyOpen = live.some((a) => {
    if (a.type !== "decision_point") return false;
    const c = a.current.content as DecisionPointContent;
    return !c.resolvedOptionId && !c.expired && (c.violatesConstraintIds ?? []).some((id) => constraintIds.includes(id));
  });
  let decisionPointArtifactId: string | undefined;
  if (state.policy === "hybrid" && !alreadyOpen && model) {
    decisionPointArtifactId = ulid();
    const named = constraintIds.map((id) => {
      const k = constraints?.constraints.find((x) => x.id === id);
      return k ? `${id} (${k.statement}${k.setBy && state.participants[k.setBy] ? `, set by ${state.participants[k.setBy]!.name}` : ""})` : id;
    });
    const content: DecisionPointContent = {
      question: `The model now breaks ${constraintIds.join(", ")}: keep the constraint, make an exception, or amend it?`,
      context: `${fresh.map((v) => v.reason).join(". ")}. Constraint${constraintIds.length === 1 ? "" : "s"}: ${named.join("; ")}. Raised by the data-flow check, not by the AI.`,
      options: [
        { id: "keep", title: "Keep the constraint", tradeoffs: "Undo or re-route the flow so the data stays where the constraint says.", canvasImpact: "The offending relationship is removed or re-routed on the model." },
        { id: "exception", title: "Make an exception", tradeoffs: "Record an exception constraint for exactly this flow; whoever set the original approves it.", canvasImpact: "A new constraint with exceptionTo is added to the Constraints card; the model stays." },
        { id: "amend", title: "Amend the constraint", tradeoffs: "Change the constraint itself; whoever set it approves.", canvasImpact: "The constraint's statement changes on the Constraints card; the model stays." },
      ],
      votes: {},
      blocksArtifactIds: [model.id],
      violatesConstraintIds: constraintIds,
    };
    appendEvent(sessionId, {
      type: "artifact.applied",
      actorKind: "system",
      actorUserId: actorUserId,
      causedBy: [state.artifacts[changedArtifactId]?.current.eventId ?? model.current.eventId],
      payload: {
        artifactId: decisionPointArtifactId,
        artifactType: "decision_point",
        title: `Decision point: ${constraintIds.join(", ")} broken by a data flow`,
        versionId: ulid(),
        versionNo: 1,
        op: "create",
        proposalId: null,
        content,
        summary: content.question,
        authorKind: "user",
        authorUserId: actorUserId,
        provenance: [{ sectionId: "body", derivedFrom: [] }],
        contentHash: "",
      },
    });
  }
  appendEvent(sessionId, {
    type: "flow.violation",
    actorKind: "system",
    actorUserId: actorUserId,
    causedBy: [state.artifacts[changedArtifactId]?.current.eventId ?? ""].filter(Boolean),
    payload: { artifactId: changedArtifactId, violations: fresh, ...(decisionPointArtifactId ? { decisionPointArtifactId } : {}) },
  });
}
