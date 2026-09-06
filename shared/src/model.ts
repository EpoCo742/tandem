import type { Section } from "./artifacts.js";
import type { ImportedFrom } from "./library.js";
import type { DataClass, Trust } from "./flows.js";

// The architecture model: one per session, the source of truth for structure. Diagrams are
// views generated from it, so a rename in the model shows up in every view, and decisions,
// constraints and data entities can point at a component by id.

export type ComponentKind = "service" | "database" | "queue" | "external" | "ui" | "person" | "storage" | "function" | "other";
export type RelationshipKind = "calls" | "publishes" | "subscribes" | "reads" | "writes" | "uses" | "depends_on";
export type ViewKind = "context" | "container" | "component" | "diff" | "sequence";

export interface ModelComponent {
  id: string; // stable slug, e.g. "service-a"
  name: string;
  kind: ComponentKind;
  description?: string;
  technology?: string;
  boundary?: string; // ModelBoundary.id
  importedFrom?: ImportedFrom; // copied in from another session through the library
  derivedFrom: string[];
}

export interface ModelRelationship {
  id: string; // `${from}-${kind}-${to}`
  from: string;
  to: string;
  kind: RelationshipKind;
  label?: string;
  dataClasses?: DataClass[]; // what the flow carries; residency and security constraints are checked against this
  derivedFrom: string[];
}

export interface ModelBoundary {
  id: string;
  name: string;
  kind?: "system" | "team" | "zone" | "other";
  color?: string; // hex; chosen from the palette by position when unset, so every view agrees
  region?: string; // where it runs: EU, US, UK, ... (free text is canonicalised for checks)
  trust?: Trust; // public (internet-facing), internal, restricted
}

/** Boundary tints, distinct from the participant palette and legible on both themes. */
export const BOUNDARY_PALETTE = ["#2f7fd4", "#c26b1f", "#2e9e5b", "#8e44ad", "#c0392b", "#16a085", "#7f8c8d", "#b7950b"];

/** The colour a boundary is drawn with: its own, or the palette entry for its position in the model. */
export function boundaryColor(model: Pick<ArchModelContent, "boundaries">, boundaryId: string): string {
  const i = model.boundaries.findIndex((b) => b.id === boundaryId);
  const b = model.boundaries[i];
  return b?.color ?? BOUNDARY_PALETTE[(i < 0 ? 0 : i) % BOUNDARY_PALETTE.length]!;
}

function boundaryStyle(model: Pick<ArchModelContent, "boundaries">, b: ModelBoundary): string {
  const c = boundaryColor(model, b.id);
  return `  style b_${mermaidId(b.id)} fill:${c}1a,stroke:${c},stroke-width:1.5px`;
}

/** The architecture as it exists, captured from code or a manifest; the model itself is the target state. */
export interface AsIsSnapshot {
  source: string; // "repo:owner/name@ref", "upload:docker-compose.yml"
  capturedAt: string;
  components: ModelComponent[];
  relationships: ModelRelationship[];
  boundaries: ModelBoundary[];
  notes?: string[];
}

export interface ArchModelContent {
  components: ModelComponent[];
  relationships: ModelRelationship[];
  boundaries: ModelBoundary[];
  sections: Section[];
  asIs?: AsIsSnapshot;
}

export interface ModelDiff {
  added: ModelComponent[];
  removed: ModelComponent[];
  changed: { before: ModelComponent; after: ModelComponent }[];
  same: ModelComponent[];
  addedRels: ModelRelationship[];
  removedRels: ModelRelationship[];
}

/** The structural part of a model that a diff compares: an as-is snapshot or an earlier version both fit. */
export type ModelShape = Pick<ArchModelContent, "components" | "relationships" | "boundaries">;

/** `after` against `before`, by component id. */
export function diffModels(before: ModelShape, after: ModelShape): ModelDiff {
  const was = new Map(before.components.map((c) => [c.id, c]));
  const now = new Map(after.components.map((c) => [c.id, c]));
  const differs = (a: ModelComponent, b: ModelComponent) => a.name !== b.name || a.kind !== b.kind || (a.technology ?? "") !== (b.technology ?? "") || (a.boundary ?? "") !== (b.boundary ?? "");
  const added = after.components.filter((c) => !was.has(c.id));
  const removed = before.components.filter((c) => !now.has(c.id));
  const changed = after.components.filter((c) => was.has(c.id) && differs(was.get(c.id)!, c)).map((c) => ({ before: was.get(c.id)!, after: c }));
  const same = after.components.filter((c) => was.has(c.id) && !differs(was.get(c.id)!, c));
  const wasRel = new Set(before.relationships.map((r) => r.id));
  const nowRel = new Set(after.relationships.map((r) => r.id));
  return { added, removed, changed, same, addedRels: after.relationships.filter((r) => !wasRel.has(r.id)), removedRels: before.relationships.filter((r) => !nowRel.has(r.id)) };
}

/** To-be (the model) against as-is (the snapshot), by component id. */
export function modelDiff(model: ArchModelContent): ModelDiff | null {
  if (!model.asIs) return null;
  return diffModels(model.asIs, model);
}

export interface ViewContent {
  kind: ViewKind;
  focus?: string; // component id for a component view, or the starting component of a sequence view
  depth?: number; // sequence view: how many hops to follow from the start (default 3)
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

// Inside a quoted Mermaid label, a double quote is written as #quot;. Every label the generator
// emits is quoted (nodes, subgraphs and edges alike): unquoted edge text breaks the parser on
// parentheses, pipes and brackets, and one bad edge hides the whole diagram.
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
export function modelToMermaid(model: ArchModelContent, view: Pick<ViewContent, "kind" | "focus"> & { depth?: number }, opts: { violating?: ReadonlySet<string> } = {}): string {
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
      if (members.length) lines.push(`  b_${mermaidId(b.id)}["${quote(b.name)}\n${members.length} component${members.length === 1 ? "" : "s"}"]`, boundaryStyle(model, b));
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
      lines.push(`  ${a} -->|"${quote(r.label ?? VERB[r.kind])}"| ${b}`);
    }
    return lines.join("\n");
  }

  if (view.kind === "diff") return diffToMermaid(model);
  if (view.kind === "sequence") return sequenceMermaid(model, view.focus, view.depth);

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
    if (b) lines.push("  end", boundaryStyle(model, b));
  }
  let edge = 0;
  const bad: number[] = [];
  for (const r of model.relationships) {
    if (!include.has(r.from) || !include.has(r.to)) continue;
    const carries = (r.dataClasses ?? []).filter((c) => c !== "internal" && c !== "public");
    const label = `${r.label ?? VERB[r.kind]}${carries.length ? ` [${carries.map((c) => (c === "pii" ? "PII" : c)).join(", ")}]` : ""}`;
    lines.push(`  ${mermaidId(r.from)} -->|"${quote(label)}"| ${mermaidId(r.to)}`);
    if (opts.violating?.has(r.id)) bad.push(edge);
    edge += 1;
  }
  for (const i of bad) lines.push(`  linkStyle ${i} stroke:#c0392b,stroke-width:3px`);
  if (view.kind === "component" && view.focus) lines.push(`  style ${mermaidId(view.focus)} stroke-width:3px`);
  return lines.join("\n");
}

// As-is and to-be on one drawing: added components and edges stand out, removed ones are dashed,
// changed ones are marked, and what stayed the same is muted.
function diffToMermaid(model: ArchModelContent): string {
  if (!model.asIs) return modelToMermaid({ ...model, asIs: undefined }, { kind: "container" }) + "\n  %% no as-is baseline captured yet";
  return compareMermaid(model.asIs, model);
}

/** A diagram of `after` against `before`: added, removed, changed and unchanged, like the as-is view but between any two moments. */
export function compareMermaid(before: ModelShape, after: ModelShape): string {
  const d = diffModels(before, after);
  const model = after;
  const lines = ["flowchart LR", "  classDef added stroke:#2e9e5b,stroke-width:3px", "  classDef removed stroke:#c0392b,stroke-dasharray:5 5,color:#c0392b", "  classDef changed stroke:#d4890a,stroke-width:3px", "  classDef same stroke:#8a949e,color:#8a949e"];
  const all = new Map<string, { c: ModelComponent; status: "added" | "removed" | "changed" | "same" }>();
  for (const c of d.added) all.set(c.id, { c, status: "added" });
  for (const c of d.removed) all.set(c.id, { c, status: "removed" });
  for (const x of d.changed) all.set(x.after.id, { c: x.after, status: "changed" });
  for (const c of d.same) all.set(c.id, { c, status: "same" });
  const boundaries = [...model.boundaries, ...before.boundaries.filter((b) => !model.boundaries.some((x) => x.id === b.id))];
  const byBoundary = new Map<string | undefined, { c: ModelComponent; status: string }[]>();
  for (const e of all.values()) byBoundary.set(e.c.boundary, [...(byBoundary.get(e.c.boundary) ?? []), e]);
  for (const [bid, list] of byBoundary) {
    const b = bid ? boundaries.find((x) => x.id === bid) : undefined;
    if (b) lines.push(`  subgraph b_${mermaidId(b.id)}["${quote(b.name)}"]`);
    for (const e of list) lines.push(`  ${b ? "  " : ""}${mermaidId(e.c.id)}${shape(e.c)}:::${e.status}`);
    if (b) lines.push("  end", boundaryStyle({ boundaries }, b));
  }
  const addedIds = new Set(d.addedRels.map((r) => r.id));
  for (const r of model.relationships) lines.push(`  ${mermaidId(r.from)} ${addedIds.has(r.id) ? "==>" : "-->"}|"${quote(r.label ?? VERB[r.kind])}"| ${mermaidId(r.to)}`);
  for (const r of d.removedRels) if (all.has(r.from) && all.has(r.to)) lines.push(`  ${mermaidId(r.from)} -.->|"${quote(r.label ?? VERB[r.kind])}"| ${mermaidId(r.to)}`);
  return lines.join("\n");
}

/** The relationships reachable from a start component by following outgoing edges, breadth first, in the order a request would take. */
export function pathFrom(model: Pick<ArchModelContent, "components" | "relationships">, start: string, depth = 3): ModelRelationship[] {
  const out: ModelRelationship[] = [];
  const seenRel = new Set<string>();
  let frontier = [start];
  const visited = new Set<string>([start]);
  for (let hop = 0; hop < depth && frontier.length; hop++) {
    const next: string[] = [];
    for (const from of frontier) {
      for (const r of model.relationships) {
        if (r.from !== from || seenRel.has(r.id)) continue;
        seenRel.add(r.id);
        out.push(r);
        if (!visited.has(r.to)) {
          visited.add(r.to);
          next.push(r.to);
        }
      }
    }
    frontier = next;
  }
  return out;
}

/** A sequence diagram generated from the model: participants are the components on the path, messages follow the relationships. */
export function sequenceMermaid(model: Pick<ArchModelContent, "components" | "relationships">, start: string | undefined, depth = 3): string {
  const first = start && model.components.some((c) => c.id === start) ? start : model.components.find((c) => model.relationships.some((r) => r.from === c.id))?.id;
  if (!first) return "sequenceDiagram\n  Note over nobody: no relationships in the model yet";
  const path = pathFrom(model, first, depth);
  const name = (id: string) => model.components.find((c) => c.id === id)?.name ?? id;
  const ids: string[] = [first];
  for (const r of path) for (const id of [r.from, r.to]) if (!ids.includes(id)) ids.push(id);
  const lines = ["sequenceDiagram"];
  for (const id of ids) lines.push(`  participant ${mermaidId(id)} as ${quote(name(id))}`);
  if (path.length === 0) lines.push(`  Note over ${mermaidId(first)}: no outgoing relationships`);
  for (const r of path) {
    const arrow = r.kind === "publishes" || r.kind === "writes" ? "-)" : r.kind === "subscribes" || r.kind === "reads" ? "-->>" : "->>";
    const carries = (r.dataClasses ?? []).filter((c) => c !== "internal" && c !== "public");
    lines.push(`  ${mermaidId(r.from)}${arrow}${mermaidId(r.to)}: ${quote(r.label ?? VERB[r.kind])}${carries.length ? ` [${carries.map((c) => (c === "pii" ? "PII" : c)).join(", ")}]` : ""}`);
  }
  return lines.join("\n");
}

/** Plain-text rendering of the model for prompts and exports. */
export function modelToText(model: ArchModelContent): string {
  const out: string[] = [];
  const d = modelDiff(model);
  if (model.asIs && d) {
    const names = (cs: ModelComponent[]) => (cs.length ? ` (${cs.map((c) => c.name).join(", ")})` : "");
    out.push(`As-is baseline: ${model.asIs.source}, captured ${model.asIs.capturedAt}. To-be against as-is: ${d.added.length} added${names(d.added)}, ${d.removed.length} removed${names(d.removed)}, ${d.changed.length} changed${names(d.changed.map((x) => x.after))}, ${d.same.length} unchanged.`);
  }
  const bname = (id?: string) => (id ? model.boundaries.find((b) => b.id === id)?.name ?? id : "");
  out.push("Components:");
  for (const c of model.components) out.push(`- ${c.id}: ${c.name} (${c.kind}${c.technology ? `, ${c.technology}` : ""}${c.boundary ? `, in ${bname(c.boundary)}` : ""})${c.description ? ` — ${c.description}` : ""}`);
  if (!model.components.length) out.push("- (none)");
  out.push("Relationships:");
  for (const r of model.relationships) out.push(`- ${r.from} ${VERB[r.kind]} ${r.to}${r.label ? ` (${r.label})` : ""}${r.dataClasses?.length ? ` [carries: ${r.dataClasses.join(", ")}]` : ""}`);
  if (!model.relationships.length) out.push("- (none)");
  if (model.boundaries.length) {
    out.push("Boundaries:");
    for (const b of model.boundaries) out.push(`- ${b.id}: ${b.name}${b.kind ? ` (${b.kind})` : ""}${b.region ? `, region ${b.region}` : ""}${b.trust ? `, trust ${b.trust}` : ""}`);
  }
  return out.join("\n");
}

/** Merge components into the model by id; a component with an existing id is updated (rename, re-kind), others are added. */
export type IncomingComponent = Omit<ModelComponent, "id" | "derivedFrom"> & { id?: string; derivedFrom?: string[] };

export function upsertBoundaries(model: ArchModelContent, incoming: { id: string; name?: string; kind?: ModelBoundary["kind"]; color?: string; region?: string; trust?: Trust }[]): ArchModelContent {
  const boundaries = [...model.boundaries];
  for (const raw of incoming) {
    const i = boundaries.findIndex((b) => b.id === raw.id);
    const base: ModelBoundary = i >= 0 ? boundaries[i]! : { id: raw.id, name: raw.name ?? raw.id.replace(/[-_]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()), kind: raw.kind ?? "system" };
    const next: ModelBoundary = { ...base, ...(raw.name ? { name: raw.name } : {}), ...(raw.kind ? { kind: raw.kind } : {}), ...(raw.color ? { color: raw.color } : {}), ...(raw.region ? { region: raw.region } : {}), ...(raw.trust ? { trust: raw.trust } : {}) };
    if (i >= 0) boundaries[i] = next;
    else boundaries.push(next);
  }
  return { ...model, boundaries };
}

export function upsertComponents(model: ArchModelContent, incoming: IncomingComponent[], derivedFrom: string[]): ArchModelContent {
  const components = [...model.components];
  const boundaries = [...model.boundaries];
  for (const raw of incoming) {
    const id = raw.id ?? slugId(raw.name);
    if (raw.boundary && !boundaries.some((b) => b.id === raw.boundary)) boundaries.push({ id: raw.boundary, name: raw.boundary.replace(/[-_]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()), kind: "system" });
    const i = components.findIndex((c) => c.id === id);
    const next: ModelComponent = { id, name: raw.name, kind: raw.kind, description: raw.description, technology: raw.technology, boundary: raw.boundary, importedFrom: raw.importedFrom, derivedFrom: [...new Set([...(i >= 0 ? components[i]!.derivedFrom : []), ...(raw.derivedFrom ?? []), ...derivedFrom])] };
    if (i >= 0) components[i] = { ...components[i]!, ...stripUndefined(next) };
    else components.push(next);
  }
  return { ...model, components, boundaries };
}

export function upsertRelationships(model: ArchModelContent, incoming: { from: string; to: string; kind: RelationshipKind; label?: string; dataClasses?: DataClass[] }[], derivedFrom: string[]): { model: ArchModelContent; unknown: string[] } {
  const ids = new Set(model.components.map((c) => c.id));
  const relationships = [...model.relationships];
  const unknown: string[] = [];
  for (const r of incoming) {
    if (!ids.has(r.from)) unknown.push(r.from);
    if (!ids.has(r.to)) unknown.push(r.to);
    if (!ids.has(r.from) || !ids.has(r.to)) continue;
    const id = relationshipId(r.from, r.kind, r.to);
    const i = relationships.findIndex((x) => x.id === id);
    const next: ModelRelationship = { id, from: r.from, to: r.to, kind: r.kind, label: r.label, dataClasses: r.dataClasses, derivedFrom: [...new Set([...(i >= 0 ? relationships[i]!.derivedFrom : []), ...derivedFrom])] };
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
