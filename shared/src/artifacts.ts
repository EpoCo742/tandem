import type { Option, Provenance } from "./events.js";
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
}

export interface SourceContent {
  uploadId: string;
  kind: "image" | "markdown" | "text" | "diagram";
  name: string;
  mime: string;
  extractedText?: string;
  aiSummary: string;
}

export interface CodeContent {
  language: string;
  source: string;
  sections: Section[];
}

export type ArtifactContent =
  | ArchModelContent
  | ViewContent
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
    case "view": {
      const v = content as ViewContent;
      return `${v.kind} view${v.focus ? ` of ${v.focus}` : ""}${v.note ? `: ${v.note}` : ""} (rendered from the architecture model)`;
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
