import type { Section } from "./artifacts.js";

// The architecture model: one per session, the source of truth for structure. Diagrams are
// views generated from it, so a rename in the model shows up in every view, and decisions,
// constraints and data entities can point at a component by id.

export type ComponentKind = "service" | "database" | "queue" | "external" | "ui" | "person" | "storage" | "function" | "other";
export type RelationshipKind = "calls" | "publishes" | "subscribes" | "reads" | "writes" | "uses" | "depends_on";
export type ViewKind = "context" | "container" | "component";

export interface ModelComponent {
  id: string; // stable slug, e.g. "service-a"
  name: string;
  kind: ComponentKind;
  description?: string;
  technology?: string;
  boundary?: string; // ModelBoundary.id
  derivedFrom: string[];
}

export interface ModelRelationship {
  id: string; // `${from}-${kind}-${to}`
  from: string;
  to: string;
  kind: RelationshipKind;
  label?: string;
  derivedFrom: string[];
}

export interface ModelBoundary {
  id: string;
  name: string;
  kind?: "system" | "team" | "zone" | "other";
}

export interface ArchModelContent {
  components: ModelComponent[];
  relationships: ModelRelationship[];
  boundaries: ModelBoundary[];
  sections: Section[];
}

export interface ViewContent {
  kind: ViewKind;
  focus?: string; // component id for a component view
  note?: string; // caption shown under the diagram
  sections: Section[];
}

export const emptyModel = (): ArchModelContent => ({ components: [], relationships: [], boundaries: [], sections: [] });

export function slugId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "component";
}

export function relationshipId(from: string, kind: RelationshipKind, to: string): string {
  return `${from}-${kind}-${to}`;
}

const VERB: Record<RelationshipKind, string> = { calls: "calls", publishes: "publishes", subscribes: "subscribes to", reads: "reads", writes: "writes", uses: "uses", depends_on: "depends on" };

function mermaidId(id: string): string {
  return "n_" + id.replace(/[^a-zA-Z0-9_]/g, "_");
}

function quote(s: string): string {
  return s.replace(/"/g, "#quot;");
}

function shape(c: ModelComponent): string {
  const n = quote(c.technology ? `${c.name}\n${c.technology}` : c.name);
  switch (c.kind) {
    case "database":
    case "storage":
      return `[("${n}")]`;
    case "queue":
      return `[["${n}"]]`;
    case "external":
      return `[/"${n}"/]`;
    case "person":
      return `(["${n}"])`;
    case "ui":
      return `("${n}")`;
    case "function":
      return `>"${n}"]`;
    default:
      return `["${n}"]`;
  }
}

/**
 * Render a view of the model as Mermaid.
 * - context: each "system" boundary collapses to one node; everything outside boundaries stays.
 * - container: every component, grouped by boundary.
 * - component: the focus component and its direct neighbours.
 */
export function modelToMermaid(model: ArchModelContent, view: Pick<ViewContent, "kind" | "focus">): string {
  const lines: string[] = ["flowchart LR"];
  const comps = new Map(model.components.map((c) => [c.id, c]));
  if (model.components.length === 0) return "flowchart LR\n  empty[\"No components yet\"]";

  if (view.kind === "context") {
    const systems = model.boundaries.filter((b) => (b.kind ?? "system") === "system");
    const nodeFor = (id: string): string | null => {
      const c = comps.get(id);
      if (!c) return null;
      const b = c.boundary ? systems.find((s) => s.id === c.boundary) : undefined;
      return b ? `b_${mermaidId(b.id)}` : mermaidId(c.id);
    };
    for (const b of systems) {
      const members = model.components.filter((c) => c.boundary === b.id);
      if (members.length) lines.push(`  b_${mermaidId(b.id)}["${quote(b.name)}\n${members.length} component${members.length === 1 ? "" : "s"}"]`);
    }
    for (const c of model.components) if (!c.boundary || !systems.some((s) => s.id === c.boundary)) lines.push(`  ${mermaidId(c.id)}${shape(c)}`);
    const seen = new Set<string>();
    for (const r of model.relationships) {
      const a = nodeFor(r.from);
      const b = nodeFor(r.to);
      if (!a || !b || a === b) continue;
      const key = `${a}|${b}|${r.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`  ${a} -->|${quote(r.label ?? VERB[r.kind])}| ${b}`);
    }
    return lines.join("\n");
  }

  let include = new Set(model.components.map((c) => c.id));
  if (view.kind === "component" && view.focus && comps.has(view.focus)) {
    include = new Set([view.focus]);
    for (const r of model.relationships) {
      if (r.from === view.focus) include.add(r.to);
      if (r.to === view.focus) include.add(r.from);
    }
  }
  const byBoundary = new Map<string | undefined, ModelComponent[]>();
  for (const c of model.components) {
    if (!include.has(c.id)) continue;
    const list = byBoundary.get(c.boundary) ?? [];
    list.push(c);
    byBoundary.set(c.boundary, list);
  }
  for (const [bid, list] of byBoundary) {
    const b = bid ? model.boundaries.find((x) => x.id === bid) : undefined;
    if (b) lines.push(`  subgraph b_${mermaidId(b.id)}["${quote(b.name)}"]`);
    for (const c of list) lines.push(`  ${b ? "  " : ""}${mermaidId(c.id)}${shape(c)}`);
    if (b) lines.push("  end");
  }
  for (const r of model.relationships) {
    if (!include.has(r.from) || !include.has(r.to)) continue;
    lines.push(`  ${mermaidId(r.from)} -->|${quote(r.label ?? VERB[r.kind])}| ${mermaidId(r.to)}`);
  }
  if (view.kind === "component" && view.focus) lines.push(`  style ${mermaidId(view.focus)} stroke-width:3px`);
  return lines.join("\n");
}

/** Plain-text rendering of the model for prompts and exports. */
export function modelToText(model: ArchModelContent): string {
  const out: string[] = [];
  const bname = (id?: string) => (id ? model.boundaries.find((b) => b.id === id)?.name ?? id : "");
  out.push("Components:");
  for (const c of model.components) out.push(`- ${c.id}: ${c.name} (${c.kind}${c.technology ? `, ${c.technology}` : ""}${c.boundary ? `, in ${bname(c.boundary)}` : ""})${c.description ? ` — ${c.description}` : ""}`);
  if (!model.components.length) out.push("- (none)");
  out.push("Relationships:");
  for (const r of model.relationships) out.push(`- ${r.from} ${VERB[r.kind]} ${r.to}${r.label ? ` (${r.label})` : ""}`);
  if (!model.relationships.length) out.push("- (none)");
  if (model.boundaries.length) {
    out.push("Boundaries:");
    for (const b of model.boundaries) out.push(`- ${b.id}: ${b.name}${b.kind ? ` (${b.kind})` : ""}`);
  }
  return out.join("\n");
}

/** Merge components into the model by id; a component with an existing id is updated (rename, re-kind), others are added. */
export type IncomingComponent = Omit<ModelComponent, "id" | "derivedFrom"> & { id?: string; derivedFrom?: string[] };

export function upsertComponents(model: ArchModelContent, incoming: IncomingComponent[], derivedFrom: string[]): ArchModelContent {
  const components = [...model.components];
  const boundaries = [...model.boundaries];
  for (const raw of incoming) {
    const id = raw.id ?? slugId(raw.name);
    if (raw.boundary && !boundaries.some((b) => b.id === raw.boundary)) boundaries.push({ id: raw.boundary, name: raw.boundary.replace(/[-_]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()), kind: "system" });
    const i = components.findIndex((c) => c.id === id);
    const next: ModelComponent = { id, name: raw.name, kind: raw.kind, description: raw.description, technology: raw.technology, boundary: raw.boundary, derivedFrom: [...new Set([...(i >= 0 ? components[i]!.derivedFrom : []), ...(raw.derivedFrom ?? []), ...derivedFrom])] };
    if (i >= 0) components[i] = { ...components[i]!, ...stripUndefined(next) };
    else components.push(next);
  }
  return { ...model, components, boundaries };
}

export function upsertRelationships(model: ArchModelContent, incoming: { from: string; to: string; kind: RelationshipKind; label?: string }[], derivedFrom: string[]): { model: ArchModelContent; unknown: string[] } {
  const ids = new Set(model.components.map((c) => c.id));
  const relationships = [...model.relationships];
  const unknown: string[] = [];
  for (const r of incoming) {
    if (!ids.has(r.from)) unknown.push(r.from);
    if (!ids.has(r.to)) unknown.push(r.to);
    if (!ids.has(r.from) || !ids.has(r.to)) continue;
    const id = relationshipId(r.from, r.kind, r.to);
    const i = relationships.findIndex((x) => x.id === id);
    const next: ModelRelationship = { id, from: r.from, to: r.to, kind: r.kind, label: r.label, derivedFrom: [...new Set([...(i >= 0 ? relationships[i]!.derivedFrom : []), ...derivedFrom])] };
    if (i >= 0) relationships[i] = { ...relationships[i]!, ...stripUndefined(next) };
    else relationships.push(next);
  }
  return { model: { ...model, relationships }, unknown: [...new Set(unknown)] };
}

export function removeFromModel(model: ArchModelContent, componentIds: string[], relationshipIds: string[]): ArchModelContent {
  const drop = new Set(componentIds);
  const dropRel = new Set(relationshipIds);
  return {
    ...model,
    components: model.components.filter((c) => !drop.has(c.id)),
    relationships: model.relationships.filter((r) => !dropRel.has(r.id) && !drop.has(r.from) && !drop.has(r.to)),
  };
}

function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}
