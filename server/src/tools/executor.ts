import { ulid } from "ulid";
import { allAdrs, emptyModel, nextDecisionLabel, removeFromModel, toolDescriptions, toolSchemas, upsertComponents, upsertRelationships, type ArchModelContent, type ToolName, type ToolResult } from "@tandem/shared";
import type { ConstraintsContent, DecisionPointContent, SessionState } from "@tandem/shared";
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

  // The architecture model is one artifact per session; the model tools read-modify-write it
  // through the same governance as any other change (someone else's model -> proposal).
  const modelArtifact = (state: SessionState) => Object.values(state.artifacts).find((a) => a.type === "arch_model" && !a.deleted);
  const writeModel = (next: ArchModelContent, rationale: string, summary: string, unknown?: string[]): ToolResult => {
    const state = getState(scope.sessionId);
    const existing = modelArtifact(state);
    const r = requestChange({
      ...common,
      op: existing ? "update" : "create",
      artifactId: existing?.id ?? null,
      artifactType: "arch_model",
      title: existing?.title ?? "Architecture model",
      content: next,
      summary,
      rationale,
      baseVersionNo: existing?.current.versionNo ?? null,
      provenance: [{ sectionId: "model", derivedFrom: scope.batchEventIds }],
    });
    if (r.status === "applied") return { status: "model_updated", artifactId: r.artifactId, versionNo: r.versionNo, components: next.components.length, relationships: next.relationships.length, ...(unknown?.length ? { unknown } : {}) };
    return r as ToolResult;
  };
  const currentModel = (): ArchModelContent => (modelArtifact(getState(scope.sessionId))?.current.content as ArchModelContent | undefined) ?? emptyModel();

  return [
    bind("upsert_components", async (input) => {
      const next = upsertComponents(currentModel(), input.components, input.derivedFrom);
      return writeModel(next, input.rationale, `Model: ${next.components.length} components, ${next.relationships.length} relationships`);
    }),

    bind("upsert_relationships", async (input) => {
      const { model, unknown } = upsertRelationships(currentModel(), input.relationships, input.derivedFrom);
      if (unknown.length === input.relationships.length * 2) return { status: "error", message: `Unknown component ids: ${unknown.join(", ")}. Call upsert_components first.` };
      return writeModel(model, input.rationale, `Model: ${model.components.length} components, ${model.relationships.length} relationships`, unknown);
    }),

    bind("upsert_constraints", async (input) => {
      const state = getState(scope.sessionId);
      const existing = Object.values(state.artifacts).find((a) => a.type === "constraints" && !a.deleted);
      const cur: ConstraintsContent = (existing?.current.content as ConstraintsContent | undefined) ?? { constraints: [], sections: [] };
      const list = [...cur.constraints];
      let n = list.reduce((m, k) => Math.max(m, Number(k.id.replace(/^C-/, "")) || 0), 0);
      for (const raw of input.constraints) {
        const i = raw.id ? list.findIndex((k) => k.id === raw.id) : -1;
        const fromDocument = Boolean(raw.source && state.artifacts[raw.source]);
        const next = {
          id: i >= 0 ? list[i]!.id : `C-${String(++n).padStart(2, "0")}`,
          statement: raw.statement.replace(/\.$/, ""),
          kind: raw.kind,
          category: raw.category,
          value: raw.value,
          setBy: fromDocument ? null : scope.onBehalfOf,
          source: raw.source ?? input.derivedFrom[0],
          derivedFrom: [...new Set([...(i >= 0 ? list[i]!.derivedFrom : []), ...input.derivedFrom])],
        };
        if (i >= 0) list[i] = { ...list[i]!, ...next };
        else list.push(next);
      }
      const content: ConstraintsContent = { constraints: list, sections: [{ id: "constraints", derivedFrom: input.derivedFrom }] };
      const r = requestChange({ ...common, op: existing ? "update" : "create", artifactId: existing?.id ?? null, artifactType: "constraints", title: existing?.title ?? "Constraints", content, summary: `${list.length} constraint${list.length === 1 ? "" : "s"}`, rationale: input.rationale, baseVersionNo: existing?.current.versionNo ?? null, provenance: [{ sectionId: "constraints", derivedFrom: input.derivedFrom }] });
      if (r.status === "applied") return { status: "constraints_updated", artifactId: r.artifactId, versionNo: r.versionNo, constraints: list.map((k) => ({ id: k.id, statement: k.statement })) };
      return r as ToolResult;
    }),

    bind("remove_constraints", async (input) => {
      const state = getState(scope.sessionId);
      const existing = Object.values(state.artifacts).find((a) => a.type === "constraints" && !a.deleted);
      if (!existing) return { status: "error", message: "No constraints card" };
      const cur = existing.current.content as ConstraintsContent;
      const drop = new Set(input.constraintIds);
      const content: ConstraintsContent = { ...cur, constraints: cur.constraints.filter((k) => !drop.has(k.id)) };
      const r = requestChange({ ...common, op: "update", artifactId: existing.id, artifactType: "constraints", title: existing.title, content, summary: `${content.constraints.length} constraint${content.constraints.length === 1 ? "" : "s"}`, rationale: input.rationale, baseVersionNo: existing.current.versionNo, provenance: existing.current.provenance });
      if (r.status === "applied") return { status: "constraints_updated", artifactId: r.artifactId, versionNo: r.versionNo, constraints: content.constraints.map((k) => ({ id: k.id, statement: k.statement })) };
      return r as ToolResult;
    }),

    bind("render_adr", async (input) => {
      const state = getState(scope.sessionId);
      const files = allAdrs(state).filter((f) => !input.decisionId || f.decision.id === input.decisionId);
      if (input.decisionId && !files.length) return { status: "error", message: `No decision ${input.decisionId}` };
      return { status: "adrs", files: files.map((f) => ({ filename: `docs/adr/${f.filename}`, markdown: f.markdown, label: f.decision.label })) };
    }),

    bind("remove_from_model", async (input) => {
      const next = removeFromModel(currentModel(), input.componentIds ?? [], input.relationshipIds ?? []);
      return writeModel(next, input.rationale, `Model: ${next.components.length} components, ${next.relationships.length} relationships`);
    }),

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
        payload: { decisionId, label, statement: input.statement, status, supersedes: input.supersedes, agreedBy: input.agreedBy, evidence: input.evidence, about: input.about ?? [], context: input.context, options: input.options, consequences: input.consequences },
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
        ...(input.violatesConstraintIds?.length ? { violatesConstraintIds: input.violatesConstraintIds } : {}),
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
