import type { Section } from "./artifacts.js";
import type { ArchModelContent } from "./model.js";
import { liveArtifacts, type Artifact, type SessionState } from "./reducer.js";

// Use cases as a card: who can do what with the system, as data rather than a drawing. Actors
// point at model components where one exists (a person, an external system), and each use case
// names the components that realise it, so a change to a component can say which use cases it
// touches and the design document can list them. The diagram is generated from the data.

export interface UseCaseActor {
  id: string;
  name: string;
  componentId?: string; // the model component this actor is (a person or external system), when there is one
  kind?: "primary" | "secondary"; // secondary actors are drawn on the right, acted on rather than acting
}

export interface UseCase {
  id: string;
  name: string;
  description?: string;
  componentIds?: string[]; // model components that realise it
  derivedFrom?: string[]; // ledger event ids of the messages that stated it
}

export interface UseCaseLink {
  actor: string; // actor id
  useCase: string; // use case id
}

export interface UseCaseRelation {
  from: string; // use case id
  to: string; // use case id
  kind: "include" | "extend";
}

export interface UseCaseContent {
  system: string; // the boundary the use cases sit in, e.g. "Order platform"
  actors: UseCaseActor[];
  useCases: UseCase[];
  links: UseCaseLink[];
  relations: UseCaseRelation[];
  sections: Section[];
}

export const emptyUseCases = (system = "System"): UseCaseContent => ({ system, actors: [], useCases: [], links: [], relations: [], sections: [{ id: "usecases", derivedFrom: [] }] });

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
/** A node-safe id from a name: letters and digits, words joined by underscores. */
const ucId = (prefix: string, name: string) => `${prefix}_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "x"}`;
const norm = (s: string) => s.trim().replace(/\s+/g, " ").replace(/\.$/, "");

/** Incoming shapes: ids optional, resolved by name when omitted. */
export interface IncomingUseCases {
  system?: string;
  actors?: { id?: string; name: string; componentId?: string | null; kind?: "primary" | "secondary" }[];
  useCases?: { id?: string; name: string; description?: string; componentIds?: string[] }[];
  links?: { actor: string; useCase: string }[]; // ids or names
  relations?: { from: string; to: string; kind: "include" | "extend" }[]; // ids or names
  derivedFrom?: string[];
}

/**
 * Merge new use cases into the card: existing entries are matched by id, then by name; links and
 * relations are added once. Component ids the model does not have are dropped and reported.
 */
export function upsertUseCases(cur: UseCaseContent, input: IncomingUseCases, model?: ArchModelContent): { content: UseCaseContent; unknown: string[] } {
  const known = new Set((model?.components ?? []).map((c) => c.id));
  const unknown = new Set<string>();
  const actors = cur.actors.map((a) => ({ ...a }));
  const useCases = cur.useCases.map((u) => ({ ...u }));
  const findActor = (key: string) => actors.find((a) => a.id === key || a.name.toLowerCase() === norm(key).toLowerCase());
  const findUc = (key: string) => useCases.find((u) => u.id === key || u.name.toLowerCase() === norm(key).toLowerCase());
  for (const raw of input.actors ?? []) {
    const name = cap(norm(raw.name));
    const hit = (raw.id && actors.find((a) => a.id === raw.id)) || findActor(name);
    let componentId = raw.componentId ?? undefined;
    if (componentId && model && !known.has(componentId)) {
      unknown.add(componentId);
      componentId = undefined;
    }
    if (hit) {
      hit.name = name;
      if (componentId) hit.componentId = componentId;
      if (raw.kind) hit.kind = raw.kind;
    } else actors.push({ id: raw.id ?? ucId("a", name), name, ...(componentId ? { componentId } : {}), ...(raw.kind ? { kind: raw.kind } : {}) });
  }
  for (const raw of input.useCases ?? []) {
    const name = cap(norm(raw.name));
    const hit = (raw.id && useCases.find((u) => u.id === raw.id)) || findUc(name);
    const comps = (raw.componentIds ?? []).filter((id) => {
      if (!model || known.has(id)) return true;
      unknown.add(id);
      return false;
    });
    const derived = [...new Set([...(hit?.derivedFrom ?? []), ...(input.derivedFrom ?? [])])];
    if (hit) {
      hit.name = name;
      if (raw.description) hit.description = raw.description;
      if (comps.length) hit.componentIds = [...new Set([...(hit.componentIds ?? []), ...comps])];
      hit.derivedFrom = derived;
    } else useCases.push({ id: raw.id ?? ucId("uc", name), name, ...(raw.description ? { description: raw.description } : {}), ...(comps.length ? { componentIds: comps } : {}), ...(derived.length ? { derivedFrom: derived } : {}) });
  }
  const links = [...cur.links];
  for (const l of input.links ?? []) {
    const a = findActor(l.actor);
    const u = findUc(l.useCase);
    if (a && u && !links.some((x) => x.actor === a.id && x.useCase === u.id)) links.push({ actor: a.id, useCase: u.id });
  }
  const relations = [...cur.relations];
  for (const r of input.relations ?? []) {
    const f = findUc(r.from);
    const t = findUc(r.to);
    if (f && t && f.id !== t.id && !relations.some((x) => x.from === f.id && x.to === t.id && x.kind === r.kind)) relations.push({ from: f.id, to: t.id, kind: r.kind });
  }
  const system = input.system ? norm(input.system) : cur.system;
  const derivedAll = [...new Set([...(cur.sections[0]?.derivedFrom ?? []), ...(input.derivedFrom ?? [])])];
  return { content: { system, actors, useCases, links, relations, sections: [{ id: "usecases", derivedFrom: derivedAll }] }, unknown: [...unknown] };
}

const quote = (s: string) => s.replace(/"/g, "#quot;");

/** The diagram, generated: actors left, the system as a box of use cases, secondary actors right. */
export function useCasesToMermaid(c: UseCaseContent): string {
  const out: string[] = ["flowchart LR"];
  const primary = c.actors.filter((a) => a.kind !== "secondary");
  const secondary = c.actors.filter((a) => a.kind === "secondary");
  for (const a of primary) out.push(`  ${a.id}["${quote(a.name)}"]:::actor`);
  out.push(`  subgraph sys["${quote(c.system)}"]`);
  for (const u of c.useCases) out.push(`    ${u.id}(["${quote(u.name)}"]):::usecase`);
  out.push("  end");
  for (const a of secondary) out.push(`  ${a.id}["${quote(a.name)}"]:::actor`);
  for (const l of c.links) {
    const a = c.actors.find((x) => x.id === l.actor);
    if (!a) continue;
    out.push(a.kind === "secondary" ? `  ${l.useCase} --> ${l.actor}` : `  ${l.actor} --> ${l.useCase}`);
  }
  for (const r of c.relations) out.push(`  ${r.from} -.->|${r.kind}| ${r.to}`);
  out.push("  classDef actor fill:#e8f6ee,stroke:#2e9e5b,color:#1a2128", "  classDef usecase fill:#eaf2fb,stroke:#2f7fd4,color:#1a2128", "  style sys fill:#f4f6f8,stroke:#7c8893");
  return out.join("\n");
}


/** The session's use case card, if any. */
export function useCasesOf(state: SessionState): { artifact: Artifact; content: UseCaseContent } | null {
  const a = liveArtifacts(state).find((x) => x.type === "use_case");
  return a ? { artifact: a, content: a.current.content as UseCaseContent } : null;
}

/** Use cases a component realises or acts in, for impact. */
export function useCasesFor(state: SessionState, componentId: string): UseCase[] {
  const uc = useCasesOf(state);
  if (!uc) return [];
  const actorIds = new Set(uc.content.actors.filter((a) => a.componentId === componentId).map((a) => a.id));
  return uc.content.useCases.filter((u) => (u.componentIds ?? []).includes(componentId) || uc.content.links.some((l) => l.useCase === u.id && actorIds.has(l.actor)));
}

// ---- import from PlantUML ------------------------------------------------------------------

export interface ParsedUseCases {
  system: string;
  actors: { id: string; name: string; kind?: "primary" | "secondary" }[];
  useCases: { id: string; name: string }[];
  links: { actor: string; useCase: string }[];
  relations: { from: string; to: string; kind: "include" | "extend" }[];
  notes: string[];
}

/** True when the PlantUML is a use case diagram rather than a component diagram. */
export function isUseCaseDiagram(text: string): boolean {
  return /^\s*usecase\b/m.test(text) || /^\s*\([^()\n]+\)(?:\s+as\s+\S+)?\s*$/m.test(text) || (/^\s*actor\b/m.test(text) && /-+>\s*\(/.test(text)) || /:\s*<?<?(include|extend)s?>?>?\s*$/m.test(text);
}

/**
 * actor "Customer" as cust / actor Customer / usecase "Place order" as UC1 / (Place order) as UC1 /
 * cust --> UC1 / cust --> (Place order) / UC2 .> UC1 : include / UC2 ..> UC1 : <<extend>> /
 * rectangle "Order platform" { ... } for the system boundary.
 */
export function parsePlantUmlUseCases(text: string): ParsedUseCases {
  const out: ParsedUseCases = { system: "System", actors: [], useCases: [], links: [], relations: [], notes: [] };
  const alias = new Map<string, { kind: "actor" | "uc"; id: string }>();
  const addActor = (name: string, key?: string) => {
    const id = ucId("a", name);
    if (!out.actors.some((a) => a.id === id)) out.actors.push({ id, name });
    alias.set(name.toLowerCase(), { kind: "actor", id });
    if (key) alias.set(key.toLowerCase(), { kind: "actor", id });
    return id;
  };
  const addUc = (name: string, key?: string) => {
    const id = ucId("uc", name);
    if (!out.useCases.some((u) => u.id === id)) out.useCases.push({ id, name });
    alias.set(name.toLowerCase(), { kind: "uc", id });
    if (key) alias.set(key.toLowerCase(), { kind: "uc", id });
    return id;
  };
  const resolve = (token: string): { kind: "actor" | "uc"; id: string } | null => {
    const t = token.trim();
    const paren = t.match(/^\((.+)\)$/);
    if (paren) return { kind: "uc", id: addUc(paren[1]!.trim()) };
    const colon = t.match(/^:(.+):$/); // :Customer: is PlantUML's inline actor form
    if (colon) return { kind: "actor", id: addActor(colon[1]!.trim()) };
    const quoted = t.match(/^"(.+)"$/);
    const key = (quoted ? quoted[1]! : t).toLowerCase();
    return alias.get(key) ?? null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/'.*$/, "").trim();
    if (!line || /^@(start|end)uml/.test(line) || /^(skinparam|title|left to right|top to bottom|!|hide|scale|legend|note)\b/i.test(line)) continue;
    const boundary = line.match(/^(rectangle|package)\s+"?([^"{]+?)"?(?:\s+as\s+\S+)?\s*\{$/i);
    if (boundary) {
      out.system = boundary[2]!.trim();
      continue;
    }
    if (line === "}") continue;
    const actor = line.match(/^actor\s+(?:"([^"]+)"|(\S+))(?:\s+as\s+(\S+))?/i);
    if (actor) {
      addActor((actor[1] ?? actor[2]!).trim(), actor[3]);
      continue;
    }
    const idAsName = line.match(/^usecase\s+(\S+)\s+as\s+"([^"]+)"/i); // usecase UC3 as "Refund an order"
    if (idAsName) {
      addUc(idAsName[2]!.trim(), idAsName[1]);
      continue;
    }
    const uc = line.match(/^usecase\s+(?:"([^"]+)"|(\S+))(?:\s+as\s+(\S+))?/i); // usecase "Name" as ID, usecase Name
    if (uc) {
      addUc((uc[1] ?? uc[2] ?? "").trim(), uc[3]);
      continue;
    }
    const parenDecl = line.match(/^\(([^()]+)\)(?:\s+as\s+(\S+))?$/);
    if (parenDecl) {
      addUc(parenDecl[1]!.trim(), parenDecl[2]);
      continue;
    }
    const edge = line.match(/^(.+?)\s*(<?[-.]+(?:>|\|>)?)\s*(.+?)(?:\s*:\s*(.+))?$/);
    if (edge) {
      const [, left, arrow, right, label] = edge;
      const reversed = arrow!.startsWith("<");
      const a = resolve(reversed ? right! : left!);
      const b = resolve(reversed ? left! : right!);
      const l = (label ?? "").toLowerCase();
      if (a && b) {
        if (a.kind === "actor" && b.kind === "uc") {
          if (!out.links.some((x) => x.actor === a.id && x.useCase === b.id)) out.links.push({ actor: a.id, useCase: b.id });
          continue;
        }
        if (a.kind === "uc" && b.kind === "actor") {
          if (!out.links.some((x) => x.actor === b.id && x.useCase === a.id)) out.links.push({ actor: b.id, useCase: a.id });
          const act = out.actors.find((x) => x.id === b.id);
          if (act) act.kind = "secondary";
          continue;
        }
        if (a.kind === "uc" && b.kind === "uc") {
          const kind: "include" | "extend" = /extend/.test(l) ? "extend" : "include";
          if (!out.relations.some((x) => x.from === a.id && x.to === b.id)) out.relations.push({ from: a.id, to: b.id, kind });
          continue;
        }
      }
    }
    out.notes.push(`Skipped: ${line}`);
  }
  if (out.useCases.length === 0) out.notes.push("No use cases found; is this a use case diagram?");
  return out;
}
