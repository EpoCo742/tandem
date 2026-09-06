import type { ArchModelContent, ComponentKind, IncomingComponent, ModelBoundary, RelationshipKind } from "./model.js";
import { slugId } from "./model.js";

// Import from the notations people already have (a Mermaid flowchart, Structurizr DSL, a
// PlantUML component diagram) into the model's shape, and export the model as Structurizr DSL
// so it can leave. Parsers are forgiving: what they cannot map goes into `notes` for a person.

export type Notation = "mermaid" | "structurizr" | "plantuml";

export interface ParsedModel {
  notation: Notation;
  components: IncomingComponent[];
  relationships: { from: string; to: string; kind: RelationshipKind; label?: string }[];
  boundaries: { id: string; name: string; kind?: ModelBoundary["kind"] }[];
  notes: string[];
}

export function detectNotation(text: string): Notation | null {
  const t = text.trim();
  if (/^\s*(flowchart|graph)\s+(LR|TB|TD|RL|BT)\b/m.test(t)) return "mermaid";
  if (/^\s*(workspace|model)\s*\{/m.test(t) || /\b(softwareSystem|container)\s+"/.test(t)) return "structurizr";
  if (/^\s*@startuml/m.test(t) || /^\s*(component|database|queue|actor|node|cloud|package|rectangle)\s+"/m.test(t) || /\[[^\]]+\]\s*(-+>|\.+>)/.test(t)) return "plantuml";
  if (/^\s*(flowchart|graph)\s+(LR|TB|TD|RL|BT)/m.test(t) || /-->|-\.->|==>/.test(t)) return "mermaid";
  return null;
}

export function kindFromLabel(label: string, hint?: ComponentKind): ComponentKind {
  const l = label.toLowerCase();
  if (/\b(postgres|mysql|mariadb|mongo|db|database|redis|cache|store|storage|warehouse|s3|blob|bucket|elastic|dynamo|cosmos|sqlite|oracle)\b/.test(l)) return "database";
  if (/\b(kafka|queue|bus|topic|sqs|sns|rabbit|pubsub|pub\/sub|eventhub|stream)\b/.test(l)) return "queue";
  if (/\b(user|customer|person|actor|admin|operator|analyst|clerk)\b/.test(l)) return "person";
  if (/\b(ui|web app|webapp|frontend|front-end|browser|mobile|spa|portal|dashboard)\b/.test(l)) return "ui";
  if (/\b(lambda|function|cron|job|worker)\b/.test(l)) return "function";
  if (/\b(external|third[- ]party|gateway|provider|saas|stripe|twilio|salesforce|mainframe|legacy)\b/.test(l)) return "external";
  return hint ?? "service";
}

export function relKindFromLabel(label: string | undefined, targetKind?: ComponentKind): RelationshipKind {
  const l = (label ?? "").toLowerCase();
  if (/publish|emit|produce|send|event/.test(l)) return "publishes";
  if (/subscribe|consume|listen|receive/.test(l)) return "subscribes";
  if (/read|query|fetch|get|load/.test(l)) return "reads";
  if (/write|store|save|insert|persist|update/.test(l)) return "writes";
  if (/depend|require/.test(l)) return "depends_on";
  if (/use/.test(l)) return "uses";
  if (targetKind === "database") return "uses";
  if (targetKind === "queue") return "publishes";
  return "calls";
}

const unquote = (s: string) => s.trim().replace(/^"|"$/g, "").replace(/^'|'$/g, "").replace(/<br\s*\/?>/gi, " ").replace(/\\n/g, " ").trim();

// ---- Mermaid flowchart ---------------------------------------------------------------------

// A node token: id followed by an optional shape with a label.
const MERMAID_NODE = /^([A-Za-z0-9_.-]+)\s*(?:(\[\(|\(\(|\(\[|\[\[|\{\{|\[|\(|\{|>)\s*(.+?)\s*(\)\]|\)\)|\]\)|\]\]|\}\}|\]|\)|\})?)?$/;

function mermaidNode(token: string): { id: string; label: string; shape: string } | null {
  const m = token.trim().match(MERMAID_NODE);
  if (!m) return null;
  const id = m[1]!;
  const open = m[2] ?? "";
  const label = m[3] ? unquote(m[3]) : id;
  return { id, label, shape: open };
}

function mermaidKind(shape: string, label: string): ComponentKind {
  const hint: ComponentKind | undefined = shape === "[(" ? "database" : shape === "((" ? "person" : shape === "{{" ? "queue" : shape === "([" ? "ui" : shape === "[[" ? "service" : undefined;
  return kindFromLabel(label, hint);
}

export function parseMermaidFlowchart(text: string): ParsedModel {
  const out: ParsedModel = { notation: "mermaid", components: [], relationships: [], boundaries: [], notes: [] };
  const comps = new Map<string, IncomingComponent>();
  const stack: string[] = [];
  const ensure = (token: string): string | null => {
    const n = mermaidNode(token);
    if (!n) return null;
    const id = slugId(n.id);
    if (!comps.has(id)) comps.set(id, { id, name: n.label, kind: mermaidKind(n.shape, n.label), ...(stack.length ? { boundary: stack[stack.length - 1] } : {}) });
    else if (n.shape && comps.get(id)!.name === n.id) comps.get(id)!.name = n.label;
    return id;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/%%.*$/, "").trim().replace(/;$/, "");
    if (!line || /^(flowchart|graph)\b/i.test(line) || /^(classDef|class|style|linkStyle|click|direction)\b/.test(line)) continue;
    const sg = line.match(/^subgraph\s+(.+)$/);
    if (sg) {
      const m = sg[1]!.trim().match(/^([A-Za-z0-9_.-]+)\s*\[\s*(.+?)\s*\]$/) ?? sg[1]!.trim().match(/^"?(.+?)"?$/);
      const id = slugId(m![1]!);
      const name = unquote(m![2] ?? m![1]!);
      if (!out.boundaries.some((b) => b.id === id)) out.boundaries.push({ id, name, kind: "system" });
      stack.push(id);
      continue;
    }
    if (line === "end") {
      stack.pop();
      continue;
    }
    // Edges: split on arrow tokens, keep labels in |...| or "-- text -->".
    const parts = line.split(/\s*(-->|-\.->|==>|--o|--x|-\.-|---|===)\s*/);
    if (parts.length >= 3) {
      let prev: string[] = [];
      for (let i = 0; i < parts.length; i += 2) {
        let seg = parts[i]!;
        let label: string | undefined;
        const lab = seg.match(/^\|(.+?)\|\s*(.*)$/);
        if (lab) {
          label = unquote(lab[1]!);
          seg = lab[2]!;
        }
        const text2 = seg.match(/^(.*?)\s*--\s*(.+?)\s*$/); // "a -- label" before "-->"
        if (text2 && i + 1 < parts.length) {
          seg = text2[1]!;
          label = unquote(text2[2]!);
        }
        const ids = seg.split(/\s*&\s*/).map(ensure).filter((x): x is string => Boolean(x));
        if (i > 0) {
          const arrow = parts[i - 1]!;
          const edgeLabel = label;
          for (const a of prev) for (const b of ids) {
            const kind = relKindFromLabel(edgeLabel, comps.get(b)?.kind);
            out.relationships.push({ from: a, to: b, kind: arrow === "-.->" && !edgeLabel ? "depends_on" : kind, ...(edgeLabel ? { label: edgeLabel } : {}) });
          }
          label = undefined;
        }
        prev = ids;
      }
      continue;
    }
    if (!ensure(line)) out.notes.push(`Skipped: ${line}`);
  }
  out.components = [...comps.values()];
  if (out.components.length === 0) out.notes.push("No nodes found; is this a flowchart?");
  return out;
}

// ---- Structurizr DSL -----------------------------------------------------------------------

export function parseStructurizr(text: string): ParsedModel {
  const out: ParsedModel = { notation: "structurizr", components: [], relationships: [], boundaries: [], notes: [] };
  const lines = text.split(/\r?\n/);
  const stack: { id: string; kind: "system" | "group" | "container" | "other" }[] = [];
  const systemsWithChildren = new Set<string>();
  const declared = new Map<string, { name: string; kind: ComponentKind; technology?: string; description?: string; parent?: string; level: "system" | "container" | "component" | "person" }>();
  let inModel = false;
  let depth = 0;
  for (const raw of lines) {
    const line = raw.replace(/(^|\s)(\/\/|#).*$/, "").trim();
    if (!line) continue;
    if (/^model\s*\{/.test(line)) { inModel = true; depth = 0; continue; }
    if (/^views\s*\{/.test(line)) { inModel = false; continue; }
    if (!inModel) continue;
    const decl = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(person|softwareSystem|container|component)\s+"([^"]*)"(?:\s+"([^"]*)")?(?:\s+"([^"]*)")?(?:\s+"([^"]*)")?\s*(\{)?/);
    if (decl) {
      const [, id, level, name, desc, tech, , brace] = decl;
      const parent = stack.length ? stack[stack.length - 1]!.id : undefined;
      const kindByLevel: ComponentKind = level === "person" ? "person" : level === "softwareSystem" ? "external" : kindFromLabel(`${name} ${tech ?? ""}`);
      declared.set(id!, { name: name!, kind: kindByLevel, ...(tech ? { technology: tech } : {}), ...(desc ? { description: desc } : {}), ...(parent ? { parent } : {}), level: (level === "softwareSystem" ? "system" : level) as "system" | "container" | "component" | "person" });
      if (brace) {
        stack.push({ id: id!, kind: level === "softwareSystem" ? "system" : level === "container" ? "container" : "other" });
        if (level === "softwareSystem") systemsWithChildren.add(id!);
        else if (level === "container" && parent) systemsWithChildren.add(parent);
      }
      continue;
    }
    const group = line.match(/^group\s+"([^"]*)"\s*\{/);
    if (group) {
      const id = slugId(group[1]!);
      if (!out.boundaries.some((b) => b.id === id)) out.boundaries.push({ id, name: group[1]!, kind: "team" });
      stack.push({ id, kind: "group" });
      continue;
    }
    const rel = line.match(/^([A-Za-z0-9_.-]+)\s*->\s*([A-Za-z0-9_.-]+)(?:\s+"([^"]*)")?(?:\s+"([^"]*)")?/);
    if (rel) {
      out.relationships.push({ from: rel[1]!, to: rel[2]!, kind: "calls", ...(rel[3] ? { label: rel[3] } : {}) });
      continue;
    }
    if (line === "}") { stack.pop(); continue; }
    if (/^\{$/.test(line)) { depth += 1; continue; }
    if (!/^(!|properties|tags|url|technology|description)\b/.test(line)) out.notes.push(`Skipped: ${line}`);
  }
  // Software systems with containers become boundaries; their containers the components. Systems
  // without containers are external systems; components inside containers are folded into their container.
  const idOf = (id: string) => slugId(id);
  for (const [id, d] of declared) {
    if (d.level === "system" && systemsWithChildren.has(id)) {
      out.boundaries.push({ id: idOf(id), name: d.name, kind: "system" });
      continue;
    }
    if (d.level === "component") continue;
    const boundaryParent = d.parent && systemsWithChildren.has(d.parent) ? idOf(d.parent) : d.parent && declared.get(d.parent)?.level === "system" ? undefined : d.parent ? idOf(d.parent) : undefined;
    const inGroup = d.parent && out.boundaries.some((b) => b.id === d.parent && b.kind === "team") ? d.parent : undefined;
    out.components.push({ id: idOf(id), name: d.name, kind: d.kind, ...(d.technology ? { technology: d.technology } : {}), ...(d.description ? { description: d.description } : {}), ...(boundaryParent || inGroup ? { boundary: (boundaryParent ?? inGroup)! } : {}) });
  }
  // Relationships whose ends are components inside containers are lifted to the container.
  const lift = (id: string): string => {
    const d = declared.get(id);
    if (!d) return idOf(id);
    if (d.level === "component" && d.parent) return lift(d.parent);
    if (d.level === "system" && systemsWithChildren.has(id)) {
      out.notes.push(`Relationship to software system "${d.name}" mapped to its first container`);
      const first = [...declared.entries()].find(([, x]) => x.parent === id && x.level === "container");
      return first ? idOf(first[0]) : idOf(id);
    }
    return idOf(id);
  };
  const known = new Set(out.components.map((c) => c.id!));
  out.relationships = out.relationships
    .map((r) => ({ ...r, from: lift(r.from), to: lift(r.to) }))
    .filter((r) => r.from !== r.to && known.has(r.from) && known.has(r.to))
    .map((r) => ({ ...r, kind: relKindFromLabel(r.label, out.components.find((c) => c.id === r.to)?.kind) }));
  if (out.components.length === 0) out.notes.push("No people, systems or containers found inside model { }");
  return out;
}

// ---- PlantUML component diagram --------------------------------------------------------------

export function parsePlantUml(text: string): ParsedModel {
  const out: ParsedModel = { notation: "plantuml", components: [], relationships: [], boundaries: [], notes: [] };
  const comps = new Map<string, IncomingComponent>();
  const alias = new Map<string, string>(); // declared alias or name -> id
  const stack: string[] = [];
  const add = (name: string, id: string, kind: ComponentKind) => {
    const sid = slugId(id);
    if (!comps.has(sid)) comps.set(sid, { id: sid, name, kind, ...(stack.length ? { boundary: stack[stack.length - 1] } : {}) });
    alias.set(id, sid);
    alias.set(name, sid);
    return sid;
  };
  const resolve = (token: string): string | null => {
    const t = token.trim();
    const bracket = t.match(/^\[(.+)\]$/);
    if (bracket) return alias.get(bracket[1]!) ?? add(bracket[1]!, bracket[1]!, kindFromLabel(bracket[1]!));
    const quoted = t.match(/^"(.+)"$/);
    if (quoted) return alias.get(quoted[1]!) ?? add(quoted[1]!, quoted[1]!, kindFromLabel(quoted[1]!));
    if (alias.has(t)) return alias.get(t)!;
    if (/^[A-Za-z0-9_.-]+$/.test(t)) return add(t, t, kindFromLabel(t));
    return null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/'.*$/, "").trim();
    if (!line || /^@(start|end)uml/.test(line) || /^(skinparam|title|left to right|top to bottom|!|hide|scale|legend|note)\b/i.test(line)) continue;
    const pkg = line.match(/^(package|rectangle|node|cloud|folder|frame)\s+"?([^"{]+?)"?(?:\s+as\s+([A-Za-z0-9_.-]+))?\s*\{$/i);
    if (pkg) {
      const id = slugId(pkg[3] ?? pkg[2]!);
      if (!out.boundaries.some((b) => b.id === id)) out.boundaries.push({ id, name: pkg[2]!.trim(), kind: /node|cloud/i.test(pkg[1]!) ? "zone" : "system" });
      stack.push(id);
      continue;
    }
    if (line === "}") { stack.pop(); continue; }
    const decl = line.match(/^(component|database|queue|actor|interface|storage|agent|boundary|collections|control|entity)\s+(?:"([^"]+)"|([A-Za-z0-9_.-]+))(?:\s+as\s+([A-Za-z0-9_.-]+))?/i);
    if (decl) {
      const name = decl[2] ?? decl[3]!;
      const id = decl[4] ?? decl[3] ?? name;
      const k = decl[1]!.toLowerCase();
      add(name, id, k === "database" || k === "storage" ? "database" : k === "queue" ? "queue" : k === "actor" ? "person" : kindFromLabel(name));
      continue;
    }
    const bracketDecl = line.match(/^\[([^\]]+)\](?:\s+as\s+([A-Za-z0-9_.-]+))?$/);
    if (bracketDecl) {
      add(bracketDecl[1]!, bracketDecl[2] ?? bracketDecl[1]!, kindFromLabel(bracketDecl[1]!));
      continue;
    }
    const edge = line.match(/^(.+?)\s*(-+(?:>|\(|o|\*)?|\.+>|<-+|-+\[#\w+\]-+>)\s*(.+?)(?:\s*:\s*(.+))?$/);
    if (edge && /[-.]/.test(edge[2]!)) {
      const [, left, arrow, right, label] = edge;
      const reversed = arrow!.startsWith("<");
      const a = resolve(reversed ? right! : left!);
      const b = resolve(reversed ? left! : right!);
      if (a && b) {
        out.relationships.push({ from: a, to: b, kind: relKindFromLabel(label, comps.get(b)?.kind), ...(label ? { label: label.trim() } : {}) });
        continue;
      }
    }
    out.notes.push(`Skipped: ${line}`);
  }
  out.components = [...comps.values()];
  if (out.components.length === 0) out.notes.push("No components found; is this a component diagram?");
  return out;
}

export function parseNotation(text: string, notation?: Notation | "auto"): ParsedModel | null {
  const n = notation && notation !== "auto" ? notation : detectNotation(text);
  if (!n) return null;
  return n === "mermaid" ? parseMermaidFlowchart(text) : n === "structurizr" ? parseStructurizr(text) : parsePlantUml(text);
}

// ---- Structurizr DSL export -----------------------------------------------------------------

const dslId = (id: string) => id.replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "_$1");
const q = (s: string) => `"${s.replace(/"/g, "'")}"`;

/** The model as a Structurizr workspace: boundaries become software systems with containers, the rest external systems and people. */
export function toStructurizrDsl(model: ArchModelContent, title: string): string {
  const lines: string[] = [`workspace ${q(title)} ${q("Exported from Tandem")} {`, "", "  model {"];
  const bounded = new Map<string, typeof model.components>();
  for (const c of model.components) if (c.boundary) bounded.set(c.boundary, [...(bounded.get(c.boundary) ?? []), c]);
  const dslType = (k: ComponentKind) => (k === "person" ? "person" : "container");
  for (const c of model.components) {
    if (c.boundary && model.boundaries.some((b) => b.id === c.boundary)) continue;
    if (c.kind === "person") lines.push(`    ${dslId(c.id)} = person ${q(c.name)}${c.description ? ` ${q(c.description)}` : ""}`);
    else lines.push(`    ${dslId(c.id)} = softwareSystem ${q(c.name)}${c.description ? ` ${q(c.description)}` : ' ""'}${c.technology ? ` {\n      tags ${q(c.technology)}\n    }` : ""}`);
  }
  for (const b of model.boundaries) {
    const members = bounded.get(b.id) ?? [];
    lines.push(`    ${dslId(b.id)} = softwareSystem ${q(b.name)} {`);
    for (const c of members) lines.push(`      ${dslId(c.id)} = ${dslType(c.kind)} ${q(c.name)} ${q(c.description ?? "")} ${q(c.technology ?? c.kind)}${c.kind === "database" ? " {\n        tags \"Database\"\n      }" : ""}`);
    lines.push("    }");
  }
  lines.push("");
  const VERB: Record<RelationshipKind, string> = { calls: "calls", publishes: "publishes to", subscribes: "subscribes to", reads: "reads from", writes: "writes to", uses: "uses", depends_on: "depends on" };
  for (const r of model.relationships) lines.push(`    ${dslId(r.from)} -> ${dslId(r.to)} ${q(r.label ?? VERB[r.kind])}`);
  lines.push("  }", "", "  views {");
  for (const b of model.boundaries) lines.push(`    container ${dslId(b.id)} ${q(`${dslId(b.id)}_containers`)} {\n      include *\n      autoLayout lr\n    }`);
  if (model.boundaries.length === 0 && model.components.length) lines.push(`    systemLandscape ${q("landscape")} {\n      include *\n      autoLayout lr\n    }`);
  lines.push("    theme default", "  }", "}", "");
  return lines.join("\n");
}
