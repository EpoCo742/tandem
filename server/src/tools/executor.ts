import { ulid } from "ulid";
import { allAdrs, emptyModel, nextAssumptionLabel, nextDecisionLabel, removeFromModel, toolDescriptions, toolSchemas, upsertBoundaries, upsertComponents, upsertDeployment, upsertRelationships, type ArchModelContent, type ToolName, type ToolResult } from "@tandem/shared";
import type { AlternativesContent, ConstraintsContent, ContractContent, DecisionPointContent, SessionState } from "@tandem/shared";
import { contractsOf } from "@tandem/shared";
import { appendEvent, getState } from "../ledger.js";
import { requestChange } from "../governance.js";
import type { ToolBinding } from "../providers/types.js";
import { searchLibrary } from "../library.js";
import { impactLines, impactOf } from "@tandem/shared";

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
      if (input.boundaries?.length) {
        // Boundaries first so the components can land in them with the right names and tints.
        const withBoundaries = upsertBoundaries(currentModel(), input.boundaries);
        const next = upsertComponents(withBoundaries, input.components, input.derivedFrom);
        return writeModel(next, input.rationale, `Model: ${next.components.length} components, ${next.boundaries.length} boundaries`);
      }
      const next = upsertComponents(currentModel(), input.components, input.derivedFrom);
      return writeModel(next, input.rationale, `Model: ${next.components.length} components, ${next.relationships.length} relationships`);
    }),

    bind("upsert_relationships", async (input) => {
      const { model, unknown } = upsertRelationships(currentModel(), input.relationships, input.derivedFrom);
      if (unknown.length === input.relationships.length * 2) return { status: "error", message: `Unknown component ids: ${unknown.join(", ")}. Call upsert_components first.` };
      return writeModel(model, input.rationale, `Model: ${model.components.length} components, ${model.relationships.length} relationships`, unknown);
    }),

    bind("upsert_deployment", async (input) => {
      const { model, unknown } = upsertDeployment(currentModel(), input);
      if (unknown.length && unknown.length === (input.placements?.length ?? 0)) return { status: "error", message: `Unknown ids: ${unknown.join(", ")}. Components must exist in the model and nodes must be declared in the same call or before.` };
      const d = model.deployment!;
      return writeModel(model, input.rationale, `Deployment: ${d.nodes.length} node${d.nodes.length === 1 ? "" : "s"}, ${d.environments.length} environment${d.environments.length === 1 ? "" : "s"}`, unknown);
    }),

    bind("upsert_constraints", async (input) => {
      const state = getState(scope.sessionId);
      const existing = Object.values(state.artifacts).find((a) => a.type === "constraints" && !a.deleted);
      const cur: ConstraintsContent = (existing?.current.content as ConstraintsContent | undefined) ?? { constraints: [], sections: [] };
      const list = [...cur.constraints];
      let n = list.reduce((m, k) => Math.max(m, Number(k.id.replace(/^C-/, "")) || 0), 0);
      // A constraint belongs to whoever set it: amending it, or carving an exception out of it,
      // is proposed to that person even when the card itself is the actor's.
      const guardians = new Set<string>();
      for (const raw of input.constraints) {
        if (raw.id && !list.some((k) => k.id === raw.id)) return { status: "error", message: `No constraint ${raw.id}; omit id to add a new one` };
        if (raw.exceptionTo && !list.some((k) => k.id === raw.exceptionTo)) return { status: "error", message: `No constraint ${raw.exceptionTo} to make an exception to` };
      }
      for (const raw of input.constraints) {
        const i = raw.id ? list.findIndex((k) => k.id === raw.id) : -1;
        const fromDocument = Boolean(raw.source && state.artifacts[raw.source]);
        const original = raw.exceptionTo ? list.find((k) => k.id === raw.exceptionTo) : undefined;
        if (i >= 0 && list[i]!.setBy && list[i]!.setBy !== scope.onBehalfOf) guardians.add(list[i]!.setBy!);
        if (original?.setBy && original.setBy !== scope.onBehalfOf) guardians.add(original.setBy);
        const next = {
          id: i >= 0 ? list[i]!.id : `C-${String(++n).padStart(2, "0")}`,
          statement: raw.statement.replace(/\.$/, ""),
          kind: raw.kind,
          category: raw.category,
          value: raw.value,
          setBy: i >= 0 ? list[i]!.setBy : fromDocument ? null : scope.onBehalfOf,
          source: raw.source ?? input.derivedFrom[0],
          ...(raw.exceptionTo ? { exceptionTo: raw.exceptionTo } : {}),
          ...(raw.importedFrom ? { importedFrom: raw.importedFrom } : {}),
          derivedFrom: [...new Set([...(i >= 0 ? list[i]!.derivedFrom : []), ...input.derivedFrom])],
        };
        if (i >= 0) list[i] = { ...list[i]!, ...next };
        else list.push(next);
      }
      const content: ConstraintsContent = { constraints: list, sections: [{ id: "constraints", derivedFrom: input.derivedFrom }] };
      const r = requestChange({ ...common, op: existing ? "update" : "create", artifactId: existing?.id ?? null, artifactType: "constraints", title: existing?.title ?? "Constraints", content, summary: `${list.length} constraint${list.length === 1 ? "" : "s"}`, rationale: input.rationale, baseVersionNo: existing?.current.versionNo ?? null, provenance: [{ sectionId: "constraints", derivedFrom: input.derivedFrom }], approvalFrom: [...guardians] });
      if (r.status === "applied") return { status: "constraints_updated", artifactId: r.artifactId, versionNo: r.versionNo, constraints: list.map((k) => ({ id: k.id, statement: k.statement })) };
      return r as ToolResult;
    }),

    bind("remove_constraints", async (input) => {
      const state = getState(scope.sessionId);
      const existing = Object.values(state.artifacts).find((a) => a.type === "constraints" && !a.deleted);
      if (!existing) return { status: "error", message: "No constraints card" };
      const cur = existing.current.content as ConstraintsContent;
      const drop = new Set(input.constraintIds);
      const missing = input.constraintIds.filter((id) => !cur.constraints.some((k) => k.id === id));
      if (missing.length) return { status: "error", message: `No constraint ${missing.join(", ")}` };
      // Removing what someone else set, or the constraint an exception hangs off, needs them.
      const guardians = new Set<string>();
      for (const k of cur.constraints) {
        if (drop.has(k.id) && k.setBy && k.setBy !== scope.onBehalfOf) guardians.add(k.setBy);
        if (k.exceptionTo && drop.has(k.exceptionTo) && k.setBy && k.setBy !== scope.onBehalfOf) guardians.add(k.setBy);
      }
      const content: ConstraintsContent = { ...cur, constraints: cur.constraints.filter((k) => !drop.has(k.id)).map((k) => (k.exceptionTo && drop.has(k.exceptionTo) ? { ...k, exceptionTo: undefined } : k)) };
      const r = requestChange({ ...common, op: "update", artifactId: existing.id, artifactType: "constraints", title: existing.title, content, summary: `${content.constraints.length} constraint${content.constraints.length === 1 ? "" : "s"}`, rationale: input.rationale, baseVersionNo: existing.current.versionNo, provenance: existing.current.provenance, approvalFrom: [...guardians] });
      if (r.status === "applied") return { status: "constraints_updated", artifactId: r.artifactId, versionNo: r.versionNo, constraints: content.constraints.map((k) => ({ id: k.id, statement: k.statement })) };
      return r as ToolResult;
    }),

    bind("set_as_is", async (input) => {
      const state = getState(scope.sessionId);
      const existing = Object.values(state.artifacts).find((a) => a.type === "arch_model" && !a.deleted);
      const cur = (existing?.current.content as ArchModelContent | undefined) ?? emptyModel();
      const base = upsertComponents(emptyModel(), input.components, input.derivedFrom);
      const { model: snap } = upsertRelationships(base, input.relationships, input.derivedFrom);
      const asIs = { source: input.source, capturedAt: new Date().toISOString(), components: snap.components, relationships: snap.relationships, boundaries: snap.boundaries, ...(input.notes?.length ? { notes: input.notes } : {}) };
      const replace = input.replaceModel ?? cur.components.length === 0;
      const content: ArchModelContent = replace
        ? { components: snap.components, relationships: snap.relationships, boundaries: snap.boundaries, sections: [{ id: "model", derivedFrom: input.derivedFrom }], asIs }
        : { ...cur, asIs };
      const r = requestChange({ ...common, op: existing ? "update" : "create", artifactId: existing?.id ?? null, artifactType: "arch_model", title: existing?.title ?? "Architecture model", content, summary: replace ? `As-is from ${input.source}: ${snap.components.length} components` : `As-is baseline from ${input.source} recorded; the model is the target state`, rationale: input.rationale, baseVersionNo: existing?.current.versionNo ?? null, provenance: [{ sectionId: "model", derivedFrom: input.derivedFrom }] });
      if (r.status !== "applied") return r as ToolResult;
      const views = Object.values(getState(scope.sessionId).artifacts).filter((a) => a.type === "view" && !a.deleted);
      if (!views.some((a) => (a.current.content as { kind: string }).kind === "container")) {
        requestChange({ ...common, op: "create", artifactId: null, artifactType: "view", title: "System architecture", content: { kind: "container", sections: [{ id: "overview", derivedFrom: input.derivedFrom }] }, summary: "Container view generated from the architecture model", rationale: "First view of the model", baseVersionNo: null, provenance: [{ sectionId: "overview", derivedFrom: input.derivedFrom }] });
      }
      let diffView = views.find((a) => (a.current.content as { kind: string }).kind === "diff");
      if (!diffView) {
        const made = requestChange({ ...common, op: "create", artifactId: null, artifactType: "view", title: "As-is vs to-be", content: { kind: "diff", note: `As-is from ${input.source}. Green: added in the target state; dashed red: removed; amber: changed; grey: unchanged.`, sections: [{ id: "diff", derivedFrom: input.derivedFrom }] }, summary: "What the target state changes against the as-is", rationale: "Diff view of the as-is baseline", baseVersionNo: null, provenance: [{ sectionId: "diff", derivedFrom: input.derivedFrom }] });
        diffView = made.status === "applied" ? getState(scope.sessionId).artifacts[made.artifactId] : undefined;
      }
      return { status: "as_is_set", artifactId: r.artifactId, versionNo: r.versionNo, components: snap.components.length, relationships: snap.relationships.length, modelReplaced: replace, diffViewArtifactId: diffView?.id ?? "" };
    }),

    bind("propose_alternatives", async (input) => {
      const letters = ["a", "b", "c"];
      const candidates = input.candidates.map((c, i) => {
        const base = upsertComponents(emptyModel(), c.components, input.derivedFrom);
        const { model } = upsertRelationships(base, c.relationships, input.derivedFrom);
        return { id: letters[i]!, title: c.title, summary: c.summary, model, pros: c.pros, cons: c.cons, constraintsMet: c.constraintsMet ?? [], constraintsAtRisk: c.constraintsAtRisk ?? [] };
      });
      const content: AlternativesContent = { question: input.question, candidates, sections: [{ id: "alternatives", derivedFrom: input.derivedFrom }] };
      const r = requestChange({ ...common, op: "create", artifactId: null, artifactType: "alternatives", title: `Alternatives: ${input.question}`, content, summary: candidates.map((c) => `${c.id.toUpperCase()}. ${c.title}`).join(" · "), rationale: input.rationale, baseVersionNo: null, provenance: [{ sectionId: "alternatives", derivedFrom: input.derivedFrom }] });
      if (r.status === "applied") return { status: "alternatives_proposed", artifactId: r.artifactId, candidates: candidates.map((c) => ({ id: c.id, title: c.title })) };
      return r as ToolResult;
    }),

    bind("render_adr", async (input) => {
      const state = getState(scope.sessionId);
      const files = allAdrs(state).filter((f) => !input.decisionId || f.decision.id === input.decisionId);
      if (input.decisionId && !files.length) return { status: "error", message: `No decision ${input.decisionId}` };
      return { status: "adrs", files: files.map((f) => ({ filename: `docs/adr/${f.filename}`, markdown: f.markdown, label: f.decision.label })) };
    }),

    bind("remove_from_model", async (input) => {
      // What each removed component leaves behind, computed before the write so the answer can say it.
      const before = getState(scope.sessionId);
      const impact: Record<string, string[]> = {};
      for (const id of input.componentIds ?? []) {
        const i = impactOf(before, id);
        if (i) impact[i.component.name] = impactLines(i);
      }
      const next = removeFromModel(currentModel(), input.componentIds ?? [], input.relationshipIds ?? []);
      const r = writeModel(next, input.rationale, `Model: ${next.components.length} components, ${next.relationships.length} relationships`);
      return r.status === "model_updated" && Object.keys(impact).length ? { ...r, impact } : r;
    }),

    bind("create_artifact", async (input) => {
      const r = requestChange({ ...common, op: "create", artifactId: null, artifactType: input.type, title: input.title, content: input.content, summary: input.summary, rationale: input.rationale, baseVersionNo: null });
      if (r.status === "invalid_content") return { status: "error", message: `${r.message}. Nothing was changed.` };
      return r as ToolResult;
    }),

    bind("update_artifact", async (input) => {
      const state = getState(scope.sessionId);
      const a = state.artifacts[input.artifactId];
      if (!a) return { status: "error", message: `No artifact ${input.artifactId}` };
      if (a.type === "decision_point") {
        return { status: "error", message: "Decision point cards are not edited or resolved by you: people resolve them by voting on the card, and you get a system message when that happens. Record what people said with record_decision and leave the card as it is." };
      }
      const r = requestChange({ ...common, op: "update", artifactId: a.id, artifactType: a.type, title: a.title, content: input.content, summary: input.summary, rationale: input.rationale, baseVersionNo: input.baseVersionNo });
      if (r.status === "invalid_content") return { status: "error", message: `${r.message}. Keep the card's existing shape (call read_artifact to see it). Nothing was changed.` };
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
        payload: { decisionId, label, statement: input.statement, status, supersedes: input.supersedes, agreedBy: input.agreedBy, evidence: input.evidence, about: input.about ?? [], context: input.context, options: input.options, consequences: input.consequences, ...(input.importedFrom ? { importedFrom: input.importedFrom } : {}), ...(input.revisitAt ? { revisitAt: input.revisitAt } : {}) },
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

    // Read only, scoped to the person the turn acts for: their sessions plus everything published.
    bind("library_search", async (input) => {
      const r = searchLibrary(scope.onBehalfOf, input.query, { kind: input.kind, limit: input.limit ?? 8, excludeSessionId: input.excludeThisSession ? scope.sessionId : undefined });
      return { status: "library_results", hits: r.hits, searched: r.scope };
    }),

    bind("record_assumption", async (input) => {
      const state = getState(scope.sessionId);
      if (!state.participants[input.ownerUserId]) return { status: "error", message: `No participant ${input.ownerUserId}` };
      const assumptionId = ulid();
      const label = nextAssumptionLabel(state);
      appendEvent(scope.sessionId, { type: "assumption.recorded", actorKind: "ai", actorUserId: scope.onBehalfOf, turnId: scope.turnId, causedBy: input.evidence.length ? input.evidence : scope.batchEventIds, payload: { assumptionId, label, statement: input.statement.replace(/\.$/, ""), ownerUserId: input.ownerUserId, ...(input.revisitAt ? { revisitAt: input.revisitAt } : {}), evidence: input.evidence, about: input.about ?? [] } });
      return { status: "assumption_recorded", assumptionId, label };
    }),

    bind("resolve_assumption", async (input) => {
      const state = getState(scope.sessionId);
      const a = state.assumptions[input.assumptionId];
      if (!a) return { status: "error", message: `No assumption ${input.assumptionId}` };
      if (a.status !== "open") return { status: "error", message: `${a.label} is already ${a.status}` };
      if (input.outcome === "decided" && input.decisionId && !state.decisions[input.decisionId]) return { status: "error", message: `No decision ${input.decisionId}` };
      appendEvent(scope.sessionId, { type: "assumption.resolved", actorKind: "ai", actorUserId: scope.onBehalfOf, turnId: scope.turnId, causedBy: input.evidence?.length ? input.evidence : scope.batchEventIds, payload: { assumptionId: a.id, outcome: input.outcome, ...(input.decisionId ? { decisionId: input.decisionId } : {}), ...(input.note ? { note: input.note } : {}) } });
      return { status: "assumption_resolved", assumptionId: a.id, label: a.label, outcome: input.outcome };
    }),

    bind("upsert_contract", async (input) => {
      const state = getState(scope.sessionId);
      const model = currentModel();
      if (input.attachedTo.relationshipId && !model.relationships.some((r) => r.id === input.attachedTo.relationshipId)) return { status: "error", message: `No relationship ${input.attachedTo.relationshipId} in the model; ids look like from-kind-to` };
      if (input.attachedTo.componentId && !model.components.some((c) => c.id === input.attachedTo.componentId)) return { status: "error", message: `No component ${input.attachedTo.componentId} in the model` };
      if (!input.attachedTo.relationshipId && !input.attachedTo.componentId) return { status: "error", message: "attachedTo needs a relationshipId or a componentId" };
      const existing = Object.values(state.artifacts).find((a) => a.type === "contract" && !a.deleted && JSON.stringify((a.current.content as ContractContent).attachedTo ?? {}) === JSON.stringify(input.attachedTo));
      const content: ContractContent = { format: input.format, body: input.body, attachedTo: input.attachedTo, ...(input.version ? { version: input.version } : {}), sections: [{ id: "body", derivedFrom: input.derivedFrom }] };
      const r = requestChange({ ...common, op: existing ? "update" : "create", artifactId: existing?.id ?? null, artifactType: "contract", title: input.title, content, summary: `${input.format} contract${input.version ? ` ${input.version}` : ""}`, rationale: input.rationale, baseVersionNo: existing?.current.versionNo ?? null, provenance: [{ sectionId: "body", derivedFrom: input.derivedFrom }] });
      if (r.status !== "applied") return r as ToolResult;
      const status = contractsOf(getState(scope.sessionId)).find((c) => c.artifact.id === r.artifactId);
      return { status: "contract_recorded", artifactId: r.artifactId, versionNo: r.versionNo, consumers: (status?.consumers ?? []).map((id) => model.components.find((c) => c.id === id)?.name ?? id) };
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
