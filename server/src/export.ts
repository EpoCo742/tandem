import { allAdrs, contentText, contractsOf, dataModelMarkdown, legendText, mermaidLegend, describeAnchor, liveArtifacts, modelDiff, modelToMermaid, participantName, threads, type AlternativesContent, type ArchModelContent, type ConstraintsContent, type ContractContent, type DataModelContent, type DecisionPointContent, type SessionState, type SourceContent, type ViewContent } from "@tandem/shared";

function modelMarkdown(m: ArchModelContent): string[] {
  const out: string[] = [];
  const d = modelDiff(m);
  if (m.asIs && d) {
    const names = (cs: { name: string }[]) => (cs.length ? cs.map((c) => c.name).join(", ") : "none");
    out.push(`**As-is baseline:** ${m.asIs.source}, captured ${m.asIs.capturedAt}. **To-be against as-is:** added ${names(d.added)}; removed ${names(d.removed)}; changed ${names(d.changed.map((x) => x.after))}; ${d.same.length} unchanged.`, "");
    if (m.asIs.notes?.length) out.push(...m.asIs.notes.map((n) => `- ${n}`), "");
  }
  out.push("| Component | Kind | Technology | Boundary | Description |", "|---|---|---|---|---|");
  const bname = (id?: string) => (id ? m.boundaries.find((b) => b.id === id)?.name ?? id : "");
  for (const c of m.components) out.push(`| ${c.name} | ${c.kind} | ${c.technology ?? ""} | ${bname(c.boundary)} | ${c.description ?? ""} |`);
  if (m.deployment?.nodes.length) {
    out.push("", "Deployment:", "");
    for (const env of m.deployment.environments) {
      const placed = m.deployment.placements[env] ?? {};
      for (const n of m.deployment.nodes) {
        const on = Object.entries(placed).filter(([, nid]) => nid === n.id).map(([cid]) => m.components.find((c) => c.id === cid)?.name ?? cid);
        out.push(`- ${env}: **${n.name}** (${[n.kind, n.technology, n.region ? `region ${n.region}` : "", n.trust ? `${n.trust} trust` : "", n.parent ? `in ${m.deployment.nodes.find((x) => x.id === n.parent)?.name ?? n.parent}` : ""].filter(Boolean).join(", ")}): ${on.join(", ") || "nothing placed"}`);
      }
    }
  }
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
  out.push(`<!-- session zero: session ${s.id}; exported ${new Date().toISOString()}; head commit ${s.headCommitId ?? "none"} -->`, "");
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
    if (a.type === "design_doc") out.push(`**Status:** ${reviewStatus(s, a.id)}`, "");
    if (a.type === "mermaid") out.push("```mermaid", contentText(a.type, v.content), "```", "");
    else if (a.type === "view") {
      const vc = v.content as ViewContent;
      if (model) {
        const src = modelToMermaid(model, vc);
        out.push("```mermaid", src, "```", "");
        const legend = legendText(mermaidLegend(src));
        if (legend) out.push(`*${legend}*`, "");
      }
      else out.push("*(view without an architecture model)*", "");
      if (vc.note) out.push(`*${vc.note}*`, "");
    } else if (a.type === "alternatives") {
      const ac = v.content as AlternativesContent;
      out.push(ac.question, "");
      for (const c of ac.candidates) {
        out.push(`#### ${c.id.toUpperCase()}. ${c.title}${ac.chosen === c.id ? " (chosen)" : ac.chosen ? " (not chosen)" : ""}`, "", c.summary, "", "```mermaid", modelToMermaid(c.model, { kind: "container" }), "```", "");
        if (c.pros.length) out.push(`For: ${c.pros.join("; ")}`, "");
        if (c.cons.length) out.push(`Against: ${c.cons.join("; ")}`, "");
        if (c.constraintsMet.length || c.constraintsAtRisk.length) out.push(`Constraints met: ${c.constraintsMet.join(", ") || "none"}. At risk: ${c.constraintsAtRisk.join(", ") || "none"}.`, "");
      }
    } else if (a.type === "contract") {
      const c = v.content as ContractContent;
      const st = contractsOf(s).find((x) => x.artifact.id === a.id);
      const cname = (id: string) => model?.components.find((x) => x.id === id)?.name ?? id;
      out.push(`${c.format}${c.version ? ` ${c.version}` : ""}${st?.provider ? `, provided by ${cname(st.provider)}` : ""}${st?.consumers.length ? `, consumed by ${st.consumers.map(cname).join(", ")}` : ""}${st?.changedAfterModel ? " (changed after the model; consumers may not have caught up)" : ""}`, "", "```" + (c.format === "markdown" ? "" : c.format === "openapi" || c.format === "asyncapi" ? "yaml" : c.format === "json_schema" ? "json" : ""), c.body, "```", "");
    } else if (a.type === "arch_model") out.push(...modelMarkdown(v.content as ArchModelContent));
    else if (a.type === "constraints") {
      const cc = v.content as ConstraintsContent;
      out.push("| Id | Constraint | Kind | Area | Set by |", "|---|---|---|---|---|");
      for (const k of cc.constraints) out.push(`| ${k.id}${k.exceptionTo ? ` (exception to ${k.exceptionTo})` : ""} | ${k.statement}${k.value ? ` (${k.value})` : ""} | ${k.kind.replace("_", " ")} | ${k.category.replace(/_/g, " ")} | ${k.setBy ? participantName(s, k.setBy) : k.source && s.artifacts[k.source] ? `document: ${s.artifacts[k.source]!.title}` : "document"} |`);
      out.push("");
    }
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
  const assumptions = Object.values(s.assumptions).sort((a, b) => a.label.localeCompare(b.label));
  if (assumptions.length) {
    out.push("## Assumptions", "", "Believed true when stated, not decided. Each has an owner and, where given, a date to look at it again.", "");
    for (const a of assumptions) out.push(`- **${a.label}** [${a.status}] ${a.statement} — ${participantName(s, a.ownerUserId)}${a.revisitAt ? ` (revisit by ${a.revisitAt.slice(0, 10)})` : ""}${a.decisionId && s.decisions[a.decisionId] ? ` → ${s.decisions[a.decisionId]!.label}` : ""}${a.note ? `. ${a.note}` : ""}`);
    out.push("");
  }
  const questions = Object.values(s.questions).sort((a, b) => a.label.localeCompare(b.label));
  if (questions.length) {
    out.push("## Questions", "", "Asked by the AI or by a participant; answered in the session or still open.", "");
    for (const q of questions) out.push(`- **${q.label}** [${q.status}] ${q.text}${q.answer ? ` → ${q.answer}` : ""}${q.resolvedBy ? ` (${participantName(s, q.resolvedBy)})` : ""}`);
    out.push("");
  }
  // The same decisions as architecture decision records, one section each (the files are available separately).
  if (decisions.length) {
    out.push("## Decision records", "");
    for (const f of allAdrs(s)) out.push(f.markdown.replace(/^# /m, "### "), "");
  }

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

  const threadList = threads(s);
  if (threadList.length) {
    out.push("## Discussion threads", "", "Conversations between people on specific cards. Only messages marked promoted reached the AI.", "");
    for (const t of threadList) {
      out.push(`- **On ${describeAnchor(s, t.anchor)}** (${t.resolved ? "resolved" : "open"})`);
      for (const m of [t.root, ...t.replies]) {
        const promoted = s.messages.some((x) => x.mode === "promoted" && s.eventsById[x.eventId]?.causedBy.includes(m.eventId));
        out.push(`  - ${participantName(s, m.userId)}: ${m.text}${promoted ? " *(promoted to the AI)*" : ""}`);
      }
      out.push(`  <!-- thread ${t.root.eventId}; artifact ${t.anchor.artifactId}${t.anchor.componentId ? `; component ${t.anchor.componentId}` : ""} -->`);
    }
    out.push("");
  }

  out.push("## History", "");
  for (const c of s.commits) out.push(`- ${c.createdAt} ${c.message} (${c.id.slice(-6)})`);
  out.push("");
  return out.join("\n");
}

// "approved at v3, signed off by Alice (…), Bob (…) (D-07)"; "in review, 1 of 2 signed"; "draft (previously approved v3 by …; since then: …)".
function reviewStatus(s: SessionState, artifactId: string): string {
  const r = s.reviews[artifactId];
  if (!r) return "draft (not yet reviewed)";
  const who = (u: string) => participantName(s, u);
  if (r.status === "approved") return `approved at v${r.approvedVersionNo}, signed off by ${r.reviewers.map((u) => `${who(u)} (${r.signoffs[u]?.at ?? r.approvedAt})`).join(", ")}${r.decisionId && s.decisions[r.decisionId] ? ` (${s.decisions[r.decisionId]!.label})` : ""}`;
  if (r.status === "in_review") return `in review, ${Object.keys(r.signoffs).length} of ${r.reviewers.length} signed (${r.reviewers.map((u) => `${who(u)}${r.signoffs[u] ? " ✓" : ""}`).join(", ")})`;
  const last = r.history[r.history.length - 1];
  const changes = r.changedSince.map((c) => `${c.title} changed (v${c.versionNo}, ${c.byUserId ? who(c.byUserId) : "system"})`).join("; ");
  return last ? `draft (previously approved v${last.versionNo} by ${last.signers.map(who).join(", ")}${changes ? `; since then: ${changes}` : ""})` : "draft";
}
