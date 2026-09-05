import type {
  AnyLedgerEvent,
  ArtifactType,
  DecisionStatus,
  Payloads,
  PayerMode,
  Policy,
  ProposalOp,
  ProposalStatus,
  Provenance,
  Risk,
  TurnStatus,
  Usage,
} from "./events.js";

// Pure read model over the ledger. Runs identically on the server and in the browser.

export interface Participant {
  userId: string;
  name: string;
  color: string;
  role: "owner" | "editor" | "viewer";
  avatarUrl?: string;
  consented: boolean;
  present: boolean;
}

export interface ChatMessage {
  eventId: string;
  seq: number;
  kind: "user" | "ai" | "clarification" | "system";
  mode?: "directive" | "note" | "promoted";
  intent?: "compile";
  userId: string | null;
  onBehalfOf?: string;
  payerUserId?: string;
  provider?: string;
  model?: string;
  text: string;
  turnId: string | null;
  partial?: boolean;
  createdAt: string;
  attachments?: string[];
}

export interface ArtifactVersion {
  versionId: string;
  versionNo: number;
  content: unknown;
  summary: string | null;
  authorKind: "user" | "ai";
  authorUserId: string;
  eventId: string;
  proposalId: string | null;
  provenance: Provenance[];
  createdAt: string;
  op: ProposalOp;
}

export interface Artifact {
  id: string;
  type: ArtifactType;
  title: string;
  ownerUserId: string;
  versions: ArtifactVersion[];
  current: ArtifactVersion;
  pinned: boolean;
  deleted: boolean;
  blockedByDecisionPoint: string | null;
  createdAt: string;
}

export interface Proposal {
  id: string;
  artifactId: string;
  artifactType: ArtifactType;
  title: string;
  op: ProposalOp;
  risk: Risk;
  requiresApprovalFrom: string[];
  approvals: Record<string, "approve" | "reject">;
  rationale: string;
  baseVersionNo: number | null;
  proposedContent: unknown;
  provenance: Provenance[];
  status: ProposalStatus;
  autoApplyAt: string | null;
  proposedByEventId: string;
  proposerUserId: string | null;
  turnId: string | null;
  createdAt: string;
}

export interface Decision {
  id: string;
  label: string;
  statement: string;
  status: DecisionStatus;
  supersedes: string | null;
  supersededBy: string | null;
  agreedBy: string[];
  evidence: string[];
  eventId: string;
  createdAt: string;
}

export interface Commit {
  id: string;
  parentId: string | null;
  message: string;
  actorUserId: string | null;
  turnId: string | null;
  artifactVersions: Record<string, string>;
  artifactVersionNos: Record<string, number>;
  createdAt: string;
  seq: number;
}

export interface Turn {
  id: string;
  status: TurnStatus;
  payerUserId: string;
  onBehalfOf: string;
  provider: string;
  modelRequested: string;
  modelUsed?: string;
  batchEventIds: string[];
  usage?: Usage;
  error?: string;
  startedAt: string;
}

export interface Conflict {
  id: string;
  directiveEventIds: string[];
  contradicts: { decisionId?: string; artifactId?: string };
  summary: string;
  decisionPointArtifactId: string | null;
  resolved: boolean;
}

export interface SessionState {
  id: string;
  title: string;
  policy: Policy;
  payerMode: PayerMode;
  pinnedModel: string;
  participants: Record<string, Participant>;
  messages: ChatMessage[];
  artifacts: Record<string, Artifact>;
  proposals: Record<string, Proposal>;
  decisions: Record<string, Decision>;
  decisionCounter: number;
  commits: Commit[];
  headCommitId: string | null;
  turns: Record<string, Turn>;
  conflicts: Record<string, Conflict>;
  brief: string;
  forkedFrom: { sessionId: string; commitId: string | null; title: string } | null;
  uploads: Record<string, UploadInfo>;
  lastSeq: number;
  eventsById: Record<string, AnyLedgerEvent>;
}

export interface UploadInfo {
  uploadId: string;
  name: string;
  mime: string;
  bytes: number;
  uploaderUserId: string | null;
  artifactId: string | null;
  createdAt: string;
}

export function emptyState(sessionId: string): SessionState {
  return {
    id: sessionId,
    title: "",
    policy: "hybrid",
    payerMode: "sponsor",
    pinnedModel: "",
    participants: {},
    messages: [],
    artifacts: {},
    proposals: {},
    decisions: {},
    decisionCounter: 0,
    commits: [],
    headCommitId: null,
    turns: {},
    conflicts: {},
    brief: "",
    forkedFrom: null,
    uploads: {},
    lastSeq: 0,
    eventsById: {},
  };
}

export function reduce(state: SessionState, ev: AnyLedgerEvent): SessionState {
  if (ev.seq <= state.lastSeq) return state; // idempotent replay
  const s: SessionState = { ...state, lastSeq: ev.seq, eventsById: { ...state.eventsById, [ev.id]: ev } };
  switch (ev.type) {
    case "session.created": {
      const p = ev.payload as Payloads["session.created"];
      s.title = p.title;
      s.policy = p.policy;
      s.payerMode = p.payerMode;
      s.pinnedModel = p.pinnedModel;
      s.forkedFrom = p.forkedFrom ?? null;
      return s;
    }
    case "participant.joined": {
      const p = ev.payload as Payloads["participant.joined"];
      const uid = ev.actorUserId!;
      s.participants = {
        ...s.participants,
        [uid]: { userId: uid, name: p.name, color: p.color, role: p.role, avatarUrl: p.avatarUrl, consented: s.participants[uid]?.consented ?? false, present: false },
      };
      return s;
    }
    case "participant.consented": {
      const uid = ev.actorUserId!;
      const existing = s.participants[uid];
      if (existing) s.participants = { ...s.participants, [uid]: { ...existing, consented: true } };
      return s;
    }
    case "message.posted": {
      const p = ev.payload as Payloads["message.posted"];
      s.messages = [
        ...s.messages,
        { eventId: ev.id, seq: ev.seq, kind: "user", mode: p.mode, intent: p.intent, userId: ev.actorUserId, text: p.text, turnId: ev.turnId, createdAt: ev.createdAt, attachments: p.attachments },
      ];
      return s;
    }
    case "turn.started": {
      const p = ev.payload as Payloads["turn.started"];
      s.turns = {
        ...s.turns,
        [ev.turnId!]: {
          id: ev.turnId!,
          status: "generating",
          payerUserId: p.payerUserId,
          onBehalfOf: p.onBehalfOf,
          provider: p.provider,
          modelRequested: p.modelRequested,
          batchEventIds: p.batchEventIds,
          startedAt: ev.createdAt,
        },
      };
      return s;
    }
    case "turn.model_degraded": {
      const p = ev.payload as Payloads["turn.model_degraded"];
      const t = s.turns[ev.turnId!];
      if (t) s.turns = { ...s.turns, [t.id]: { ...t, modelUsed: p.used } };
      return s;
    }
    case "ai.message": {
      const p = ev.payload as Payloads["ai.message"];
      s.messages = [
        ...s.messages,
        {
          eventId: ev.id,
          seq: ev.seq,
          kind: "ai",
          userId: null,
          onBehalfOf: p.onBehalfOf,
          payerUserId: p.payerUserId,
          provider: p.provider,
          model: p.model,
          text: p.text,
          turnId: ev.turnId,
          partial: p.partial,
          createdAt: ev.createdAt,
        },
      ];
      return s;
    }
    case "ai.clarification": {
      const p = ev.payload as Payloads["ai.clarification"];
      s.messages = [
        ...s.messages,
        { eventId: ev.id, seq: ev.seq, kind: "clarification", userId: null, onBehalfOf: p.onBehalfOf, text: p.question, turnId: ev.turnId, createdAt: ev.createdAt },
      ];
      return s;
    }
    case "proposal.created": {
      const p = ev.payload as Payloads["proposal.created"];
      s.proposals = {
        ...s.proposals,
        [p.proposalId]: {
          id: p.proposalId,
          artifactId: p.artifactId,
          artifactType: p.artifactType,
          title: p.title,
          op: p.op,
          risk: p.risk,
          requiresApprovalFrom: p.requiresApprovalFrom,
          approvals: {},
          rationale: p.rationale,
          baseVersionNo: p.baseVersionNo,
          proposedContent: p.proposedContent,
          provenance: p.provenance,
          status: "pending",
          autoApplyAt: p.autoApplyAt,
          proposedByEventId: ev.id,
          proposerUserId: ev.actorUserId,
          turnId: ev.turnId,
          createdAt: ev.createdAt,
        },
      };
      return s;
    }
    case "proposal.approved":
    case "proposal.rejected": {
      const p = ev.payload as Payloads["proposal.approved"];
      const pr = s.proposals[p.proposalId];
      if (!pr) return s;
      const approvals = { ...pr.approvals, [ev.actorUserId!]: ev.type === "proposal.approved" ? "approve" : "reject" } as Record<string, "approve" | "reject">;
      const status: ProposalStatus = ev.type === "proposal.rejected" ? "rejected" : pr.status;
      s.proposals = { ...s.proposals, [pr.id]: { ...pr, approvals, status } };
      return s;
    }
    case "proposal.expired": {
      const p = ev.payload as Payloads["proposal.expired"];
      const pr = s.proposals[p.proposalId];
      if (pr) s.proposals = { ...s.proposals, [pr.id]: { ...pr, status: "expired" } };
      return s;
    }
    case "artifact.applied": {
      const p = ev.payload as Payloads["artifact.applied"];
      const version: ArtifactVersion = {
        versionId: p.versionId,
        versionNo: p.versionNo,
        content: p.content,
        summary: p.summary,
        authorKind: p.authorKind,
        authorUserId: p.authorUserId,
        eventId: ev.id,
        proposalId: p.proposalId,
        provenance: p.provenance,
        createdAt: ev.createdAt,
        op: p.op,
      };
      const existing = s.artifacts[p.artifactId];
      const art: Artifact = existing
        ? { ...existing, title: p.title, versions: [...existing.versions, version], current: version, deleted: p.op === "delete" }
        : {
            id: p.artifactId,
            type: p.artifactType,
            title: p.title,
            ownerUserId: p.authorUserId,
            versions: [version],
            current: version,
            pinned: false,
            deleted: false,
            blockedByDecisionPoint: null,
            createdAt: ev.createdAt,
          };
      s.artifacts = { ...s.artifacts, [p.artifactId]: art };
      if (p.proposalId && s.proposals[p.proposalId]) {
        s.proposals = { ...s.proposals, [p.proposalId]: { ...s.proposals[p.proposalId]!, status: "applied" } };
      }
      return s;
    }
    case "artifact.pinned": {
      const p = ev.payload as Payloads["artifact.pinned"];
      const a = s.artifacts[p.artifactId];
      if (a) s.artifacts = { ...s.artifacts, [a.id]: { ...a, pinned: p.pinned } };
      return s;
    }
    case "decision.recorded": {
      const p = ev.payload as Payloads["decision.recorded"];
      const decisions = { ...s.decisions };
      if (p.supersedes && decisions[p.supersedes]) {
        decisions[p.supersedes] = { ...decisions[p.supersedes]!, status: "superseded", supersededBy: p.decisionId };
      }
      decisions[p.decisionId] = {
        id: p.decisionId,
        label: p.label,
        statement: p.statement,
        status: p.status,
        supersedes: p.supersedes,
        supersededBy: null,
        agreedBy: p.agreedBy,
        evidence: p.evidence,
        eventId: ev.id,
        createdAt: ev.createdAt,
      };
      s.decisions = decisions;
      s.decisionCounter = Math.max(s.decisionCounter, parseInt(p.label.replace(/\D/g, ""), 10) || 0);
      return s;
    }
    case "decision.voted": {
      const p = ev.payload as Payloads["decision.voted"];
      const a = s.artifacts[p.decisionPointArtifactId];
      if (!a) return s;
      const content = { ...(a.current.content as { votes?: Record<string, string> }) };
      content.votes = { ...(content.votes ?? {}), [ev.actorUserId!]: p.optionId };
      const current = { ...a.current, content };
      s.artifacts = { ...s.artifacts, [a.id]: { ...a, current, versions: [...a.versions.slice(0, -1), current] } };
      return s;
    }
    case "decision.resolved": {
      const p = ev.payload as Payloads["decision.resolved"];
      const a = s.artifacts[p.decisionPointArtifactId];
      if (a) {
        const content = { ...(a.current.content as Record<string, unknown>), resolvedOptionId: p.optionId, resultingDecisionId: p.decisionId };
        const current = { ...a.current, content };
        s.artifacts = { ...s.artifacts, [a.id]: { ...a, current, versions: [...a.versions.slice(0, -1), current] } };
        // unblock artifacts
        const blocks = ((a.current.content as { blocksArtifactIds?: string[] }).blocksArtifactIds ?? []);
        for (const id of blocks) {
          const b = s.artifacts[id];
          if (b && b.blockedByDecisionPoint === a.id) s.artifacts = { ...s.artifacts, [id]: { ...b, blockedByDecisionPoint: null } };
        }
      }
      for (const c of Object.values(s.conflicts)) {
        if (c.decisionPointArtifactId === p.decisionPointArtifactId) s.conflicts = { ...s.conflicts, [c.id]: { ...c, resolved: true } };
      }
      return s;
    }
    case "conflict.flagged": {
      const p = ev.payload as Payloads["conflict.flagged"];
      s.conflicts = {
        ...s.conflicts,
        [p.conflictId]: { id: p.conflictId, directiveEventIds: p.directiveEventIds, contradicts: p.contradicts, summary: p.summary, decisionPointArtifactId: p.decisionPointArtifactId, resolved: false },
      };
      if (p.decisionPointArtifactId) {
        const dp = s.artifacts[p.decisionPointArtifactId];
        const blocks = ((dp?.current.content as { blocksArtifactIds?: string[] })?.blocksArtifactIds ?? []);
        for (const id of blocks) {
          const b = s.artifacts[id];
          if (b) s.artifacts = { ...s.artifacts, [id]: { ...b, blockedByDecisionPoint: p.decisionPointArtifactId } };
        }
      }
      return s;
    }
    case "conflict.resolved": {
      const p = ev.payload as Payloads["conflict.resolved"];
      const c = s.conflicts[p.conflictId];
      if (c) s.conflicts = { ...s.conflicts, [c.id]: { ...c, resolved: true } };
      return s;
    }
    case "turn.interrupted": {
      const t = s.turns[ev.turnId!];
      if (t) s.turns = { ...s.turns, [t.id]: { ...t, status: "interrupted" } };
      return s;
    }
    case "turn.completed": {
      const p = ev.payload as Payloads["turn.completed"];
      const t = s.turns[p.turnId];
      if (t) s.turns = { ...s.turns, [t.id]: { ...t, status: "committed", usage: p.usage, modelUsed: p.modelUsed } };
      return s;
    }
    case "turn.failed": {
      const p = ev.payload as Payloads["turn.failed"];
      const t = s.turns[p.turnId];
      if (t) s.turns = { ...s.turns, [t.id]: { ...t, status: "failed", error: p.error } };
      s.messages = [...s.messages, { eventId: ev.id, seq: ev.seq, kind: "system", userId: null, text: `Turn failed: ${p.error}`, turnId: ev.turnId, createdAt: ev.createdAt }];
      return s;
    }
    case "commit.created": {
      const p = ev.payload as Payloads["commit.created"];
      s.commits = [
        ...s.commits,
        { id: p.commitId, parentId: p.parentCommitId, message: p.message, actorUserId: ev.actorUserId, turnId: ev.turnId, artifactVersions: p.artifactVersions, artifactVersionNos: p.artifactVersionNos, createdAt: ev.createdAt, seq: ev.seq },
      ];
      s.headCommitId = p.commitId;
      return s;
    }
    case "upload.added": {
      const p = ev.payload as Payloads["upload.added"];
      s.uploads = { ...s.uploads, [p.uploadId]: { uploadId: p.uploadId, name: p.name, mime: p.mime, bytes: p.bytes, uploaderUserId: ev.actorUserId, artifactId: null, createdAt: ev.createdAt } };
      return s;
    }
    case "source.ingested": {
      const p = ev.payload as Payloads["source.ingested"];
      const u = s.uploads[p.uploadId];
      if (u) s.uploads = { ...s.uploads, [p.uploadId]: { ...u, artifactId: p.artifactId } };
      return s;
    }
    case "brief.updated": {
      s.brief = (ev.payload as Payloads["brief.updated"]).brief;
      return s;
    }
    default:
      return s;
  }
}

export function reduceAll(sessionId: string, events: AnyLedgerEvent[]): SessionState {
  let s = emptyState(sessionId);
  for (const e of events) s = reduce(s, e);
  return s;
}

export function participantName(s: SessionState, userId: string | null | undefined): string {
  if (!userId) return "AI";
  return s.participants[userId]?.name ?? userId;
}

export function nextDecisionLabel(s: SessionState): string {
  return `D-${String(s.decisionCounter + 1).padStart(2, "0")}`;
}

export function liveArtifacts(s: SessionState): Artifact[] {
  return Object.values(s.artifacts).filter((a) => !a.deleted).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function pendingProposals(s: SessionState): Proposal[] {
  return Object.values(s.proposals).filter((p) => p.status === "pending").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
