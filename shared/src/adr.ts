import type { Decision, SessionState } from "./reducer.js";
import { participantName } from "./reducer.js";
import type { ArchModelContent } from "./model.js";

// Architecture decision records: the file form of the decision registry. One Markdown file per
// decision, in the shape teams already keep under docs/adr, with attribution and evidence kept.

export interface DecisionOption {
  title: string;
  tradeoffs?: string;
  chosen?: boolean;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function adrFilename(d: Decision): string {
  const n = d.label.replace(/^D-/, "").padStart(4, "0");
  return `${n}-${slug(d.statement) || "decision"}.md`;
}

function componentNames(state: SessionState, ids: string[]): string[] {
  const model = Object.values(state.artifacts).find((a) => a.type === "arch_model" && !a.deleted)?.current.content as ArchModelContent | undefined;
  return ids.map((id) => model?.components.find((c) => c.id === id)?.name ?? id);
}

export function adrMarkdown(state: SessionState, d: Decision): string {
  const out: string[] = [];
  const status = d.status === "agreed" ? "Accepted" : d.status === "superseded" ? `Superseded by ${d.supersededBy ? state.decisions[d.supersededBy]?.label ?? d.supersededBy : "a later decision"}` : d.status === "contested" ? "Contested" : "Proposed";
  out.push(`# ${d.label}: ${d.statement}`, "");
  out.push(`- **Status:** ${status}`);
  out.push(`- **Date:** ${d.createdAt.slice(0, 10)}`);
  out.push(`- **Deciders:** ${d.agreedBy.length ? d.agreedBy.map((u) => participantName(state, u)).join(", ") : "not yet agreed"}`);
  if (d.about.length) out.push(`- **Concerns:** ${componentNames(state, d.about).join(", ")}`);
  if (d.supersedes) out.push(`- **Supersedes:** ${state.decisions[d.supersedes]?.label ?? d.supersedes}`);
  out.push("", "## Context", "", d.context || "Stated during the design session; see the evidence below.", "");
  out.push("## Decision", "", d.statement, "");
  if (d.options.length) {
    out.push("## Options considered", "");
    for (const o of d.options) out.push(`- ${o.chosen ? "**" : ""}${o.title}${o.chosen ? " (chosen)**" : ""}${o.tradeoffs ? `: ${o.tradeoffs}` : ""}`);
    out.push("");
  }
  out.push("## Consequences", "", d.consequences || "Not recorded.", "");
  if (d.evidence.length) {
    out.push("## Evidence", "");
    for (const id of d.evidence) {
      const ev = state.eventsById[id];
      const text = ev ? ((ev.payload as { text?: string }).text ?? "").slice(0, 200) : "";
      out.push(`- ${ev ? participantName(state, ev.actorUserId) : "unknown"}${text ? `: ${text}` : ""} <!-- event ${id} -->`);
    }
    out.push("");
  }
  out.push(`<!-- tandem decision ${d.id}; session ${state.id} -->`, "");
  return out.join("\n");
}

export function allAdrs(state: SessionState): { filename: string; markdown: string; decision: Decision }[] {
  return Object.values(state.decisions)
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((d) => ({ filename: adrFilename(d), markdown: adrMarkdown(state, d), decision: d }));
}
