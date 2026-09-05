import { contentText, dataModelMarkdown, liveArtifacts, modelToMermaid, participantName, type ArchModelContent, type DataModelContent, type DecisionPointContent, type SessionState, type SourceContent, type ViewContent } from "@tandem/shared";

function modelMarkdown(m: ArchModelContent): string[] {
  const out: string[] = ["| Component | Kind | Technology | Boundary | Description |", "|---|---|---|---|---|"];
  const bname = (id?: string) => (id ? m.boundaries.find((b) => b.id === id)?.name ?? id : "");
  for (const c of m.components) out.push(`| ${c.name} | ${c.kind} | ${c.technology ?? ""} | ${bname(c.boundary)} | ${c.description ?? ""} |`);
  if (m.relationships.length) {
    out.push("", "Relationships:", "");
    const name = (id: string) => m.components.find((c) => c.id === id)?.name ?? id;
    for (const r of m.relationships) out.push(`- ${name(r.from)} ${r.kind.replace("_", " ")} ${name(r.to)}${r.label ? ` (${r.label})` : ""}`);
  }
  out.push("");
  return out;
}

const EXCERPT_LINES = 40;

function fenceLang(name: string, mime: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = { yaml: "yaml", yml: "yaml", json: "json", xml: "xml", md: "markdown", markdown: "markdown", csv: "csv", sql: "sql", toml: "toml", proto: "protobuf", graphql: "graphql", gql: "graphql", puml: "plantuml", mmd: "mermaid", txt: "text", log: "text" };
  if (map[ext]) return map[ext]!;
  if (/json/.test(mime)) return "json";
  if (/yaml/.test(mime)) return "yaml";
  if (/xml/.test(mime)) return "xml";
  return "text";
}

export function exportMarkdown(s: SessionState): string {
  const out: string[] = [];
  out.push(`# ${s.title}`, "");
  out.push(`<!-- tandem session ${s.id}; exported ${new Date().toISOString()}; head commit ${s.headCommitId ?? "none"} -->`, "");
  out.push("## Participants", "");
  for (const p of Object.values(s.participants)) out.push(`- ${p.name} (${p.role})`);
  out.push("");

  if (s.brief) out.push("## Brief", "", s.brief, "");

  out.push("## Artifacts", "");
  const model = liveArtifacts(s).find((a) => a.type === "arch_model")?.current.content as ArchModelContent | undefined;
  for (const a of liveArtifacts(s)) {
    const v = a.current;
    out.push(`### ${a.title}`, "");
    out.push(`<!-- artifact ${a.id} v${v.versionNo}; author ${v.authorKind}:${participantName(s, v.authorUserId)}; provenance ${JSON.stringify(v.provenance)} -->`);
    out.push(`*${a.type} · v${v.versionNo} · ${v.authorKind === "ai" ? "AI for " : ""}${participantName(s, v.authorUserId)}*`, "");
    if (a.type === "mermaid") out.push("```mermaid", contentText(a.type, v.content), "```", "");
    else if (a.type === "view") {
      const vc = v.content as ViewContent;
      if (model) out.push("```mermaid", modelToMermaid(model, vc), "```", "");
      else out.push("*(view without an architecture model)*", "");
      if (vc.note) out.push(`*${vc.note}*`, "");
    } else if (a.type === "arch_model") out.push(...modelMarkdown(v.content as ArchModelContent));
    else if (a.type === "decision_point") {
      const c = v.content as DecisionPointContent;
      out.push(c.context, "");
      for (const o of c.options) out.push(`- **${o.title}**${c.resolvedOptionId === o.id ? " (chosen)" : ""}: ${o.tradeoffs}`);
      out.push("");
    } else if (a.type === "code") out.push("```" + ((v.content as { language?: string }).language ?? ""), contentText(a.type, v.content), "```", "");
    else if (a.type === "data_model") out.push(dataModelMarkdown(v.content as DataModelContent), "");
    else if (a.type === "source") {
      // Uploaded material: describe it and quote the top rather than dumping the whole file into the document.
      const c = v.content as SourceContent;
      const text = c.extractedText ?? "";
      const lines = text.split("\n");
      out.push(`Uploaded ${c.kind} \`${c.name}\` (${c.mime}${text ? `, ${lines.length} lines` : ""}). The original file stays with the session.`, "");
      if (c.kind === "image") out.push(`![${c.name}](tandem-upload:${c.uploadId})`, "");
      else if (text) {
        const excerpt = lines.slice(0, EXCERPT_LINES).join("\n");
        out.push("```" + fenceLang(c.name, c.mime), excerpt, "```");
        if (lines.length > EXCERPT_LINES) out.push(`*(first ${EXCERPT_LINES} of ${lines.length} lines)*`);
        out.push("");
      }
    } else out.push(contentText(a.type, v.content), "");
  }

  out.push("## Decision log", "");
  const decisions = Object.values(s.decisions).sort((a, b) => a.label.localeCompare(b.label));
  if (!decisions.length) out.push("(none)", "");
  for (const d of decisions) {
    out.push(`- **${d.label}** [${d.status}] ${d.statement}${d.agreedBy.length ? ` — ${d.agreedBy.map((u) => participantName(s, u)).join(", ")}` : ""}${d.supersededBy ? ` (superseded by ${s.decisions[d.supersededBy]?.label})` : ""}`);
    out.push(`  <!-- decision ${d.id}; evidence ${d.evidence.join(",")} -->`);
  }
  out.push("");

  const calls = Object.values(s.externalCalls).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (calls.length) {
    out.push("## External actions", "");
    for (const c of calls) {
      const who = participantName(s, c.onBehalfOf);
      const owner = participantName(s, c.ownerUserId);
      const decided = c.decidedBy ? participantName(s, c.decidedBy) : c.reason ?? "";
      out.push(`- ${c.createdAt} **${c.serverName}.${c.toolName}** for ${who}, using ${owner}'s tool: ${c.status}${c.decidedBy ? ` (decided by ${decided})` : c.reason ? ` (${c.reason})` : ""}${c.result ? ` — ${c.result}` : ""}`);
      out.push(`  <!-- external ${c.id}; args ${JSON.stringify(c.args)} -->`);
    }
    out.push("");
  }

  out.push("## History", "");
  for (const c of s.commits) out.push(`- ${c.createdAt} ${c.message} (${c.id.slice(-6)})`);
  out.push("");
  return out.join("\n");
}
