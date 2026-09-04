import { ulid } from "ulid";
import { nextDecisionLabel, toolDescriptions, toolSchemas, type ToolName, type ToolResult } from "@tandem/shared";
import type { DecisionPointContent } from "@tandem/shared";
import { appendEvent, getState } from "../ledger.js";
import { requestChange } from "../governance.js";
import type { ToolBinding } from "../providers/types.js";

// Binds the shared tool schemas to a session/turn. The same handlers serve every provider.

export interface ExecutorScope {
  sessionId: string;
  turnId: string;
  onBehalfOf: string; // the human this AI turn acts for
  batchEventIds: string[];
  onToolProgress?: (tool: string, status: "start" | "done" | "error", artifactId?: string) => void;
}

export function buildToolBindings(scope: ExecutorScope): ToolBinding[] {
  const bind = <N extends ToolName>(name: N, handler: (input: ReturnType<(typeof toolSchemas)[N]["parse"]>) => Promise<ToolResult>): ToolBinding => ({
    name,
    description: toolDescriptions[name],
    schema: toolSchemas[name],
    handler: async (raw: unknown) => {
      const parsed = toolSchemas[name].safeParse(raw);
      if (!parsed.success) return { status: "error", message: `Invalid input for ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
      try {
        return await handler(parsed.data as never);
      } catch (e) {
        return { status: "error", message: (e as Error).message };
      }
    },
  });

  const common = { sessionId: scope.sessionId, turnId: scope.turnId, actorKind: "ai" as const, actorUserId: scope.onBehalfOf, causedBy: scope.batchEventIds };

  return [
    bind("create_artifact", async (input) => {
      const r = requestChange({ ...common, op: "create", artifactId: null, artifactType: input.type, title: input.title, content: input.content, summary: input.summary, rationale: input.rationale, baseVersionNo: null });
      return r as ToolResult;
    }),

    bind("update_artifact", async (input) => {
      const state = getState(scope.sessionId);
      const a = state.artifacts[input.artifactId];
      if (!a) return { status: "error", message: `No artifact ${input.artifactId}` };
      const r = requestChange({ ...common, op: "update", artifactId: a.id, artifactType: a.type, title: a.title, content: input.content, summary: input.summary, rationale: input.rationale, baseVersionNo: input.baseVersionNo });
      return r as ToolResult;
    }),

    bind("delete_artifact", async (input) => {
      const state = getState(scope.sessionId);
      const a = state.artifacts[input.artifactId];
      if (!a) return { status: "error", message: `No artifact ${input.artifactId}` };
      const r = requestChange({ ...common, op: "delete", artifactId: a.id, artifactType: a.type, title: a.title, content: a.current.content, summary: a.current.summary, rationale: input.rationale, baseVersionNo: null });
      return r as ToolResult;
    }),

    bind("record_decision", async (input) => {
      const state = getState(scope.sessionId);
      // "agreed" requires every listed user to have authored evidence, or to be the on-behalf-of user for this turn.
      // "agreed" requires every listed user to have authored evidence, or the evidence to be a
      // system-issued decision-point resolution (the votes are the agreement).
      let status = input.status;
      if (status === "agreed") {
        const evidence = input.evidence.map((id) => state.eventsById[id]).filter(Boolean);
        const authors = new Set(evidence.map((e) => e!.actorUserId).filter(Boolean));
        const viaResolution = evidence.some((e) => e!.actorKind === "system" && e!.type === "message.posted");
        const ok = viaResolution || input.agreedBy.every((u) => authors.has(u) || u === scope.onBehalfOf);
        if (!ok) status = "proposed";
      }
      if (input.supersedes && !state.decisions[input.supersedes]) return { status: "error", message: `No decision ${input.supersedes}` };
      const decisionId = ulid();
      const label = nextDecisionLabel(state);
      appendEvent(scope.sessionId, {
        type: "decision.recorded",
        actorKind: "ai",
        actorUserId: scope.onBehalfOf,
        turnId: scope.turnId,
        causedBy: input.evidence.length ? input.evidence : scope.batchEventIds,
        payload: { decisionId, label, statement: input.statement, status, supersedes: input.supersedes, agreedBy: input.agreedBy, evidence: input.evidence },
      });
      return { status: "recorded", decisionId, label };
    }),

    bind("create_decision_point", async (input) => {
      const state = getState(scope.sessionId);
      const artifactId = ulid();
      const content: DecisionPointContent = {
        question: input.question,
        context: input.context,
        options: input.options,
        votes: {},
        blocksArtifactIds: input.blocksArtifactIds.filter((id) => state.artifacts[id]),
      };
      appendEvent(scope.sessionId, {
        type: "artifact.applied",
        actorKind: "ai",
        actorUserId: scope.onBehalfOf,
        turnId: scope.turnId,
        causedBy: input.directiveEventIds,
        payload: {
          artifactId,
          artifactType: "decision_point",
          title: `Decision point: ${input.question}`,
          versionId: ulid(),
          versionNo: 1,
          op: "create",
          proposalId: null,
          content,
          summary: input.question,
          authorKind: "ai",
          authorUserId: scope.onBehalfOf,
          provenance: [{ sectionId: "question", derivedFrom: input.directiveEventIds }],
          contentHash: "",
        },
      });
      appendEvent(scope.sessionId, {
        type: "conflict.flagged",
        actorKind: "ai",
        actorUserId: scope.onBehalfOf,
        turnId: scope.turnId,
        causedBy: input.directiveEventIds,
        payload: {
          conflictId: ulid(),
          directiveEventIds: input.directiveEventIds,
          contradicts: { decisionId: input.contradictsDecisionId ?? undefined, artifactId: input.blocksArtifactIds[0] },
          summary: input.context,
          decisionPointArtifactId: artifactId,
        },
      });
      return { status: "applied", artifactId, versionNo: 1, title: `Decision point: ${input.question}` };
    }),

    bind("ask_clarification", async (input) => {
      appendEvent(scope.sessionId, {
        type: "ai.clarification",
        actorKind: "ai",
        actorUserId: scope.onBehalfOf,
        turnId: scope.turnId,
        causedBy: scope.batchEventIds,
        payload: { question: input.question, addressedTo: input.addressedTo, onBehalfOf: scope.onBehalfOf },
      });
      return { status: "asked" };
    }),

    bind("read_artifact", async (input) => {
      const a = getState(scope.sessionId).artifacts[input.artifactId];
      if (!a) return { status: "error", message: `No artifact ${input.artifactId}` };
      const v = input.versionNo ? a.versions.find((x) => x.versionNo === input.versionNo) : a.current;
      if (!v) return { status: "error", message: `No version ${input.versionNo}` };
      return { status: "content", artifactId: a.id, versionNo: v.versionNo, content: v.content };
    }),

    bind("pin_artifact", async (input) => {
      const a = getState(scope.sessionId).artifacts[input.artifactId];
      if (!a) return { status: "error", message: `No artifact ${input.artifactId}` };
      appendEvent(scope.sessionId, { type: "artifact.pinned", actorKind: "ai", actorUserId: scope.onBehalfOf, turnId: scope.turnId, payload: { artifactId: a.id, pinned: input.pinned } });
      return { status: "pinned", artifactId: a.id, pinned: input.pinned };
    }),
  ];
}
