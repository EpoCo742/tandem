import { contentText, liveArtifacts, participantName, type DecisionPointContent, type SessionState } from "@tandem/shared";

// Markdown export with provenance kept as HTML comments so attribution survives leaving the app.

export function exportMarkdown(s: SessionState): string {
  const out: string[] = [];
  out.push(`# ${s.title}`, "");
  out.push(`<!-- tandem session ${s.id}; exported ${new Date().toISOString()}; head commit ${s.headCommitId ?? "none"} -->`, "");
  out.push("## Participants", "");
  for (const p of Object.values(s.participants)) out.push(`- ${p.name} (${p.role})`);
  out.push("");

  if (s.brief) out.push("## Brief", "", s.brief, "");

  out.push("## Artifacts", "");
  for (const a of liveArtifacts(s)) {
    const v = a.current;
    out.push(`### ${a.title}`, "");
    out.push(`<!-- artifact ${a.id} v${v.versionNo}; author ${v.authorKind}:${participantName(s, v.authorUserId)}; provenance ${JSON.stringify(v.provenance)} -->`);
    out.push(`*${a.type} · v${v.versionNo} · ${v.authorKind === "ai" ? "AI for " : ""}${participantName(s, v.authorUserId)}*`, "");
    if (a.type === "mermaid") out.push("```mermaid", contentText(a.type, v.content), "```", "");
    else if (a.type === "decision_point") {
      const c = v.content as DecisionPointContent;
      out.push(c.context, "");
      for (const o of c.options) out.push(`- **${o.title}**${c.resolvedOptionId === o.id ? " (chosen)" : ""}: ${o.tradeoffs}`);
      out.push("");
    } else if (a.type === "code") out.push("```" + ((v.content as { language?: string }).language ?? ""), contentText(a.type, v.content), "```", "");
    else if (a.type === "data_model") out.push("```json", contentText(a.type, v.content), "```", "");
    else out.push(contentText(a.type, v.content), "");
  }

  out.push("## Decision log", "");
  const decisions = Object.values(s.decisions).sort((a, b) => a.label.localeCompare(b.label));
  if (!decisions.length) out.push("(none)", "");
  for (const d of decisions) {
    out.push(`- **${d.label}** [${d.status}] ${d.statement}${d.agreedBy.length ? ` — ${d.agreedBy.map((u) => participantName(s, u)).join(", ")}` : ""}${d.supersededBy ? ` (superseded by ${s.decisions[d.supersededBy]?.label})` : ""}`);
    out.push(`  <!-- decision ${d.id}; evidence ${d.evidence.join(",")} -->`);
  }
  out.push("");

  out.push("## History", "");
  for (const c of s.commits) out.push(`- ${c.createdAt} ${c.message} (${c.id.slice(-6)})`);
  out.push("");
  return out.join("\n");
}
