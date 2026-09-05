// Ledger event catalogue. Every persisted change in a session is one of these.
// Wire shape is identical on the server, over WebSocket, and in the client reducer.

export type ActorKind = "user" | "ai" | "system";
export type MessageMode = "directive" | "note" | "promoted";

/** What a message is about: a card, or one component of the architecture model as shown on that card. */
export interface MessageAnchor {
  artifactId: string;
  componentId?: string;
}
export type Policy = "lww" | "hybrid" | "review" | "consensus";
export type PayerMode = "speaker" | "sponsor";
export type ProposalOp = "create" | "update" | "delete" | "restore";
export type Risk = "additive" | "cross_owner_edit" | "contradicts_decision" | "destructive";
export type ProposalStatus = "pending" | "applied" | "rejected" | "expired" | "superseded";
export type DecisionStatus = "proposed" | "agreed" | "contested" | "superseded";
export type ArtifactType =
  | "mermaid"
  | "markdown"
  | "data_model"
  | "decision"
  | "decision_point"
  | "source"
  | "sketch"
  | "code"
  | "design_doc"
  | "arch_model"
  | "view"
  | "constraints";

export type TurnStatus =
  | "collecting"
  | "screening"
  | "awaiting_conflict"
  | "generating"
  | "applying"
  | "committed"
  | "interrupted"
  | "failed";

export interface LedgerEventBase {
  id: string;
  sessionId: string;
  seq: number;
  actorKind: ActorKind;
  actorUserId: string | null;
  causedBy: string[];
  turnId: string | null;
  createdAt: string;
}

export interface Provenance {
  sectionId: string;
  derivedFrom: string[];
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  premiumRequests?: number;
  model?: string;
}

export interface Option {
  id: string;
  title: string;
  tradeoffs: string;
  canvasImpact: string;
  proposedBy?: string;
}

// ---- payloads --------------------------------------------------------------

export type Payloads = {
  "session.created": { title: string; policy: Policy; payerMode: PayerMode; pinnedModel: string; forkedFrom?: { sessionId: string; commitId: string | null; title: string } };
  "participant.joined": { role: "owner" | "editor" | "viewer"; name: string; color: string; avatarUrl?: string };
  "participant.left": Record<string, never>;
  "participant.consented": { providers: string[] };
  "message.posted": { text: string; mode: MessageMode; attachments: string[]; replyTo?: string; fromNoteEventId?: string; intent?: "compile"; mentions?: string[]; anchor?: MessageAnchor };
  "thread.resolved": { rootEventId: string; resolved: boolean }; // a thread anchored to a card is closed (or reopened) by a person
  "turn.started": { payerUserId: string; provider: string; modelRequested: string; batchEventIds: string[]; onBehalfOf: string };
  "turn.model_degraded": { requested: string; used: string; reason: string };
  "ai.message": { text: string; addressedTo: string[]; toolCallsCount: number; partial?: boolean; onBehalfOf: string; provider: string; model: string; payerUserId: string };
  "ai.clarification": { question: string; addressedTo: string[]; onBehalfOf: string };
  "proposal.created": {
    proposalId: string;
    artifactId: string;
    artifactType: ArtifactType;
    title: string;
    op: ProposalOp;
    risk: Risk;
    requiresApprovalFrom: string[];
    rationale: string;
    baseVersionNo: number | null;
    proposedContent: unknown;
    provenance: Provenance[];
    autoApplyAt: string | null;
  };
  "proposal.approved": { proposalId: string; comment?: string };
  "proposal.rejected": { proposalId: string; comment?: string };
  "proposal.expired": { proposalId: string };
  "artifact.applied": {
    artifactId: string;
    artifactType: ArtifactType;
    title: string;
    versionId: string;
    versionNo: number;
    op: ProposalOp;
    proposalId: string | null;
    content: unknown;
    summary: string | null;
    authorKind: "user" | "ai";
    authorUserId: string;
    provenance: Provenance[];
    contentHash: string;
  };
  "artifact.edited_live": { artifactId: string; editorUserIds: string[] };
  "artifact.pinned": { artifactId: string; pinned: boolean };
  "decision.recorded": {
    decisionId: string;
    label: string;
    statement: string;
    status: DecisionStatus;
    supersedes: string | null;
    agreedBy: string[];
    evidence: string[];
    about?: string[]; // architecture model component ids this decision concerns
    context?: string; // ADR: the situation that called for a decision
    options?: { title: string; tradeoffs?: string; chosen?: boolean }[]; // ADR: what was considered
    consequences?: string; // ADR: what follows from it
  };
  "decision.voted": { decisionPointArtifactId: string; optionId: string };
  "decision.deadline_set": { decisionPointArtifactId: string; at: string };
  "decision.expired": { decisionPointArtifactId: string }; // the deadline passed without a majority
  "decision.resolved": { decisionPointArtifactId: string; optionId: string; decisionId: string | null };
  "conflict.flagged": {
    conflictId: string;
    directiveEventIds: string[];
    contradicts: { decisionId?: string; artifactId?: string };
    summary: string;
    decisionPointArtifactId: string | null;
  };
  "conflict.resolved": { conflictId: string; resolution: "decision_point" | "override" | "withdrawn" };
  "turn.interrupted": { turnId: string; partialTextKept: boolean };
  "turn.completed": { turnId: string; usage: Usage; modelUsed: string };
  "turn.failed": { turnId: string; error: string };
  "turn.note": { turnId: string; text: string }; // something the runtime reported mid-turn (MCP connection, auth, tool list)
  "commit.created": {
    commitId: string;
    parentCommitId: string | null;
    message: string;
    artifactVersions: Record<string, string>;
    artifactVersionNos: Record<string, number>;
  };
  "commit.reverted_to": { targetCommitId: string; newCommitId: string };
  "upload.added": { uploadId: string; mime: string; bytes: number; name: string };
  "source.ingested": { uploadId: string; artifactId: string };
  "external.call_proposed": { callId: string; ownerUserId: string; serverName: string; toolName: string; args: unknown; readOnly: boolean; summary: string; onBehalfOf: string };
  "external.call_resolved": { callId: string; decision: "approved" | "denied"; reason?: string };
  "external.call_completed": { callId: string; ok: boolean; summary: string };
  "brief.updated": { brief: string; throughSeq: number; payerUserId?: string; provider?: string; model?: string; folded?: number };
};

export type EventType = keyof Payloads;

export type LedgerEvent<T extends EventType = EventType> = LedgerEventBase & {
  type: T;
  payload: Payloads[T];
};

export type AnyLedgerEvent = { [K in EventType]: LedgerEvent<K> }[EventType];

// ---- ephemeral (never persisted) ------------------------------------------

export type EphemeralEvent =
  | { kind: "ai.delta"; sessionId: string; turnId: string; text: string }
  | { kind: "ai.tool_progress"; sessionId: string; turnId: string; tool: string; artifactId?: string; status: "start" | "done" | "error" }
  | { kind: "turn.state"; sessionId: string; state: TurnStatus | "idle"; queued: number; turnId: string | null; payerUserId: string | null }
  | { kind: "typing"; sessionId: string; userId: string; lane: "ai" | "side"; active: boolean };

export type WireMessage =
  | { t: "event"; event: AnyLedgerEvent }
  | { t: "ephemeral"; event: EphemeralEvent }
  | { t: "replay_done"; seq: number }
  | { t: "error"; message: string };

export type ClientMessage =
  | { t: "subscribe"; sessionId: string; fromSeq: number }
  | { t: "typing"; sessionId: string; lane: "ai" | "side"; active: boolean };
