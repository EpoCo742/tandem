import { dataModelMarkdown, type DataModelContent, type ToolResult } from "@tandem/shared";
import type { ProviderAdapter, TurnRequest, TurnResult } from "./types.js";
import { callMcpTool } from "../mcp.js";

// Offline provider for local development and tests. It reads the rendered prompt,
// produces plausible canvas operations through the same tool bindings the real
// adapter uses, and streams text. No network, no credentials.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function extractBatch(prompt: string): { speaker: string; text: string; eventId: string }[] {
  const idx = prompt.lastIndexOf("## Current messages");
  const tail = idx >= 0 ? prompt.slice(idx) : prompt;
  const out: { speaker: string; text: string; eventId: string }[] = [];
  for (const line of tail.split("\n")) {
    const m = line.match(/^\[(.+?)\]\s*\(event (\S+)\)\s*(.*)$/);
    if (m) out.push({ speaker: m[1]!, eventId: m[2]!, text: m[3]! });
  }
  return out;
}

function extractDecisions(prompt: string): { id: string; label: string; statement: string; status: string }[] {
  const out: { id: string; label: string; statement: string; status: string }[] = [];
  const re = /^- (D-\d+) \[(\w+)\] \(id (\S+)\) (.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt))) out.push({ label: m[1]!, status: m[2]!, id: m[3]!, statement: m[4]! });
  return out;
}

function extractArtifacts(prompt: string): { id: string; type: string; title: string; versionNo: number }[] {
  const out: { id: string; type: string; title: string; versionNo: number }[] = [];
  const re = /^- (\S+) \((\w+), v(\d+), owner [^)]*\) (.+?)(?: — .*)?$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt))) out.push({ id: m[1]!, type: m[2]!, versionNo: Number(m[3]), title: m[4]! });
  return out;
}

// Pull each artifact's full content block (fenced or <source>) that follows its index line.
function extractContents(prompt: string): Map<string, string> {
  const out = new Map<string, string>();
  const idx = prompt.indexOf("## Artifact index");
  const end = prompt.indexOf("## Recent transcript");
  const section = idx >= 0 ? prompt.slice(idx, end > idx ? end : undefined) : "";
  const re = /^- (\S+) \([^)]*\) [^\n]*\n(?:```[^\n]*\n([\s\S]*?)\n```|<source[^>]*>\n([\s\S]*?)\n<\/source>)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(section))) out.set(m[1]!, (m[2] ?? m[3] ?? "").replace(/\n…\(truncated.*$/s, ""));
  return out;
}

function buildDesignDoc(
  prompt: string,
  artifacts: { id: string; type: string; title: string; versionNo: number }[],
  decisions: { id: string; label: string; statement: string; status: string }[],
  requestEventId: string,
) {
  const title = prompt.match(/^Title: (.+)$/m)?.[1] ?? "Untitled";
  const participants = [...prompt.matchAll(/^- (.+?) \(id \S+, role (\w+)\)/gm)].map((m) => `${m[1]} (${m[2]})`);
  const contents = extractContents(prompt);
  const allDecisions = [...prompt.matchAll(/^- (D-\d+) \[(\w+)\] \(id (\S+)\) (.+?)(?: — by (.+?))?(?: — supersedes (\S+))?$/gm)].map((m) => ({ label: m[1]!, status: m[2]!, statement: m[4]!, by: m[5] ?? "", supersedes: m[6] ?? "" }));
  const diagrams = artifacts.filter((a) => a.type === "mermaid");
  const models = artifacts.filter((a) => a.type === "data_model");
  const notes = artifacts.filter((a) => a.type === "markdown");
  const sources = artifacts.filter((a) => a.type === "source");
  const open = allDecisions.filter((d) => d.status === "proposed" || d.status === "contested");
  const md: string[] = [];
  md.push(`# ${title}: design document`, "", "## Overview", "", `Designed collaboratively by ${participants.join(", ") || "the participants"}. The canvas holds ${diagrams.length} diagram(s), ${models.length} data model(s), ${notes.length} note(s) and ${sources.length} source document(s); the registry records ${allDecisions.length} decision(s), ${allDecisions.filter((d) => d.status === "agreed").length} agreed.`, "");
  md.push("## Architecture", "");
  if (!diagrams.length) md.push("No diagrams on the canvas yet.", "");
  for (const d of diagrams) md.push(`### ${d.title} (v${d.versionNo})`, "", "```mermaid", contents.get(d.id) ?? "flowchart LR", "```", "");
  for (const n of notes) md.push(`### ${n.title}`, "", contents.get(n.id) ?? "", "");
  md.push("## Data model", "");
  if (!models.length) md.push("No data model has been drafted yet.", "");
  for (const m of models) {
    let body = "";
    try {
      body = dataModelMarkdown(JSON.parse(contents.get(m.id) ?? "{}") as DataModelContent);
    } catch {
      body = "```json\n" + (contents.get(m.id) ?? "{}") + "\n```";
    }
    md.push(`### ${m.title} (v${m.versionNo})`, "", body, "");
  }
  md.push("## Sources", "");
  if (!sources.length) md.push("No uploaded material.", "");
  for (const s of sources) md.push(`- **${s.title}**: ${(contents.get(s.id) ?? "").split("\n").find((l) => l.trim())?.slice(0, 160) ?? "(binary)"}`);
  if (sources.length) md.push("");
  md.push("## Decision log", "");
  for (const d of allDecisions) md.push(`- **${d.label}** [${d.status}] ${d.statement}${d.by ? ` — ${d.by}` : ""}${d.supersedes ? ` (supersedes ${d.supersedes})` : ""}`);
  if (!allDecisions.length) md.push("No decisions recorded.");
  md.push("", "## Open questions", "");
  if (!open.length) md.push("None: every recorded decision is agreed or superseded.");
  for (const d of open) md.push(`- ${d.label} is ${d.status}: ${d.statement}`);
  md.push("");
  const sections = [
    { id: "overview", heading: "Overview", derivedFrom: [requestEventId] },
    ...diagrams.map((d) => ({ id: `arch-${d.id.slice(-6)}`, heading: d.title, derivedFrom: [requestEventId] })),
    { id: "decisions", heading: "Decision log", derivedFrom: decisions.map((d) => d.id) },
  ];
  return { markdown: md.join("\n"), sections };
}

function userIdFor(prompt: string, speaker: string): string {
  const m = prompt.match(new RegExp(`^- ${speaker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(id ([^,)\\s]+)`, "m"));
  return m?.[1] ?? speaker;
}

function tokenise(s: string): string[] {
  return s.toLowerCase().match(/[a-z][a-z0-9]+/g)?.filter((w) => w.length > 3) ?? [];
}

function serviceNames(text: string): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(/\b(service|app|application|system)\s+([A-Z][\w-]*)/gi)) names.add(`${m[1]![0]!.toUpperCase()}${m[1]!.slice(1).toLowerCase()} ${m[2]}`);
  for (const m of text.matchAll(/\b(kafka|postgres|postgresql|redis|s3|dynamodb|rabbitmq|api gateway|mongodb)\b/gi)) names.add(m[1]!);
  return [...names];
}

function firstSentence(text: string, max = 150): string {
  const t = text.replace(/\s+/g, " ").trim();
  const cut = t.search(/[.!?](\s|$)/);
  const s = cut > 20 ? t.slice(0, cut + 1) : t;
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

export const fakeProvider: ProviderAdapter = {
  id: "fake",
  async validate() {
    return { ok: true, models: ["fake-architect-1"] };
  },
  // Deterministic brief: one attributed line per folded message, decisions by label, bounded length.
  async summarize(req) {
    const prev = req.previousBrief ? req.previousBrief.split("\n") : [];
    const prevPoints = prev.filter((l) => l.startsWith("- ")).slice(-30);
    const points = req.messages
      .filter((m) => m.kind !== "system")
      .map((m) => `- **${m.speaker}** [${m.eventId}]: ${firstSentence(m.text)}`);
    const decisions = req.decisions.map((d) => `- ${d.label} (${d.status}${d.by ? `, ${d.by}` : ""}): ${d.statement}`);
    const out = [`## Brief for ${req.title}`, "", "### Discussion so far", ...prevPoints, ...points];
    if (decisions.length) out.push("", "### Decisions recorded in this stretch", ...decisions);
    const questions = req.messages.filter((m) => m.kind === "clarification").map((m) => `- ${firstSentence(m.text)}`);
    if (questions.length) out.push("", "### Open questions", ...questions);
    return out.join("\n");
  },
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const batch = extractBatch(req.context.prompt);
    const decisions = extractDecisions(req.context.prompt).filter((d) => d.status === "agreed" || d.status === "proposed");
    const artifacts = extractArtifacts(req.context.prompt);
    const say = async (t: string) => {
      for (const chunk of t.match(/.{1,24}/gs) ?? []) {
        if (req.signal.aborted) return;
        req.onDelta(chunk);
        await sleep(15);
      }
    };
    let text = "";
    const emit = async (t: string) => {
      text += t;
      await say(t);
    };
    let toolCalls = 0;
    const call = async (name: string, input: unknown): Promise<ToolResult> => {
      const b = req.tools.find((t) => t.name === name);
      if (!b) return { status: "error", message: "no such tool" };
      toolCalls += 1;
      req.onToolProgress(name, "start");
      const r = await b.handler(input);
      req.onToolProgress(name, r.status === "error" ? "error" : "done");
      return r;
    };

    if (batch.length === 0) {
      await emit("I did not receive any directives in this batch.");
      return { text, toolCallsCount: 0, usage: { premiumRequests: 0 }, modelUsed: "fake-architect-1" };
    }

    // 0. Compile request: assemble a design document from everything in the prompt.
    const compile = batch.find((m) => /^Compile the design document/i.test(m.text));
    if (compile) {
      const doc = buildDesignDoc(req.context.prompt, artifacts, decisions, compile.eventId);
      const existing = artifacts.find((a) => a.type === "design_doc");
      if (existing) {
        await call("update_artifact", { artifactId: existing.id, baseVersionNo: existing.versionNo, content: doc, rationale: "Recompiled from the canvas", summary: "Design document compiled from the canvas" });
        await emit("Recompiled the design document from the current canvas and decision registry.");
      } else {
        await call("create_artifact", { type: "design_doc", title: "Design document", content: doc, rationale: "Compiled from the canvas", summary: "Design document compiled from the canvas" });
        await emit("Compiled the design document: overview, architecture, data model, sources, decision log, and open questions. Export it from the top bar.");
      }
      return { text, toolCallsCount: toolCalls, usage: { premiumRequests: 0 }, modelUsed: "fake-architect-1" };
    }

    // 0c. Outbound action: "publish/create/upload ... to confluence/jira/github" uses the speaker's own MCP tool.
    const outbound = batch.find((m) => /\b(publish|upload|push|create|open|file)\b/i.test(m.text) && /\b(confluence|jira|github|page|stor(y|ies)|epics?|tickets?|issues?|repo|wiki)\b/i.test(m.text));
    if (outbound) {
      const wantsTicket = /\b(jira|stor(y|ies)|epics?|tickets?|issues?)\b/i.test(outbound.text);
      const pick = req.mcpServers.flatMap((s) => s.tools.map((t) => ({ server: s, tool: t }))).find(({ tool }) => (wantsTicket ? /story|issue|ticket|epic/i.test(tool.name) : /publish|page|create_page|upload/i.test(tool.name)));
      if (!pick) {
        await emit(`${outbound.speaker}, I can do that once you register a tool for it: credentials → External tools. I have no external tool registered for you.`);
        return { text, toolCallsCount: 0, usage: { premiumRequests: 0 }, modelUsed: "fake-architect-1" };
      }
      const doc = artifacts.find((a) => a.type === "design_doc") ?? artifacts.find((a) => a.type === "mermaid");
      const args = wantsTicket
        ? { project: outbound.text.match(/\b([A-Z]{2,6})\b(?!.*\b[A-Z]{2,6}\b)/)?.[1] ?? "ORD", summary: `Implement ${doc?.title ?? "the design"}`, description: `From Tandem session ${req.sessionId}` }
        : { space: outbound.text.match(/\b(?:space|under|to)\s+([A-Z]{2,8})\b/)?.[1] ?? "ARCH", title: doc?.title ?? "Design document", body: `Exported from Tandem session ${req.sessionId} (${doc?.id ?? "no document yet"}).` };
      await emit(`Asking ${outbound.speaker} to approve ${pick.server.name}.${pick.tool.name}… `);
      const { callId, decision } = await req.external.ask(pick.server, pick.tool.name, args, pick.tool.readOnly);
      if (decision !== "approved") {
        await emit("That was not approved, so nothing was sent.");
        return { text, toolCallsCount: 0, usage: { premiumRequests: 0 }, modelUsed: "fake-architect-1" };
      }
      try {
        const r = await callMcpTool(pick.server.config, pick.tool.name, args);
        req.external.done(callId, r.ok, r.text);
        await emit(r.ok ? `Done: ${r.text}` : `The tool reported an error: ${r.text}`);
      } catch (e) {
        req.external.done(callId, false, (e as Error).message);
        await emit(`The tool failed: ${(e as Error).message}`);
      }
      return { text, toolCallsCount: 1, usage: { premiumRequests: 0 }, modelUsed: "fake-architect-1" };
    }

    // 0b. Data model request: derive entities from tables and events mentioned so far.
    const wantsModel = batch.find((m) => /data model|entity|schema|tables?\b.*(draft|design|model)/i.test(m.text) && !/^Compile/.test(m.text));
    if (wantsModel) {
      const corpus = [req.context.prompt, ...batch.map((b) => b.text)].join("\n");
      const tables = [...new Set([...corpus.matchAll(/\b(?:the |a )?([a-z][a-z_]+) table\b/gi)].map((m) => m[1]!.toLowerCase()))];
      const events = [...new Set([...corpus.matchAll(/\b([A-Z][A-Za-z]+) event\b/g)].map((m) => m[1]!))];
      const ev = [wantsModel.eventId];
      const entities = [
        ...tables.map((t) => ({
          name: t,
          fields: [
            { name: "id", type: "uuid", pk: true },
            { name: "status", type: "text" },
            { name: "created_at", type: "timestamptz" },
            { name: "updated_at", type: "timestamptz", nullable: true },
          ],
          derivedFrom: ev,
        })),
        ...events.map((e) => ({
          name: `${e.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase()}_events`,
          fields: [
            { name: "id", type: "uuid", pk: true },
            { name: "aggregate_id", type: "uuid", fk: tables[0] ? `${tables[0]}.id` : undefined },
            { name: "payload", type: "jsonb" },
            { name: "occurred_at", type: "timestamptz" },
          ],
          derivedFrom: ev,
        })),
      ];
      if (entities.length === 0) {
        await call("ask_clarification", { question: "Which tables or events should the data model cover? I did not find any named in the discussion yet.", addressedTo: [userIdFor(req.context.prompt, wantsModel.speaker)] });
        await emit("I need a table or event name to start from; asked on the canvas.");
        return { text, toolCallsCount: toolCalls, usage: { premiumRequests: 0 }, modelUsed: "fake-architect-1" };
      }
      const relations = tables[0] && events.length ? events.map((e) => ({ from: tables[0]!, to: `${e.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase()}_events`, cardinality: "1-n" as const, label: "emits", derivedFrom: ev })) : [];
      const existing = artifacts.find((a) => a.type === "data_model");
      const content = { entities, relations, sections: [{ id: "entities", derivedFrom: ev }] };
      if (existing) await call("update_artifact", { artifactId: existing.id, baseVersionNo: existing.versionNo, content, rationale: "Refresh data model from the discussion", summary: `Data model: ${entities.map((e) => e.name).join(", ")}` });
      else await call("create_artifact", { type: "data_model", title: "Data model", content, rationale: "Drafted from the tables and events named so far", summary: `Data model: ${entities.map((e) => e.name).join(", ")}` });
      await emit(`Drafted the data model with ${entities.map((e) => e.name).join(", ")}${relations.length ? ` and ${relations.length} relation(s)` : ""}. Tell me the fields you actually need and I will refine it.`);
      return { text, toolCallsCount: toolCalls, usage: { premiumRequests: 0 }, modelUsed: "fake-architect-1" };
    }

    // 1. Contradiction check: a directive that shares vocabulary with an agreed decision and contains a negation word.
    const negation = /\b(drop|remove|instead|replace|not|no longer|rather than|switch)\b/i;
    for (const msg of batch) {
      if (!negation.test(msg.text)) continue;
      const words = new Set(tokenise(msg.text));
      const hit = decisions.find((d) => d.status === "agreed" && tokenise(d.statement).filter((w) => words.has(w)).length >= 2);
      if (hit) {
        const blocks = artifacts.filter((a) => a.type === "mermaid").map((a) => a.id);
        await emit(`${msg.speaker}, that contradicts ${hit.label} ("${hit.statement}"), which was agreed earlier. I have not changed the canvas. `);
        await call("create_decision_point", {
          question: `Keep ${hit.label} or adopt ${msg.speaker}'s change?`,
          context: `${hit.label} states: ${hit.statement}. ${msg.speaker} now asks: "${msg.text}".`,
          options: [
            { id: "keep", title: `Keep ${hit.label}`, tradeoffs: "No rework; the earlier agreement stands.", canvasImpact: "No change." },
            { id: "adopt", title: `Adopt the new direction`, tradeoffs: "Requires updating diagrams and superseding the decision.", canvasImpact: "Affected diagrams are revised.", proposedBy: userIdFor(req.context.prompt, msg.speaker) },
            { id: "hybrid", title: "Combine both", tradeoffs: "More moving parts, but preserves both goals.", canvasImpact: "Diagram gains a bridging component." },
          ],
          blocksArtifactIds: blocks,
          directiveEventIds: [msg.eventId],
          contradictsDecisionId: hit.id,
        });
        await emit("I raised a decision point; vote on the card and I will apply the outcome.");
        return { text, toolCallsCount: toolCalls, usage: { premiumRequests: 0 }, modelUsed: "fake-architect-1" };
      }
    }

    // 2. Resolution of a decision point (synthetic system directive).
    const resolution = batch.find((m) => /decision point .* resolved/i.test(m.text));
    if (resolution) {
      const optM = resolution.text.match(/option "([^"]+)"/);
      const supersedes = resolution.text.match(/supersedes decision ([^\s.]+)/)?.[1] ?? null;
      const chosen = optM?.[1] ?? "the chosen option";
      const r = await call("record_decision", {
        statement: `Resolved: ${chosen}`,
        status: "agreed",
        agreedBy: (resolution.text.match(/voters: ([^)]+)\)/)?.[1] ?? "").split(",").map((s) => userIdFor(req.context.prompt, s.trim())).filter(Boolean),
        supersedes,
        evidence: [resolution.eventId],
      });
      const diagram = artifacts.find((a) => a.type === "mermaid");
      if (diagram) {
        const cur = await call("read_artifact", { artifactId: diagram.id });
        const src = (cur as { content?: { source?: string } }).content?.source ?? "flowchart LR";
        await call("update_artifact", {
          artifactId: diagram.id,
          baseVersionNo: diagram.versionNo,
          content: { source: `${src}\n  note[/"${chosen}"/]`, kind: "flowchart", sections: [{ id: "resolution", derivedFrom: [resolution.eventId] }] },
          rationale: "Apply the resolved decision point",
          summary: `${diagram.title} (updated for ${chosen})`,
        });
      }
      await emit(`Applied the resolution: ${chosen}. Recorded as ${(r as { label?: string }).label ?? "a decision"}.`);
      return { text, toolCallsCount: toolCalls, usage: { premiumRequests: 0 }, modelUsed: "fake-architect-1" };
    }

    // 3. Ordinary directives: extend or create the architecture diagram and record one decision per directive.
    const names = batch.flatMap((m) => serviceNames(m.text));
    const diagram = artifacts.find((a) => a.type === "mermaid" && /architecture/i.test(a.title));
    const nodeId = (n: string) => n.replace(/[^A-Za-z0-9]/g, "_");
    const edges: string[] = [];
    for (const m of batch) {
      const ns = serviceNames(m.text);
      for (let i = 0; i + 1 < ns.length; i++) {
        const verb = m.text.match(/\b(publish|publishes|emit|emits|send|sends|subscribe|subscribes|listen|listens|write|writes|save|saves|read|reads|call|calls)\b/i)?.[1]?.toLowerCase() ?? "uses";
        edges.push(`  ${nodeId(ns[i]!)}["${ns[i]}"] -->|${verb}| ${nodeId(ns[i + 1]!)}["${ns[i + 1]}"]`);
      }
    }
    const sections = batch.map((m) => ({ id: `msg-${m.eventId.slice(-6)}`, derivedFrom: [m.eventId] }));
    if (names.length > 0) {
      if (diagram) {
        const cur = await call("read_artifact", { artifactId: diagram.id });
        const src = (cur as { content?: { source?: string } }).content?.source ?? "flowchart LR";
        await call("update_artifact", {
          artifactId: diagram.id,
          baseVersionNo: diagram.versionNo,
          content: { source: `${src}\n${edges.join("\n")}`, kind: "flowchart", sections },
          rationale: `Add ${names.join(", ")}`,
          summary: `System architecture with ${names.join(", ")}`,
        });
        await emit(`Updated the architecture diagram with ${names.join(", ")}. `);
      } else {
        await call("create_artifact", {
          type: "mermaid",
          title: "System architecture",
          content: { source: `flowchart LR\n${edges.length ? edges.join("\n") : names.map((n) => `  ${nodeId(n)}["${n}"]`).join("\n")}`, kind: "flowchart", sections },
          rationale: "First architecture sketch from the discussion",
          summary: `System architecture with ${names.join(", ")}`,
        });
        await emit(`Created the architecture diagram with ${names.join(", ")}. `);
      }
    } else {
      await call("create_artifact", {
        type: "markdown",
        title: `Notes: ${batch[0]!.text.slice(0, 40)}`,
        content: { markdown: batch.map((m) => `- **${m.speaker}:** ${m.text}`).join("\n"), sections },
        rationale: "Capture the discussion",
        summary: "Discussion notes",
      });
      await emit("I captured that as a note on the canvas. ");
    }
    for (const m of batch) {
      if (m.speaker === "System") continue;
      const r = await call("record_decision", {
        statement: m.text.replace(/\.$/, ""),
        status: "agreed",
        agreedBy: [userIdFor(req.context.prompt, m.speaker)],
        supersedes: null,
        evidence: [m.eventId],
      });
      if (r.status === "recorded") await emit(`Recorded ${r.label} for ${m.speaker}. `);
    }
    await emit("Anything you want me to elaborate, or shall I draft the data model next?");
    return { text, toolCallsCount: toolCalls, usage: { premiumRequests: 0 }, modelUsed: "fake-architect-1" };
  },
};
