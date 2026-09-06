import type { ImportedFrom, PublicationState } from "./library.js";
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
  MessageAnchor,
  Role,
} from "./events.js";

// Pure read model over the ledger. Runs identically on the server and in the browser.

export interface Participant {
  userId: string;
  name: string;
  color: string;
  role: Role;
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
  mentions?: string[];
  replyTo?: string; // event id of the message this one answers (threads)
  anchor?: MessageAnchor; // the card or component this message is about
  resolved?: boolean; // on a thread's first message: a person closed the thread
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
  about: string[];
  context: string;
  options: { title: string; tradeoffs?: string; chosen?: boolean }[];
  consequences: string;
  importedFrom?: ImportedFrom;
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
  briefThroughSeq: number; // messages at or below this seq are folded into the brief
  briefUpdatedAt: string | null;
  forkedFrom: { sessionId: string; commitId: string | null; title: string } | null;
  status: "active" | "archived"; // archived sessions are read only until the owner reopens them
  template: string | null; // session template id (see templates.ts); drives the design checklist
  uploads: Record<string, UploadInfo>;
  externalCalls: Record<string, ExternalCall>;
  reviews: Record<string, ReviewState>; // by design document artifact id
  publications: Record<string, PublicationState>; // by design document artifact id
  lastSeq: number;
  eventsById: Record<string, AnyLedgerEvent>;
}

/** Where the design document stands and who stands behind it. Derived from review.* events and from canvas changes. */
export interface ReviewState {
  artifactId: string;
  status: "draft" | "in_review" | "approved";
  requestedBy: string;
  requestedAt: string;
  requestedVersionNo: number;
  reviewers: string[];
  signoffs: Record<string, { at: string; versionNo: number; eventId: string }>;
  approvedVersionNo?: number;
  approvedAt?: string;
  decisionId?: string;
  changedSince: { artifactId: string; title: string; versionNo: number; byUserId: string | null; at: string }[]; // what changed after approval (or during review)
  history: { versionNo: number; signers: string[]; at: string; decisionId: string }[]; // earlier approvals
}

export interface ExternalCall {
  id: string;
  ownerUserId: string;
  onBehalfOf: string;
  serverName: string;
  toolName: string;
  args: unknown;
  readOnly: boolean;
  summary: string;
  status: "pending" | "approved" | "denied" | "completed" | "failed";
  decidedBy: string | null;
  reason: string | null;
  result: string | null;
  turnId: string | null;
  eventId: string;
  createdAt: string;
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
    briefThroughSeq: 0,
    briefUpdatedAt: null,
    forkedFrom: null,
    status: "active",
    template: null,
    uploads: {},
    externalCalls: {},
    reviews: {},
    publications: {},
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
      s.template = p.template ?? null;
      return s;
    }
    case "session.renamed": {
      const p = ev.payload as Payloads["session.renamed"];
      s.title = p.title;
      const who = ev.actorUserId ? s.participants[ev.actorUserId]?.name ?? "someone" : "someone";
      s.messages = [...s.messages, { eventId: ev.id, seq: ev.seq, kind: "system", userId: null, text: `${who} renamed the session to "${p.title}"`, turnId: ev.turnId, createdAt: ev.createdAt }];
      return s;
    }
    case "session.archived": {
      const p = ev.payload as Payloads["session.archived"];
      s.status = p.archived ? "archived" : "active";
      const who = ev.actorUserId ? s.participants[ev.actorUserId]?.name ?? "someone" : "someone";
      s.messages = [...s.messages, { eventId: ev.id, seq: ev.seq, kind: "system", userId: null, text: p.archived ? `${who} archived the session; it is read only until it is reopened` : `${who} reopened the session`, turnId: ev.turnId, createdAt: ev.createdAt }];
      return s;
    }
    case "doc.published": {
      const p = ev.payload as Payloads["doc.published"];
      const cur = s.publications[p.artifactId];
      const version = { publicationVersionNo: p.publicationVersionNo, docVersionNo: p.docVersionNo, at: ev.createdAt, byUserId: ev.actorUserId, approved: p.approved, ...(p.note ? { note: p.note } : {}) };
      s.publications = { ...s.publications, [p.artifactId]: { publicationId: p.publicationId, artifactId: p.artifactId, slug: p.slug, status: "live", versions: [...(cur?.versions ?? []), version] } };
      const who = ev.actorUserId ? s.participants[ev.actorUserId]?.name ?? "someone" : "Approval";
      const title = s.artifacts[p.artifactId]?.title ?? "the design document";
      s.messages = [...s.messages, { eventId: ev.id, seq: ev.seq, kind: "system", userId: null, text: `${who} published ${title} v${p.docVersionNo} as version ${p.publicationVersionNo} of its public page${p.approved ? ` (approved, ${p.approved.decisionLabel})` : " (not signed off)"}`, turnId: ev.turnId, createdAt: ev.createdAt }];
      return s;
    }
    case "flow.violation": {
      const p = ev.payload as Payloads["flow.violation"];
      const who = ev.actorUserId ? s.participants[ev.actorUserId]?.name ?? "someone" : "The AI";
      const ids = [...new Set(p.violations.map((v) => v.constraintId))].join(", ");
      s.messages = [...s.messages, { eventId: ev.id, seq: ev.seq, kind: "system", userId: null, text: `${who}'s change breaks ${ids}: ${p.violations.map((v) => v.reason).join("; ")}.${p.decisionPointArtifactId ? " A decision point was raised: keep the constraint, make an exception, or amend it. The model is blocked until it is resolved." : ""}`, turnId: ev.turnId, createdAt: ev.createdAt }];
      return s;
    }
    case "doc.unpublished": {
      const p = ev.payload as Payloads["doc.unpublished"];
      const cur = s.publications[p.artifactId];
      if (cur) s.publications = { ...s.publications, [p.artifactId]: { ...cur, status: "revoked" } };
      const who = ev.actorUserId ? s.participants[ev.actorUserId]?.name ?? "someone" : "someone";
      s.messages = [...s.messages, { eventId: ev.id, seq: ev.seq, kind: "system", userId: null, text: `${who} took the public page of ${s.artifacts[p.artifactId]?.title ?? "the design document"} down`, turnId: ev.turnId, createdAt: ev.createdAt }];
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
        { eventId: ev.id, seq: ev.seq, kind: "user", mode: p.mode, intent: p.intent, userId: ev.actorUserId, text: p.text, turnId: ev.turnId, createdAt: ev.createdAt, attachments: p.attachments, mentions: p.mentions, replyTo: p.replyTo, anchor: p.anchor },
      ];
      return s;
    }
    case "alternative.adopted": {
      const p = ev.payload as Payloads["alternative.adopted"];
      const by = p.byUserIds.map((u) => s.participants[u]?.name ?? u).join(", ");
      s.messages = [...s.messages, { eventId: ev.id, seq: ev.seq, kind: "system", userId: null, text: `Alternative "${p.title}" was chosen (${by}). The architecture model is now set from it (v${p.modelVersionNo}) and every view follows; the other candidates stay on the card as what was considered. Recorded ${p.decisionLabel}.`, turnId: null, createdAt: ev.createdAt }];
      return s;
    }
    case "thread.resolved": {
      const p = ev.payload as Payloads["thread.resolved"];
      s.messages = s.messages.map((m) => (m.eventId === p.rootEventId ? { ...m, resolved: p.resolved } : m));
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
      // An approved design document describes the canvas as it was; any change afterwards moves it
      // back to draft with a note of what changed. A new version of the document itself while it is
      // in review drops the signatures, which were given against the earlier version.
      for (const r of Object.values(s.reviews)) {
        if (r.status === "draft") continue;
        const change = { artifactId: p.artifactId, title: p.title, versionNo: p.versionNo, byUserId: p.authorUserId, at: ev.createdAt };
        const who = p.authorUserId ? `${p.authorKind === "ai" ? "AI for " : ""}${s.participants[p.authorUserId]?.name ?? p.authorUserId}` : "the system";
        if (r.status === "approved") {
          s.reviews = { ...s.reviews, [r.artifactId]: { ...r, status: "draft", signoffs: {}, changedSince: [...r.changedSince, change] } };
          s.messages = [...s.messages, { eventId: `${ev.id}:review`, seq: ev.seq, kind: "system", userId: null, text: `${s.artifacts[r.artifactId]?.title ?? "Design document"} is back to draft: ${p.title} changed (v${p.versionNo}, ${who}) after v${r.approvedVersionNo} was approved. It needs to be signed off again.`, turnId: null, createdAt: ev.createdAt }];
        } else if (p.artifactId === r.artifactId && Object.keys(r.signoffs).length) {
          s.reviews = { ...s.reviews, [r.artifactId]: { ...r, signoffs: {}, requestedVersionNo: p.versionNo, changedSince: [...r.changedSince, change] } };
          s.messages = [...s.messages, { eventId: `${ev.id}:review`, seq: ev.seq, kind: "system", userId: null, text: `${p.title} changed to v${p.versionNo} while in review; the signatures given against v${r.requestedVersionNo} are dropped and the reviewers have to sign again.`, turnId: null, createdAt: ev.createdAt }];
        } else if (p.artifactId === r.artifactId) {
          s.reviews = { ...s.reviews, [r.artifactId]: { ...r, requestedVersionNo: p.versionNo, changedSince: [...r.changedSince, change] } };
        } else {
          s.reviews = { ...s.reviews, [r.artifactId]: { ...r, changedSince: [...r.changedSince, change] } };
        }
      }
      return s;
    }
    case "review.requested": {
      const p = ev.payload as Payloads["review.requested"];
      const prev = s.reviews[p.artifactId];
      s.reviews = { ...s.reviews, [p.artifactId]: { artifactId: p.artifactId, status: "in_review", requestedBy: ev.actorUserId!, requestedAt: ev.createdAt, requestedVersionNo: p.versionNo, reviewers: p.reviewers, signoffs: {}, changedSince: [], history: prev?.history ?? [] } };
      const names = p.reviewers.map((u) => s.participants[u]?.name ?? u).join(", ");
      s.messages = [...s.messages, { eventId: ev.id, seq: ev.seq, kind: "system", userId: null, text: `${s.participants[ev.actorUserId!]?.name ?? "Someone"} sent ${s.artifacts[p.artifactId]?.title ?? "the design document"} v${p.versionNo} for review; ${names} ${p.reviewers.length === 1 ? "has" : "have"} to sign off.${p.note ? ` "${p.note}"` : ""}`, turnId: null, createdAt: ev.createdAt }];
      return s;
    }
    case "review.signed": {
      const p = ev.payload as Payloads["review.signed"];
      const r = s.reviews[p.artifactId];
      if (r) s.reviews = { ...s.reviews, [p.artifactId]: { ...r, signoffs: { ...r.signoffs, [ev.actorUserId!]: { at: ev.createdAt, versionNo: p.versionNo, eventId: ev.id } } } };
      return s;
    }
    case "review.approved": {
      const p = ev.payload as Payloads["review.approved"];
      const r = s.reviews[p.artifactId];
      if (r) s.reviews = { ...s.reviews, [p.artifactId]: { ...r, status: "approved", approvedVersionNo: p.versionNo, approvedAt: ev.createdAt, decisionId: p.decisionId, changedSince: [], history: [...r.history, { versionNo: p.versionNo, signers: p.signers, at: ev.createdAt, decisionId: p.decisionId }] } };
      const names = p.signers.map((u) => s.participants[u]?.name ?? u).join(", ");
      s.messages = [...s.messages, { eventId: ev.id, seq: ev.seq, kind: "system", userId: null, text: `${s.artifacts[p.artifactId]?.title ?? "Design document"} v${p.versionNo} is approved, signed off by ${names}. Recorded ${p.decisionLabel}.`, turnId: null, createdAt: ev.createdAt }];
      return s;
    }
    case "review.withdrawn": {
      const p = ev.payload as Payloads["review.withdrawn"];
      const r = s.reviews[p.artifactId];
      if (r) s.reviews = { ...s.reviews, [p.artifactId]: { ...r, status: "draft", signoffs: {} } };
      s.messages = [...s.messages, { eventId: ev.id, seq: ev.seq, kind: "system", userId: null, text: `${s.artifacts[p.artifactId]?.title ?? "Design document"} was taken out of review by ${s.participants[ev.actorUserId!]?.name ?? "someone"}: ${p.reason}`, turnId: null, createdAt: ev.createdAt }];
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
        about: p.about ?? [],
        context: p.context ?? "",
        options: p.options ?? [],
        consequences: p.consequences ?? "",
        ...(p.importedFrom ? { importedFrom: p.importedFrom } : {}),
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
    case "decision.deadline_set": {
      const p = ev.payload as Payloads["decision.deadline_set"];
      const a = s.artifacts[p.decisionPointArtifactId];
      if (!a) return s;
      const current = { ...a.current, content: { ...(a.current.content as Record<string, unknown>), deadline: p.at } };
      s.artifacts = { ...s.artifacts, [a.id]: { ...a, current, versions: [...a.versions.slice(0, -1), current] } };
      return s;
    }
    case "decision.expired": {
      const p = ev.payload as Payloads["decision.expired"];
      const a = s.artifacts[p.decisionPointArtifactId];
      if (!a) return s;
      const current = { ...a.current, content: { ...(a.current.content as Record<string, unknown>), expired: true } };
      s.artifacts = { ...s.artifacts, [a.id]: { ...a, current, versions: [...a.versions.slice(0, -1), current] } };
      for (const id of (a.current.content as { blocksArtifactIds?: string[] }).blocksArtifactIds ?? []) {
        const b = s.artifacts[id];
        if (b && b.blockedByDecisionPoint === a.id) s.artifacts = { ...s.artifacts, [id]: { ...b, blockedByDecisionPoint: null } };
      }
      const q = (a.current.content as { question?: string }).question ?? a.title;
      s.messages = [...s.messages, { eventId: ev.id, seq: ev.seq, kind: "system", userId: null, text: `Decision point "${q}" expired without a majority; its cards are editable again and the question stays open.`, turnId: null, createdAt: ev.createdAt }];
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
    case "turn.note": {
      const p = ev.payload as Payloads["turn.note"];
      s.messages = [...s.messages, { eventId: ev.id, seq: ev.seq, kind: "system", userId: null, text: p.text, turnId: ev.turnId, createdAt: ev.createdAt }];
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
    case "external.call_proposed": {
      const p = ev.payload as Payloads["external.call_proposed"];
      s.externalCalls = { ...s.externalCalls, [p.callId]: { id: p.callId, ownerUserId: p.ownerUserId, onBehalfOf: p.onBehalfOf, serverName: p.serverName, toolName: p.toolName, args: p.args, readOnly: p.readOnly, summary: p.summary, status: "pending", decidedBy: null, reason: null, result: null, turnId: ev.turnId, eventId: ev.id, createdAt: ev.createdAt } };
      return s;
    }
    case "external.call_resolved": {
      const p = ev.payload as Payloads["external.call_resolved"];
      const c = s.externalCalls[p.callId];
      if (c) s.externalCalls = { ...s.externalCalls, [p.callId]: { ...c, status: p.decision, decidedBy: ev.actorUserId, reason: p.reason ?? null } };
      return s;
    }
    case "external.call_completed": {
      const p = ev.payload as Payloads["external.call_completed"];
      const c = s.externalCalls[p.callId];
      if (c) {
        s.externalCalls = { ...s.externalCalls, [p.callId]: { ...c, status: p.ok ? "completed" : "failed", result: p.summary } };
        const owner = s.participants[c.ownerUserId]?.name ?? "someone";
        if (!c.readOnly || !p.ok) s.messages = [...s.messages, { eventId: ev.id, seq: ev.seq, kind: "system", userId: null, text: `${owner}'s ${c.serverName} tool ${c.toolName} ${p.ok ? "ran" : "failed"}: ${p.summary}`, turnId: ev.turnId, createdAt: ev.createdAt }];
      }
      return s;
    }
    case "brief.updated": {
      const p = ev.payload as Payloads["brief.updated"];
      s.brief = p.brief;
      s.briefThroughSeq = Math.max(s.briefThroughSeq, p.throughSeq);
      s.briefUpdatedAt = ev.createdAt;
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

/** The session as it was after event `seq`: a fold of the ledger up to that point (replay, diffs between moments). */
export function reduceUpTo(sessionId: string, events: AnyLedgerEvent[], seq: number): SessionState {
  return reduceAll(sessionId, [...events].filter((e) => e.seq <= seq).sort((a, b) => a.seq - b.seq));
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
