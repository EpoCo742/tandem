import { describe, expect, it } from "vitest";
import type { AnyLedgerEvent, EventType, Payloads } from "./events.js";
import { emptyState, liveArtifacts, nextDecisionLabel, pendingProposals, reduce, reduceAll } from "./reducer.js";

let seq = 0;
function ev<T extends EventType>(type: T, payload: Payloads[T], extra: Partial<AnyLedgerEvent> = {}): AnyLedgerEvent {
  seq += 1;
  return {
    id: `e${seq}`,
    sessionId: "s1",
    seq,
    type,
    actorKind: "user",
    actorUserId: "alice",
    causedBy: [],
    turnId: null,
    createdAt: new Date(2026, 8, 3, 12, 0, seq).toISOString(),
    payload,
    ...extra,
  } as AnyLedgerEvent;
}

const applied = (artifactId: string, versionNo: number, author: string, proposalId: string | null = null, op: "create" | "update" | "delete" = versionNo === 1 ? "create" : "update") =>
  ev(
    "artifact.applied",
    {
      artifactId,
      artifactType: "mermaid",
      title: "Arch",
      versionId: `${artifactId}-v${versionNo}`,
      versionNo,
      op,
      proposalId,
      content: { source: `flowchart LR\n A${versionNo}`, kind: "flowchart", sections: [] },
      summary: null,
      authorKind: "user",
      authorUserId: author,
      provenance: [{ sectionId: "s", derivedFrom: ["e3"] }],
      contentHash: `h${versionNo}`,
    },
    { actorUserId: author },
  );

describe("ledger reducer", () => {
  it("builds session, participants, messages, artifacts and versions", () => {
    seq = 0;
    const events = [
      ev("session.created", { title: "T", policy: "hybrid", payerMode: "sponsor", pinnedModel: "m" }, { actorKind: "system" }),
      ev("participant.joined", { role: "owner", name: "Alice", color: "#a" }),
      ev("message.posted", { text: "hi", mode: "directive", attachments: [] }),
      applied("art1", 1, "alice"),
      applied("art1", 2, "bob"),
    ];
    const s = reduceAll("s1", events);
    expect(s.title).toBe("T");
    expect(s.participants.alice?.name).toBe("Alice");
    expect(s.messages).toHaveLength(1);
    const a = s.artifacts.art1!;
    expect(a.ownerUserId).toBe("alice");
    expect(a.current.versionNo).toBe(2);
    expect(a.current.authorUserId).toBe("bob");
    expect(a.versions).toHaveLength(2);
    expect(liveArtifacts(s)).toHaveLength(1);
    expect(s.lastSeq).toBe(5);
  });

  it("is idempotent on replayed events", () => {
    seq = 0;
    const e = ev("message.posted", { text: "x", mode: "directive", attachments: [] });
    const once = reduce(emptyState("s1"), e);
    const twice = reduce(once, e);
    expect(twice).toBe(once);
    expect(twice.messages).toHaveLength(1);
  });

  it("tracks proposals through approval to applied", () => {
    seq = 0;
    const s1 = reduceAll("s1", [
      applied("art1", 1, "alice"),
      ev("proposal.created", {
        proposalId: "p1",
        artifactId: "art1",
        artifactType: "mermaid",
        title: "Arch",
        op: "update",
        risk: "cross_owner_edit",
        requiresApprovalFrom: ["alice"],
        rationale: "r",
        baseVersionNo: 1,
        proposedContent: {},
        provenance: [],
        autoApplyAt: null,
      }, { actorUserId: "bob" }),
    ]);
    expect(pendingProposals(s1)).toHaveLength(1);
    const s2 = reduce(s1, ev("proposal.approved", { proposalId: "p1" }));
    expect(s2.proposals.p1?.approvals.alice).toBe("approve");
    const s3 = reduce(s2, applied("art1", 2, "bob", "p1"));
    expect(s3.proposals.p1?.status).toBe("applied");
    expect(pendingProposals(s3)).toHaveLength(0);
    const s4 = reduce(s1, ev("proposal.rejected", { proposalId: "p1" }));
    expect(s4.proposals.p1?.status).toBe("rejected");
  });

  it("supersedes decisions and numbers labels", () => {
    seq = 0;
    const s1 = reduceAll("s1", [
      ev("decision.recorded", { decisionId: "d1", label: "D-01", statement: "Kafka", status: "agreed", supersedes: null, agreedBy: ["alice"], evidence: [] }),
    ]);
    expect(nextDecisionLabel(s1)).toBe("D-02");
    const s2 = reduce(s1, ev("decision.recorded", { decisionId: "d2", label: "D-02", statement: "Outbox", status: "agreed", supersedes: "d1", agreedBy: ["alice", "bob"], evidence: [] }));
    expect(s2.decisions.d1?.status).toBe("superseded");
    expect(s2.decisions.d1?.supersededBy).toBe("d2");
    expect(s2.decisions.d2?.supersedes).toBe("d1");
  });

  it("blocks and unblocks artifacts around a decision point", () => {
    seq = 0;
    const art = applied("art1", 1, "alice"); // seq order matters: the reducer drops replayed (older) seqs
    const dp = ev("artifact.applied", {
      artifactId: "dp1",
      artifactType: "decision_point",
      title: "DP",
      versionId: "dp1-v1",
      versionNo: 1,
      op: "create",
      proposalId: null,
      content: { question: "q", context: "c", options: [{ id: "a", title: "A", tradeoffs: "", canvasImpact: "" }, { id: "b", title: "B", tradeoffs: "", canvasImpact: "" }], votes: {}, blocksArtifactIds: ["art1"] },
      summary: null,
      authorKind: "ai",
      authorUserId: "alice",
      provenance: [],
      contentHash: "",
    });
    const s1 = reduceAll("s1", [
      art,
      dp,
      ev("conflict.flagged", { conflictId: "c1", directiveEventIds: [], contradicts: {}, summary: "", decisionPointArtifactId: "dp1" }),
    ]);
    expect(s1.artifacts.art1?.blockedByDecisionPoint).toBe("dp1");
    const s2 = reduce(s1, ev("decision.voted", { decisionPointArtifactId: "dp1", optionId: "b" }, { actorUserId: "bob" }));
    expect((s2.artifacts.dp1?.current.content as { votes: Record<string, string> }).votes.bob).toBe("b");
    const s3 = reduce(s2, ev("decision.resolved", { decisionPointArtifactId: "dp1", optionId: "b", decisionId: null }));
    expect(s3.artifacts.art1?.blockedByDecisionPoint).toBeNull();
    expect(s3.conflicts.c1?.resolved).toBe(true);
    expect((s3.artifacts.dp1?.current.content as { resolvedOptionId: string }).resolvedOptionId).toBe("b");
  });

  it("records commits and head", () => {
    seq = 0;
    const s = reduceAll("s1", [
      applied("art1", 1, "alice"),
      ev("commit.created", { commitId: "c1", parentCommitId: null, message: "m", artifactVersions: { art1: "art1-v1" }, artifactVersionNos: { art1: 1 } }, { actorKind: "system" }),
    ]);
    expect(s.headCommitId).toBe("c1");
    expect(s.commits[0]?.artifactVersions.art1).toBe("art1-v1");
  });
});
