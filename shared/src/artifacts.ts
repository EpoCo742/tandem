import type { ArtifactType, Option, Provenance } from "./events.js";
import { modelToText, type ArchModelContent, type ViewContent } from "./model.js";

export interface Section {
  id: string;
  heading?: string;
  derivedFrom: string[];
}

export interface MermaidContent {
  source: string;
  kind: "flowchart" | "sequence" | "class" | "er" | "state" | "c4" | "other";
  sections: Section[];
}

export interface MarkdownContent {
  markdown: string;
  sections: Section[];
}

export interface Entity {
  name: string;
  fields: { name: string; type: string; pk?: boolean; fk?: string; nullable?: boolean }[];
  ownedBy?: string; // architecture model component id that owns this entity
  derivedFrom: string[];
}

export interface Relation {
  from: string;
  to: string;
  cardinality: "1-1" | "1-n" | "n-n";
  label?: string;
  derivedFrom: string[];
}

export interface DataModelContent {
  entities: Entity[];
  relations: Relation[];
  sections: Section[];
}

export interface DecisionPointContent {
  question: string;
  context: string;
  options: Option[];
  votes: Record<string, string>;
  resolvedOptionId?: string;
  resultingDecisionId?: string;
  blocksArtifactIds: string[];
  deadline?: string; // ISO time by which a majority is needed
  expired?: boolean; // the deadline passed without one; the point is closed and its artifacts unblocked
  violatesConstraintIds?: string[]; // raised because a directive conflicted with these constraints
  alternativesArtifactId?: string; // this point chooses between the candidates on that card; the winner becomes the model
}

export interface SourceContent {
  uploadId: string;
  kind: "image" | "markdown" | "text" | "diagram";
  name: string;
  mime: string;
  extractedText?: string;
  aiSummary: string;
}

export type ConstraintKind = "must" | "must_not" | "target";
export type ConstraintCategory = "latency" | "availability" | "data_residency" | "security" | "compliance" | "budget" | "platform" | "capacity" | "other";

/** One thing the design has to respect. Attributed to who set it and where it came from. */
export interface Constraint {
  id: string; // C-01, C-02, …
  statement: string;
  kind: ConstraintKind;
  category: ConstraintCategory;
  value?: string; // the measurable part, e.g. "p95 < 200 ms", "EU only", "$5k/month"
  setBy: string | null; // participant id, or null when it came from a document
  source?: string; // event id of the message, or artifact id of the upload, that established it
  exceptionTo?: string; // this constraint relaxes that one (C-01); agreed by whoever set it
  derivedFrom: string[];
}

export interface ConstraintsContent {
  constraints: Constraint[];
  sections: Section[];
}

/** One candidate architecture on an alternatives card: a complete model of its own plus the case for and against it. */
export interface Candidate {
  id: string; // a, b, c
  title: string;
  summary: string;
  model: ArchModelContent;
  pros: string[];
  cons: string[];
  constraintsMet: string[]; // constraint ids
  constraintsAtRisk: string[];
}

export interface AlternativesContent {
  question: string;
  candidates: Candidate[];
  chosen?: string; // candidate id, once a vote picked one; the others stay as what was considered
  sections: Section[];
}

export interface CodeContent {
  language: string;
  source: string;
  sections: Section[];
}

export type ArtifactContent =
  | ArchModelContent
  | ViewContent
  | ConstraintsContent
  | AlternativesContent
  | MermaidContent
  | MarkdownContent
  | DataModelContent
  | DecisionPointContent
  | SourceContent
  | CodeContent
  | { markdown: string; sections: Section[] };

/** Argument names that identify where an outbound call lands (a space, a project, a repo), as opposed to what it says. */
export const TARGET_KEYS = ["space", "spaceKey", "project", "projectKey", "repo", "repository", "owner", "org", "organization", "channel", "folder", "board", "database", "bucket", "parent", "parentId", "site", "workspace"];

/** The subset of a call's arguments that names its target: `{ space: "ARCH" }` for a Confluence publish. */
export function targetOf(args: unknown): Record<string, string> {
  const a = (args ?? {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const k of TARGET_KEYS) if (typeof a[k] === "string" || typeof a[k] === "number") out[k] = String(a[k]);
  return out;
}

export function describeTarget(t: Record<string, string>): string {
  const e = Object.entries(t);
  return e.length ? e.map(([k, v]) => `${k} ${v}`).join(", ") : "any target";
}

/** Render a data model as Markdown tables; used wherever a data model has to become prose. */
export function dataModelMarkdown(c: DataModelContent): string {
  const out: string[] = [];
  for (const e of c.entities ?? []) {
    out.push(`**${e.name}**`, "", "| Field | Type | Notes |", "|---|---|---|");
    for (const f of e.fields ?? []) {
      const notes = [f.pk ? "primary key" : "", f.fk ? `references ${f.fk}` : "", f.nullable ? "nullable" : ""].filter(Boolean).join(", ");
      out.push(`| ${f.name} | ${f.type} | ${notes} |`);
    }
    out.push("");
  }
  if (c.relations?.length) {
    out.push("Relations:", "");
    for (const r of c.relations) out.push(`- ${r.from} ${r.cardinality} ${r.to}${r.label ? ` (${r.label})` : ""}`);
    out.push("");
  }
  return out.join("\n");
}

export function contentText(type: string, content: unknown): string {
  const c = content as Record<string, unknown>;
  switch (type) {
    case "mermaid":
      return String(c.source ?? "");
    case "markdown":
    case "design_doc":
      return String(c.markdown ?? "");
    case "code":
      return String(c.source ?? "");
    case "data_model":
      return JSON.stringify({ entities: c.entities, relations: c.relations }, null, 2);
    case "decision_point":
      return `${c.question}\n${c.context}`;
    case "source":
      return String(c.extractedText ?? c.aiSummary ?? "");
    case "arch_model":
      return modelToText(content as ArchModelContent);
    case "constraints": {
      const cc = content as ConstraintsContent;
      return cc.constraints.length ? cc.constraints.map((k) => `- ${k.id} [${k.kind}, ${k.category}]${k.exceptionTo ? ` [exception to ${k.exceptionTo}]` : ""} ${k.statement}${k.value ? ` (${k.value})` : ""}`).join("\n") : "(no constraints yet)";
    }
    case "alternatives": {
      const ac = content as AlternativesContent;
      return [
        `Question: ${ac.question}${ac.chosen ? ` (chosen: ${ac.chosen.toUpperCase()})` : " (not decided yet; people choose with the Decide button on the card)"}`,
        ...ac.candidates.map((c) => `${c.id.toUpperCase()}. ${c.title}${ac.chosen === c.id ? " [chosen]" : ac.chosen ? " [not chosen]" : ""}: ${c.summary}\n   components: ${c.model.components.map((x) => x.name).join(", ") || "-"}\n   for: ${c.pros.join("; ") || "-"}\n   against: ${c.cons.join("; ") || "-"}\n   constraints met: ${c.constraintsMet.join(", ") || "-"}; at risk: ${c.constraintsAtRisk.join(", ") || "-"}`),
      ].join("\n");
    }
    case "view": {
      const v = content as ViewContent;
      return `${v.kind === "diff" ? "as-is vs to-be" : v.kind} view${v.focus ? ` of ${v.focus}` : ""}${v.note ? `: ${v.note}` : ""} (rendered from the architecture model)`;
    }
    default:
      return JSON.stringify(content);
  }
}

export function provenanceOf(type: string, content: unknown): Provenance[] {
  const c = content as { sections?: Section[] };
  if (Array.isArray(c?.sections)) {
    return c.sections.map((s) => ({ sectionId: s.id, derivedFrom: s.derivedFrom ?? [] }));
  }
  return [];
}

/**
 * Why a content object cannot be shown as a card of the given type, or null when it can.
 * The ledger keeps whatever is appended, so this runs before anything is appended: a model
 * that rewrites a decision point as Markdown would otherwise blank every client that loads it.
 */
export function contentProblem(type: ArtifactType, content: unknown): string | null {
  const c = content as Record<string, unknown> | null;
  if (!c || typeof c !== "object" || Array.isArray(c)) return `${type} content must be an object`;
  const need = (key: string, kind: "string" | "array" | "object"): string | null => {
    const v = c[key];
    const ok = kind === "string" ? typeof v === "string" : kind === "array" ? Array.isArray(v) : v !== null && typeof v === "object" && !Array.isArray(v);
    return ok ? null : `${type} content needs "${key}" (${kind})`;
  };
  switch (type) {
    case "markdown":
    case "design_doc":
      return need("markdown", "string");
    case "mermaid":
    case "code":
      return need("source", "string");
    case "data_model":
      return need("entities", "array");
    case "arch_model":
      return need("components", "array") ?? need("relationships", "array") ?? need("boundaries", "array");
    case "view":
      return need("kind", "string");
    case "constraints":
      return need("constraints", "array");
    case "alternatives":
      return need("question", "string") ?? need("candidates", "array");
    case "decision_point":
      return need("question", "string") ?? need("options", "array") ?? need("votes", "object") ?? need("blocksArtifactIds", "array");
    case "source":
      return need("uploadId", "string");
    default:
      return null;
  }
}
