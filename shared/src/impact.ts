import type { Constraint, ConstraintsContent, AlternativesContent } from "./artifacts.js";
import { contentText } from "./artifacts.js";
import type { ArchModelContent, ModelComponent, ModelRelationship, ViewContent } from "./model.js";
import { liveArtifacts, type Artifact, type Decision, type SessionState } from "./reducer.js";
import { threads, type Thread } from "./threads.js";

// What depends on a component: a deterministic report over the model, the decisions, the
// constraints, the views, the alternatives, the documents and the threads. No AI turn; the
// same report goes into the remove tool's result so the model names it before removing.

export interface Impact {
  component: ModelComponent;
  relationships: { rel: ModelRelationship; other: ModelComponent | undefined; direction: "out" | "in" }[];
  decisions: Decision[];
  constraints: Constraint[];
  views: Artifact[];
  alternatives: { artifact: Artifact; candidates: string[] }[];
  mentions: { artifact: Artifact; count: number }[];
  threads: Thread[];
  ifRemoved: { relationships: number; viewsAffected: number; decisionsLeftPointing: number; threadsOrphaned: number };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function impactOf(state: SessionState, componentId: string): Impact | null {
  const live = liveArtifacts(state);
  const modelArt = live.find((a) => a.type === "arch_model");
  const model = modelArt?.current.content as ArchModelContent | undefined;
  const c = model?.components.find((x) => x.id === componentId);
  if (!model || !c) return null;
  const nameRe = new RegExp(`\\b${escapeRe(c.name)}\\b`, "i");
  const byId = (id: string) => model.components.find((x) => x.id === id);

  const relationships = model.relationships
    .filter((r) => r.from === componentId || r.to === componentId)
    .map((rel) => ({ rel, other: byId(rel.from === componentId ? rel.to : rel.from), direction: (rel.from === componentId ? "out" : "in") as "out" | "in" }));
  const decisions = Object.values(state.decisions).filter((d) => d.status !== "superseded" && (d.about.includes(componentId) || nameRe.test(d.statement)));
  const kc = live.find((a) => a.type === "constraints")?.current.content as ConstraintsContent | undefined;
  const constraints = (kc?.constraints ?? []).filter((k) => nameRe.test(k.statement) || (k.value ? nameRe.test(k.value) : false));
  const connected = new Set(relationships.map((r) => r.other?.id).filter(Boolean));
  const views = live.filter((a) => {
    if (a.type !== "view") return false;
    const v = a.current.content as ViewContent;
    if (v.kind === "component") return v.focus === componentId || (v.focus ? connected.has(v.focus) : false);
    return true; // context, container and diff views draw every component
  });
  const alternatives = live
    .filter((a) => a.type === "alternatives")
    .map((artifact) => ({ artifact, candidates: (artifact.current.content as AlternativesContent).candidates.filter((k) => k.model.components.some((x) => x.id === componentId || nameRe.test(x.name))).map((k) => k.title) }))
    .filter((x) => x.candidates.length > 0);
  const mentions = live
    .filter((a) => a.type === "markdown" || a.type === "design_doc" || a.type === "mermaid" || a.type === "code" || a.type === "source" || a.type === "data_model")
    .map((artifact) => ({ artifact, count: (contentText(artifact.type, artifact.current.content).match(new RegExp(`\\b${escapeRe(c.name)}\\b`, "gi")) ?? []).length }))
    .filter((x) => x.count > 0);
  const anchored = threads(state).filter((t) => t.anchor.componentId === componentId);
  return {
    component: c,
    relationships,
    decisions,
    constraints,
    views,
    alternatives,
    mentions,
    threads: anchored,
    ifRemoved: {
      relationships: relationships.length,
      viewsAffected: views.length,
      decisionsLeftPointing: decisions.filter((d) => d.about.includes(componentId)).length,
      threadsOrphaned: anchored.filter((t) => !t.resolved).length,
    },
  };
}

/** One line per finding, for tool results and prompts. */
export function impactLines(i: Impact): string[] {
  const out: string[] = [];
  if (i.relationships.length) out.push(`${i.relationships.length} relationship${i.relationships.length === 1 ? "" : "s"}: ${i.relationships.map((r) => (r.direction === "out" ? `${r.rel.kind} ${r.other?.name ?? r.rel.to}` : `${r.other?.name ?? r.rel.from} ${r.rel.kind} it`)).join("; ")}`);
  if (i.decisions.length) out.push(`${i.decisions.length} decision${i.decisions.length === 1 ? "" : "s"}: ${i.decisions.map((d) => `${d.label} ${d.statement}`).join("; ")}`);
  if (i.constraints.length) out.push(`${i.constraints.length} constraint${i.constraints.length === 1 ? "" : "s"} name it: ${i.constraints.map((k) => k.id).join(", ")}`);
  if (i.views.length) out.push(`${i.views.length} view${i.views.length === 1 ? "" : "s"} draw it: ${i.views.map((v) => v.title).join(", ")}`);
  if (i.alternatives.length) out.push(`in ${i.alternatives.flatMap((a) => a.candidates).length} candidate architecture${i.alternatives.flatMap((a) => a.candidates).length === 1 ? "" : "s"}`);
  if (i.mentions.length) out.push(`mentioned in ${i.mentions.map((m) => `${m.artifact.title} (${m.count})`).join(", ")}`);
  if (i.threads.length) out.push(`${i.threads.length} thread${i.threads.length === 1 ? "" : "s"} on it${i.ifRemoved.threadsOrphaned ? `, ${i.ifRemoved.threadsOrphaned} open` : ""}`);
  return out.length ? out : ["nothing else refers to it"];
}
