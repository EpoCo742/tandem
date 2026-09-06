import type { Section } from "./artifacts.js";
import type { ImportedFrom } from "./library.js";
import type { DataClass, Trust } from "./flows.js";

// The architecture model: one per session, the source of truth for structure. Diagrams are
// views generated from it, so a rename in the model shows up in every view, and decisions,
// constraints and data entities can point at a component by id.

export type ComponentKind = "service" | "database" | "queue" | "external" | "ui" | "person" | "storage" | "function" | "other";
export type RelationshipKind = "calls" | "publishes" | "subscribes" | "reads" | "writes" | "uses" | "depends_on";
export type ViewKind = "context" | "container" | "component" | "diff" | "sequence" | "deployment";

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

/** Where things run: a node is a region, zone, cluster, machine or managed service, nested by parent. */
export interface DeploymentNode {
  id: string;
  name: string;
  kind: "region" | "zone" | "cluster" | "vm" | "managed" | "device" | "other";
  parent?: string; // DeploymentNode.id
  region?: string; // EU, US, ... inherited by children when unset
  trust?: Trust; // public (internet-facing), internal, restricted
  technology?: string; // "AKS", "EC2 m5.large", "RDS Postgres"
}

/** A second layer under the model: environments, nodes, and which node each component runs on per environment. */
export interface Deployment {
  environments: string[]; // "production", "staging", ...
  nodes: DeploymentNode[];
  placements: Record<string, Record<string, string>>; // environment -> component id -> node id
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
  deployment?: Deployment;
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
  environment?: string; // deployment view: which environment to draw (default the first)
  direction?: "TB" | "LR"; // flowchart direction; chosen from the shape of the model when unset
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
      return `[("${n}")]:::db`;
    case "queue":
      return `[["${n}"]]:::q`;
    case "external":
      return `[/"${n}"/]:::ext`;
    case "person":
      return `(["${n}"]):::person`;
    case "ui":
      return `("${n}"):::ui`;
    case "function":
      return `>"${n}"]:::fn`;
    default:
      return `["${n}"]:::svc`;
  }
}

// One look per kind on every diagram. Light fills with dark text read on both themes.
const KIND_CLASSDEFS = [
  "  classDef svc fill:#eaf2fb,stroke:#2f7fd4,color:#1a2128",
  "  classDef db fill:#f3eefa,stroke:#8e44ad,color:#1a2128",
  "  classDef q fill:#fff4e5,stroke:#c26b1f,color:#1a2128",
  "  classDef ext fill:#f4f6f8,stroke:#7c8893,stroke-dasharray:4 3,color:#1a2128",
  "  classDef person fill:#e8f6ee,stroke:#2e9e5b,color:#1a2128",
  "  classDef ui fill:#e6f7f9,stroke:#178e9e,color:#1a2128",
  "  classDef fn fill:#fbf3e6,stroke:#b7950b,color:#1a2128",
];

// Reading order, top to bottom: people, then what they touch, then what does the work, then
// the plumbing and the stores. Declaring nodes in this order (and pinning layers that no edge
// connects) is what makes the layout engine draw layers instead of a tangle.
const LAYER: Record<ComponentKind, number> = { person: 0, ui: 1, service: 2, function: 2, external: 3, queue: 3, database: 4, storage: 4, other: 2 };
const layerOf = (c: ModelComponent) => LAYER[c.kind] ?? 2;
const byLayer = (a: ModelComponent, b: ModelComponent) => layerOf(a) - layerOf(b) || a.name.localeCompare(b.name);

/** Top to bottom when the model has layers, left to right when it is a short chain. */
export function chooseDirection(components: ModelComponent[], relationships: ModelRelationship[], preferred?: "TB" | "LR"): "TB" | "LR" {
  if (preferred) return preferred;
  const layers = new Set(components.map(layerOf)).size;
  if (layers >= 3) return "TB";
  if (components.length <= 4) return "LR";
  // Many nodes on one or two layers: a chain reads left to right, a fan reads top to bottom.
  const fanOut = Math.max(0, ...components.map((c) => relationships.filter((r) => r.from === c.id).length));
  return fanOut >= 3 ? "TB" : "LR";
}

// Invisible edges between consecutive layers that no real edge joins, so the engine keeps them apart.
function layerBridges(components: ModelComponent[], relationships: ModelRelationship[]): string[] {
  const present = [...new Set(components.map(layerOf))].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i + 1 < present.length; i++) {
    const upper = components.filter((c) => layerOf(c) === present[i]);
    const lower = components.filter((c) => layerOf(c) === present[i + 1]);
    const joined = relationships.some((r) => (upper.some((c) => c.id === r.from) && lower.some((c) => c.id === r.to)) || (lower.some((c) => c.id === r.from) && upper.some((c) => c.id === r.to)));
    if (!joined && upper[0] && lower[0]) out.push(`  ${mermaidId(upper[0].id)} ~~~ ${mermaidId(lower[0].id)}`);
  }
  return out;
}

const edgeLabel = (r: ModelRelationship) => {
  const carries = (r.dataClasses ?? []).filter((c) => c !== "internal" && c !== "public");
  const verb = r.label ?? VERB[r.kind]; // people's own labels are kept whole; the prompt asks the AI to keep them short
  const tags = carries.map((c) => (c === "pii" ? "PII" : c)).filter((t) => !new RegExp(`\\b${t}\\b`, "i").test(verb)); // no "[PII]" after a label that already says PII
  return `${verb}${tags.length ? ` [${tags.join(", ")}]` : ""}`;
};

/**
 * Render a view of the model as Mermaid.
 * - context: each "system" boundary collapses to one node; everything outside boundaries stays.
 * - container: every component, grouped by boundary.
 * - component: the focus component and its direct neighbours.
 */
export function modelToMermaid(model: ArchModelContent, view: Pick<ViewContent, "kind" | "focus"> & { depth?: number; environment?: string; direction?: "TB" | "LR" }, opts: { violating?: ReadonlySet<string> } = {}): string {
  const comps = new Map(model.components.map((c) => [c.id, c]));
  if (model.components.length === 0) return "flowchart LR\n  empty[\"No components yet\"]";
  const lines: string[] = [`flowchart ${chooseDirection(model.components, model.relationships, view.direction)}`, ...KIND_CLASSDEFS];

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
    for (const c of [...model.components].sort(byLayer)) if (!c.boundary || !systems.some((s) => s.id === c.boundary)) lines.push(`  ${mermaidId(c.id)}${shape(c)}`);
    const seen = new Set<string>();
    for (const r of model.relationships) {
      const a = nodeFor(r.from);
      const b = nodeFor(r.to);
      if (!a || !b || a === b) continue;
      const key = `${a}|${b}|${r.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`  ${a} -->|"${quote(edgeLabel(r))}"| ${b}`);
    }
    return lines.join("\n");
  }

  if (view.kind === "diff") return diffToMermaid(model);
  if (view.kind === "sequence") return sequenceMermaid(model, view.focus, view.depth);
  if (view.kind === "deployment") return deploymentMermaid(model, view.environment, opts);

  let include = new Set(model.components.map((c) => c.id));
  if (view.kind === "component" && view.focus && comps.has(view.focus)) {
    include = new Set([view.focus]);
    for (const r of model.relationships) {
      if (r.from === view.focus) include.add(r.to);
      if (r.to === view.focus) include.add(r.from);
    }
  }
  const shown = model.components.filter((c) => include.has(c.id)).sort(byLayer);
  const byBoundary = new Map<string | undefined, ModelComponent[]>();
  for (const c of shown) {
    const list = byBoundary.get(c.boundary) ?? [];
    list.push(c);
    byBoundary.set(c.boundary, list);
  }
  // Groups in the order of their topmost member; loose components first when they sit higher.
  const groups = [...byBoundary.entries()].sort((a, b) => layerOf(a[1][0]!) - layerOf(b[1][0]!));
  for (const [bid, list] of groups) {
    const b = bid ? model.boundaries.find((x) => x.id === bid) : undefined;
    if (b) lines.push(`  subgraph b_${mermaidId(b.id)}["${quote(b.name)}"]`);
    for (const c of list) lines.push(`  ${b ? "  " : ""}${mermaidId(c.id)}${shape(c)}`);
    if (b) lines.push("  end", boundaryStyle(model, b));
  }
  const rels = model.relationships.filter((r) => include.has(r.from) && include.has(r.to));
  let edge = 0;
  const bad: number[] = [];
  for (const r of rels) {
    lines.push(`  ${mermaidId(r.from)} -->|"${quote(edgeLabel(r))}"| ${mermaidId(r.to)}`);
    if (opts.violating?.has(r.id)) bad.push(edge);
    edge += 1;
  }
  lines.push(...layerBridges(shown, rels));
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
  const lines = [`flowchart ${chooseDirection(after.components, after.relationships)}`, "  classDef added stroke:#2e9e5b,stroke-width:3px", "  classDef removed stroke:#c0392b,stroke-dasharray:5 5,color:#c0392b", "  classDef changed stroke:#d4890a,stroke-width:3px", "  classDef same stroke:#8a949e,color:#8a949e"];
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
    for (const e of [...list].sort((x, y) => byLayer(x.c, y.c))) lines.push(`  ${b ? "  " : ""}${mermaidId(e.c.id)}${shape(e.c).replace(/:::\w+$/, "")}:::${e.status}`);
    if (b) lines.push("  end", boundaryStyle({ boundaries }, b));
  }
  const addedIds = new Set(d.addedRels.map((r) => r.id));
  for (const r of model.relationships) lines.push(`  ${mermaidId(r.from)} ${addedIds.has(r.id) ? "==>" : "-->"}|"${quote(r.label ?? VERB[r.kind])}"| ${mermaidId(r.to)}`);
  for (const r of d.removedRels) if (all.has(r.from) && all.has(r.to)) lines.push(`  ${mermaidId(r.from)} -.->|"${quote(r.label ?? VERB[r.kind])}"| ${mermaidId(r.to)}`);
  return lines.join("\n");
}

/** The node a component runs on in an environment (the first environment that places it when none is given). */
export function nodeOf(model: Pick<ArchModelContent, "deployment">, componentId: string, environment?: string): DeploymentNode | undefined {
  const d = model.deployment;
  if (!d) return undefined;
  const envs = environment ? [environment] : d.environments;
  for (const env of envs) {
    const nodeId = d.placements[env]?.[componentId];
    if (nodeId) return d.nodes.find((n) => n.id === nodeId);
  }
  return undefined;
}

/** A node's region or trust, walking up its parents. */
export function nodeAttr<K extends "region" | "trust">(d: Deployment, node: DeploymentNode | undefined, key: K): DeploymentNode[K] | undefined {
  let cur = node;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    if (cur[key]) return cur[key];
    seen.add(cur.id);
    cur = cur.parent ? d.nodes.find((n) => n.id === cur!.parent) : undefined;
  }
  return undefined;
}

export function upsertDeployment(model: ArchModelContent, input: { environment?: string; nodes?: Partial<DeploymentNode>[]; placements?: { componentId: string; nodeId: string }[] }): { model: ArchModelContent; unknown: string[] } {
  const d: Deployment = model.deployment ? { environments: [...model.deployment.environments], nodes: [...model.deployment.nodes], placements: { ...model.deployment.placements } } : { environments: [], nodes: [], placements: {} };
  const unknown: string[] = [];
  for (const raw of input.nodes ?? []) {
    if (!raw.id) continue;
    const i = d.nodes.findIndex((n) => n.id === raw.id);
    const base: DeploymentNode = i >= 0 ? d.nodes[i]! : { id: raw.id, name: raw.name ?? raw.id.replace(/[-_]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()), kind: raw.kind ?? "other" };
    const next: DeploymentNode = { ...base, ...(raw.name ? { name: raw.name } : {}), ...(raw.kind ? { kind: raw.kind } : {}), ...(raw.parent ? { parent: raw.parent } : {}), ...(raw.region ? { region: raw.region } : {}), ...(raw.trust ? { trust: raw.trust } : {}), ...(raw.technology ? { technology: raw.technology } : {}) };
    if (i >= 0) d.nodes[i] = next;
    else d.nodes.push(next);
  }
  const env = input.environment ?? d.environments[0] ?? "production";
  if (!d.environments.includes(env)) d.environments.push(env);
  if (input.placements?.length) {
    const table = { ...(d.placements[env] ?? {}) };
    for (const p of input.placements) {
      if (!model.components.some((c) => c.id === p.componentId)) unknown.push(p.componentId);
      else if (!d.nodes.some((n) => n.id === p.nodeId)) unknown.push(p.nodeId);
      else table[p.componentId] = p.nodeId;
    }
    d.placements[env] = table;
  } else if (!d.placements[env]) d.placements[env] = {};
  return { model: { ...model, deployment: d }, unknown: [...new Set(unknown)] };
}

/** The deployment view: nodes nested by parent, components inside the node they run on, relationships between them. */
export function deploymentMermaid(model: ArchModelContent, environment?: string, opts: { violating?: ReadonlySet<string> } = {}): string {
  const d = model.deployment;
  if (!d || d.nodes.length === 0) return "flowchart TB\n  empty[\"No deployment recorded yet: say where things run\"]";
  const env = environment && d.environments.includes(environment) ? environment : d.environments[0]!;
  const placed = d.placements[env] ?? {};
  const lines = [`flowchart TB`, `  %% environment: ${env}`, ...KIND_CLASSDEFS];
  const children = (parent: string | undefined) => d.nodes.filter((n) => (n.parent ?? undefined) === parent);
  const compsOn = (nodeId: string) => model.components.filter((c) => placed[c.id] === nodeId);
  const emitNode = (n: DeploymentNode, indent: string) => {
    const attrs = [n.kind, n.technology, n.region ? `region ${n.region}` : "", n.trust === "public" ? "public" : ""].filter(Boolean).join(", ");
    lines.push(`${indent}subgraph d_${mermaidId(n.id)}["${quote(n.name)}${attrs ? `\n${quote(attrs)}` : ""}"]`);
    for (const c of compsOn(n.id)) lines.push(`${indent}  ${mermaidId(c.id)}${shape(c)}`);
    for (const k of children(n.id)) emitNode(k, indent + "  ");
    if (compsOn(n.id).length === 0 && children(n.id).length === 0) lines.push(`${indent}  d_${mermaidId(n.id)}_empty[" "]:::ghost`);
    lines.push(`${indent}end`);
    if (n.trust === "public") lines.push(`${indent}style d_${mermaidId(n.id)} stroke:#c0392b,stroke-dasharray:4 3`);
  };
  for (const root of children(undefined)) emitNode(root, "  ");
  const unplaced = model.components.filter((c) => !placed[c.id]);
  if (unplaced.length) {
    lines.push(`  subgraph d_unplaced["not placed in ${quote(env)}"]`);
    for (const c of unplaced) lines.push(`    ${mermaidId(c.id)}${shape(c)}`);
    lines.push("  end", "  style d_unplaced stroke:#8a949e,stroke-dasharray:2 4");
  }
  let edge = 0;
  const bad: number[] = [];
  for (const r of model.relationships) {
    lines.push(`  ${mermaidId(r.from)} -->|"${quote(r.label ?? VERB[r.kind])}"| ${mermaidId(r.to)}`);
    if (opts.violating?.has(r.id)) bad.push(edge);
    edge += 1;
  }
  for (const i of bad) lines.push(`  linkStyle ${i} stroke:#c0392b,stroke-width:3px`);
  lines.push("  classDef ghost fill:transparent,stroke:transparent,color:transparent");
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
  if (model.deployment?.nodes.length) {
    out.push("Deployment:");
    for (const env of model.deployment.environments) {
      const placed = model.deployment.placements[env] ?? {};
      const byNode = new Map<string, string[]>();
      for (const [cid, nid] of Object.entries(placed)) byNode.set(nid, [...(byNode.get(nid) ?? []), model.components.find((c) => c.id === cid)?.name ?? cid]);
      out.push(`- ${env}: ${model.deployment.nodes.map((n) => `${n.name} (${n.kind}${n.region ? `, ${n.region}` : ""}${n.trust ? `, ${n.trust}` : ""}${n.parent ? `, in ${model.deployment!.nodes.find((x) => x.id === n.parent)?.name ?? n.parent}` : ""}): ${(byNode.get(n.id) ?? []).join(", ") || "-"}`).join("; ")}`);
    }
  }
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
