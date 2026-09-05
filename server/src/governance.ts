import { createHash } from "node:crypto";
import { ulid } from "ulid";
import type { ArtifactType, Policy, ProposalOp, Provenance, Risk } from "@tandem/shared";
import { provenanceOf, type SessionState } from "@tandem/shared";
import { appendEvent, getState } from "./ledger.js";
import { config } from "./config.js";

// Risk classification, the policy gate, proposals, application, commits, revert.

export type Gate = "auto" | "proposal" | "proposal_all" | "decision_point";

const table: Record<Policy, Record<Risk, Gate>> = {
  lww: { additive: "auto", cross_owner_edit: "auto", contradicts_decision: "auto", destructive: "auto" },
  hybrid: { additive: "auto", cross_owner_edit: "proposal", contradicts_decision: "decision_point", destructive: "proposal" },
  review: { additive: "proposal", cross_owner_edit: "proposal", contradicts_decision: "decision_point", destructive: "proposal" },
  consensus: { additive: "proposal_all", cross_owner_edit: "proposal_all", contradicts_decision: "decision_point", destructive: "proposal_all" },
};

export function gate(policy: Policy, risk: Risk): Gate {
  return table[policy][risk];
}

export function classifyRisk(state: SessionState, op: ProposalOp, artifactId: string | null, actorUserId: string): Risk {
  if (op === "create" || !artifactId) return "additive";
  const a = state.artifacts[artifactId];
  if (!a) return "additive";
  if (op === "delete") {
    // Removing a card that only you (or the AI acting for you) ever wrote is tidying your own
    // work; removing anything someone else has contributed to is destructive and needs consent.
    const soleAuthor = a.ownerUserId === actorUserId && a.versions.every((v) => v.authorUserId === actorUserId);
    return soleAuthor ? "additive" : "destructive";
  }
  const lastAuthor = a.current.authorUserId;
  if (lastAuthor === actorUserId || a.ownerUserId === actorUserId) return "additive";
  return "cross_owner_edit";
}

function approversFor(state: SessionState, g: Gate, artifactId: string | null, actorUserId: string): string[] {
  const editors = Object.values(state.participants).filter((p) => p.role !== "viewer" && p.userId !== actorUserId).map((p) => p.userId);
  if (g === "proposal_all") return editors;
  const a = artifactId ? state.artifacts[artifactId] : undefined;
  const candidates = new Set<string>();
  if (a) {
    if (a.current.authorUserId !== actorUserId) candidates.add(a.current.authorUserId);
    if (a.ownerUserId !== actorUserId) candidates.add(a.ownerUserId);
  }
  const list = [...candidates].filter((u) => state.participants[u]);
  return list.length ? list : editors.slice(0, 1);
}

export function contentHash(content: unknown): string {
  return createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 16);
}

export interface ChangeRequest {
  sessionId: string;
  turnId: string | null;
  actorKind: "user" | "ai";
  actorUserId: string; // the human responsible (for AI: on-behalf-of)
  op: ProposalOp;
  artifactId: string | null;
  artifactType: ArtifactType;
  title: string;
  content: unknown;
  summary: string | null;
  rationale: string;
  baseVersionNo: number | null;
  causedBy: string[];
  provenance?: Provenance[];
}

export type ChangeOutcome =
  | { status: "applied"; artifactId: string; versionNo: number; title: string }
  | { status: "pending_approval"; proposalId: string; artifactId: string; approvers: string[] }
  | { status: "stale"; artifactId: string; currentVersionNo: number; message: string }
  | { status: "blocked_by_decision_point"; artifactId: string; decisionPointArtifactId: string };

export function requestChange(req: ChangeRequest): ChangeOutcome {
  const state = getState(req.sessionId);
  const artifactId = req.artifactId ?? ulid();
  const existing = req.artifactId ? state.artifacts[req.artifactId] : undefined;
  if (req.artifactId && !existing) throw new Error(`artifact ${req.artifactId} not found`);
  if (existing?.blockedByDecisionPoint && req.op !== "restore") {
    return { status: "blocked_by_decision_point", artifactId, decisionPointArtifactId: existing.blockedByDecisionPoint };
  }
  if (existing && req.baseVersionNo !== null && req.baseVersionNo !== existing.current.versionNo && req.op === "update") {
    return { status: "stale", artifactId, currentVersionNo: existing.current.versionNo, message: `Artifact moved to v${existing.current.versionNo}; re-read and retry` };
  }
  const risk = classifyRisk(state, req.op, req.artifactId, req.actorUserId);
  const g = gate(state.policy, risk);
  const provenance = req.provenance ?? provenanceOf(req.artifactType, req.content);

  if (g === "auto" || (g !== "decision_point" && approversFor(state, g, req.artifactId, req.actorUserId).length === 0)) {
    return applyVersion({ ...req, artifactId, proposalId: null, provenance });
  }

  const approvers = approversFor(state, g, req.artifactId, req.actorUserId);
  const proposalId = ulid();
  const autoApplyAt = state.policy === "hybrid" && config.approvalTimeoutS > 0 ? new Date(Date.now() + config.approvalTimeoutS * 1000).toISOString() : null;
  appendEvent(req.sessionId, {
    type: "proposal.created",
    actorKind: req.actorKind,
    actorUserId: req.actorUserId,
    turnId: req.turnId,
    causedBy: req.causedBy,
    payload: {
      proposalId,
      artifactId,
      artifactType: req.artifactType,
      title: req.title,
      op: req.op,
      risk,
      requiresApprovalFrom: approvers,
      rationale: req.rationale,
      baseVersionNo: req.baseVersionNo,
      proposedContent: req.content,
      provenance,
      autoApplyAt,
    },
  });
  if (autoApplyAt) scheduleAutoApply(req.sessionId, proposalId, config.approvalTimeoutS * 1000);
  return { status: "pending_approval", proposalId, artifactId, approvers };
}

function applyVersion(req: ChangeRequest & { artifactId: string; proposalId: string | null; provenance: Provenance[] }): ChangeOutcome {
  const state = getState(req.sessionId);
  const existing = state.artifacts[req.artifactId];
  const versionNo = existing ? existing.current.versionNo + 1 : 1;
  const hash = contentHash(req.content);
  if (existing && existing.current.content && contentHash(existing.current.content) === hash && req.op === "update") {
    return { status: "applied", artifactId: req.artifactId, versionNo: existing.current.versionNo, title: existing.title };
  }
  const versionId = ulid();
  appendEvent(req.sessionId, {
    type: "artifact.applied",
    actorKind: req.actorKind,
    actorUserId: req.actorUserId,
    turnId: req.turnId,
    causedBy: req.causedBy,
    payload: {
      artifactId: req.artifactId,
      artifactType: req.artifactType,
      title: req.title,
      versionId,
      versionNo,
      op: req.op,
      proposalId: req.proposalId,
      content: req.content,
      summary: req.summary,
      authorKind: req.actorKind,
      authorUserId: req.actorUserId,
      provenance: req.provenance,
      contentHash: hash,
    },
  });
  return { status: "applied", artifactId: req.artifactId, versionNo, title: req.title };
}

const autoApplyTimers = new Map<string, NodeJS.Timeout>();

export function scheduleAutoApply(sessionId: string, proposalId: string, delayMs: number) {
  const key = `${sessionId}:${proposalId}`;
  if (autoApplyTimers.has(key)) return;
  const t = setTimeout(() => {
    autoApplyTimers.delete(key);
    const state = getState(sessionId);
    const p = state.proposals[proposalId];
    if (p && p.status === "pending") {
      const ownerOrEditor = p.requiresApprovalFrom[0] ?? p.proposerUserId ?? "system";
      resolveProposal(sessionId, proposalId, ownerOrEditor, "approve", "auto-applied after timeout", true);
    }
  }, delayMs);
  autoApplyTimers.set(key, t);
}

export function resolveProposal(sessionId: string, proposalId: string, userId: string, decision: "approve" | "reject", comment?: string, system = false): ChangeOutcome | { status: "rejected" } | { status: "waiting"; remaining: string[] } {
  const state = getState(sessionId);
  const p = state.proposals[proposalId];
  if (!p || p.status !== "pending") throw new Error("proposal is not pending");
  if (!system && !p.requiresApprovalFrom.includes(userId) && state.participants[userId]?.role !== "owner") throw new Error("not an approver for this proposal");
  appendEvent(sessionId, {
    type: decision === "approve" ? "proposal.approved" : "proposal.rejected",
    actorKind: system ? "system" : "user",
    actorUserId: system ? null : userId,
    causedBy: [p.proposedByEventId],
    turnId: p.turnId,
    payload: { proposalId, comment },
  });
  if (decision === "reject") return { status: "rejected" };
  const after = getState(sessionId).proposals[proposalId]!;
  const approved = new Set(Object.entries(after.approvals).filter(([, v]) => v === "approve").map(([u]) => u));
  const need = state.policy === "consensus" ? p.requiresApprovalFrom : p.requiresApprovalFrom.slice(0, 1);
  const remaining = need.filter((u) => !approved.has(u));
  if (!system && remaining.length > 0 && !(state.participants[userId]?.role === "owner")) return { status: "waiting", remaining };
  const outcome = applyVersion({
    sessionId,
    turnId: p.turnId,
    actorKind: p.proposerUserId && state.participants[p.proposerUserId] && p.turnId === null ? "user" : "ai",
    actorUserId: p.proposerUserId ?? userId,
    op: p.op,
    artifactId: p.artifactId,
    artifactType: p.artifactType,
    title: p.title,
    content: p.proposedContent,
    summary: null,
    rationale: p.rationale,
    baseVersionNo: p.baseVersionNo,
    causedBy: [p.proposedByEventId],
    proposalId,
    provenance: p.provenance,
  });
  createCommit(sessionId, userId, p.turnId, `Approved ${p.op} of ${p.title}`);
  return outcome;
}

export function createCommit(sessionId: string, actorUserId: string | null, turnId: string | null, message: string) {
  const state = getState(sessionId);
  const artifactVersions: Record<string, string> = {};
  const artifactVersionNos: Record<string, number> = {};
  for (const a of Object.values(state.artifacts)) {
    if (a.deleted) continue;
    artifactVersions[a.id] = a.current.versionId;
    artifactVersionNos[a.id] = a.current.versionNo;
  }
  const head = state.commits[state.commits.length - 1];
  if (head && JSON.stringify(head.artifactVersions) === JSON.stringify(artifactVersions)) return head.id;
  const commitId = ulid();
  appendEvent(sessionId, {
    type: "commit.created",
    actorKind: actorUserId ? "user" : "system",
    actorUserId,
    turnId,
    payload: { commitId, parentCommitId: head?.id ?? null, message, artifactVersions, artifactVersionNos },
  });
  return commitId;
}

export function revertTo(sessionId: string, commitId: string, userId: string): { restored: string[]; newCommitId: string } {
  const state = getState(sessionId);
  const target = state.commits.find((c) => c.id === commitId);
  if (!target) throw new Error("commit not found");
  const restored: string[] = [];
  for (const a of Object.values(state.artifacts)) {
    const targetVersionId = target.artifactVersions[a.id];
    if (!targetVersionId) {
      if (!a.deleted) {
        applyVersion({ sessionId, turnId: null, actorKind: "user", actorUserId: userId, op: "delete", artifactId: a.id, artifactType: a.type, title: a.title, content: a.current.content, summary: a.current.summary, rationale: `Revert to ${commitId}`, baseVersionNo: null, causedBy: [target.id], proposalId: null, provenance: a.current.provenance });
        restored.push(a.id);
      }
      continue;
    }
    if (a.current.versionId === targetVersionId && !a.deleted) continue;
    const v = a.versions.find((x) => x.versionId === targetVersionId);
    if (!v) continue;
    applyVersion({ sessionId, turnId: null, actorKind: "user", actorUserId: userId, op: "restore", artifactId: a.id, artifactType: a.type, title: a.title, content: v.content, summary: v.summary, rationale: `Revert to ${commitId}`, baseVersionNo: null, causedBy: [target.id], proposalId: null, provenance: v.provenance });
    restored.push(a.id);
  }
  const newCommitId = createCommit(sessionId, userId, null, `Revert to ${commitId.slice(-6)}`);
  appendEvent(sessionId, { type: "commit.reverted_to", actorKind: "user", actorUserId: userId, payload: { targetCommitId: commitId, newCommitId } });
  return { restored, newCommitId };
}
