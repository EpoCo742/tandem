import { dataModelMarkdown, manifestPaths, scanRepo, slugId, type ArchModelContent, type DataModelContent, type RepoFile, type ToolResult } from "@tandem/shared";
import type { ProviderAdapter, TurnRequest, TurnResult } from "./types.js";
import { callMcpTool } from "../mcp.js";

// Offline provider for local development and tests. It reads the rendered prompt,
// produces plausible canvas operations through the same tool bindings the real
// adapter uses, and streams text. No network, no credentials.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type BatchMessage = { speaker: string; text: string; eventId: string; about?: { label: string; artifactId: string; componentId?: string } };

function extractBatch(prompt: string): BatchMessage[] {
  const idx = prompt.lastIndexOf("## Current messages");
  const tail = idx >= 0 ? prompt.slice(idx) : prompt;
  const out: BatchMessage[] = [];
  for (const line of tail.split("\n")) {
    const m = line.match(/^\[(.+?)\]\s*\(event (\S+)\)\s*(.*)$/);
    if (!m) continue;
    let text = m[3]!;
    let about: BatchMessage["about"];
    const tag = text.match(/\s*\[about: (.+?) \(artifact (\S+?)(?:, component (\S+?))?\)\]$/);
    if (tag) {
      about = { label: tag[1]!, artifactId: tag[2]!, ...(tag[3] ? { componentId: tag[3] } : {}) };
      text = text.slice(0, tag.index).trim();
    }
    out.push({ speaker: m[1]!, eventId: m[2]!, text, ...(about ? { about } : {}) });
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
  const diagrams = artifacts.filter((a) => a.type === "mermaid" || a.type === "view");
  const archModel = artifacts.find((a) => a.type === "arch_model");
  const constraintsCard = artifacts.find((a) => a.type === "constraints");
  const models = artifacts.filter((a) => a.type === "data_model");
  const notes = artifacts.filter((a) => a.type === "markdown");
  const sources = artifacts.filter((a) => a.type === "source");
  const open = allDecisions.filter((d) => d.status === "proposed" || d.status === "contested");
  const md: string[] = [];
  md.push(`# ${title}: design document`, "", "## Overview", "", `Designed collaboratively by ${participants.join(", ") || "the participants"}. The canvas holds ${diagrams.length} diagram(s), ${models.length} data model(s), ${notes.length} note(s) and ${sources.length} source document(s); the registry records ${allDecisions.length} decision(s), ${allDecisions.filter((d) => d.status === "agreed").length} agreed.`, "");
  md.push("## Architecture", "");
  if (!diagrams.length) md.push("No diagrams on the canvas yet.", "");
  for (const d of diagrams) md.push(`### ${d.title} (v${d.versionNo})`, "", "```mermaid", contents.get(d.id) ?? "flowchart LR", "```", "");
  if (archModel) md.push(`### Components (from the architecture model, v${archModel.versionNo})`, "", "```text", contents.get(archModel.id) ?? "", "```", "");
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
  md.push("## Constraints", "");
  if (constraintsCard) md.push(...(contents.get(constraintsCard.id) ?? "").split("\n"), "");
  else md.push("None recorded.", "");
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

function extractConstraints(prompt: string): { id: string; kind: string; category: string; statement: string }[] {
  const out: { id: string; kind: string; category: string; statement: string }[] = [];
  const re = /^- (C-\d+) \[(\w+), (\w+)\] (.+?)(?: \((.+)\))?$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt))) out.push({ id: m[1]!, kind: m[2]!, category: m[3]!, statement: m[4]! });
  return out;
}

const REGION = /\b(eu|europe|european|us|usa|america|uk|apac|asia|india|china|germany|ireland|canada|australia)\b/i;
const PLACEMENT = /\b(bucket|region|store|stored|backup|back up|replicate|replicat\w*|host|hosted|deploy|deployed|copy|copies|datacenter|data center|cloud|s3|blob)\b/i;

/** A stated non-functional target or hard limit, or null. */
function constraintIn(text: string): { kind: "must" | "must_not" | "target"; category: "latency" | "availability" | "data_residency" | "security" | "compliance" | "budget" | "platform" | "capacity" | "other" } | null {
  const t = text.toLowerCase();
  if (/\b(must not|never|no|not)\b.*\b(leave|leaves|outside|off)\b/.test(t) && REGION.test(t)) return { kind: "must_not", category: "data_residency" };
  if (/\b(must|only|always)\b.*\b(stay|remain|kept|reside)\b.*\bin\b/.test(t) && REGION.test(t)) return { kind: "must", category: "data_residency" };
  if (/\b(p9\d|latency|response time)\b|\b(under|within|below) \d+ ?ms\b/.test(t)) return { kind: "target", category: "latency" };
  if (/\b(99\.9|uptime|availability|rpo|rto)\b/.test(t)) return { kind: "target", category: "availability" };
  if (/\b(budget|per month|a month|\$\d)/.test(t)) return { kind: "must", category: "budget" };
  if (/\b(gdpr|soc ?2|hipaa|pci|iso ?27001|compliance|audit trail)\b/.test(t)) return { kind: "must", category: "compliance" };
  if (/\b(must (use|run on|be built on|be hosted on)|only (use|run on))\b/.test(t)) return { kind: "must", category: "platform" };
  return null;
}

function nameFor(prompt: string, userId: string): string {
  const m = prompt.match(new RegExp(`^- (.+?) \\(id ${userId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")},`, "m"));
  return m?.[1] ?? userId;
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

// Rough token estimate (four characters per token) so demos show usage the way a real provider would.
const estimate = (prompt: string, output: string) => ({ inputTokens: Math.round(prompt.length / 4), outputTokens: Math.round(output.length / 4), premiumRequests: 0, model: "fake-architect-1" });

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
      return { text, toolCallsCount: 0, usage: estimate(req.context.prompt, text), modelUsed: "fake-architect-1" };
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
      return { text, toolCallsCount: toolCalls, usage: estimate(req.context.prompt, text), modelUsed: "fake-architect-1" };
    }

    // 0c. Outbound action: "publish/create/upload ... to confluence/jira/github" uses the speaker's own MCP tool.
    const commitAdrs = batch.find((m) => /\b(commit|push|write|export)\b/i.test(m.text) && /\b(adrs?|decision records?)\b/i.test(m.text));
    if (commitAdrs) {
      const fileTool = req.mcpServers.flatMap((s) => s.tools.map((t) => ({ server: s, tool: t }))).find(({ tool }) => /create_file|create_or_update_file|push_files|write_file|commit/i.test(tool.name));
      if (!fileTool) {
        await emit(`${commitAdrs.speaker}, I can write the decision records to a repository once you register a tool that can create files there (credentials → External tools).`);
        return { text, toolCallsCount: 0, usage: estimate(req.context.prompt, text), modelUsed: "fake-architect-1" };
      }
      const rendered = (await call("render_adr", {})) as { status: string; files?: { filename: string; markdown: string; label: string }[] };
      const files = rendered.files ?? [];
      const repo = commitAdrs.text.match(/\b([\w.-]+\/[\w.-]+)\b/)?.[1] ?? "acme/order-platform";
      let written = 0;
      let denied = 0;
      for (const f of files) {
        const args = { repo, path: f.filename, content: f.markdown, message: `${f.label}: architecture decision record` };
        const { callId, decision } = await req.external.ask(fileTool.server, fileTool.tool.name, args, fileTool.tool.readOnly);
        if (decision !== "approved") {
          denied += 1;
          continue;
        }
        try {
          const r = await callMcpTool(fileTool.server.config, fileTool.tool.name, args);
          req.external.done(callId, r.ok, r.text);
          if (r.ok) written += 1;
        } catch (e) {
          req.external.done(callId, false, (e as Error).message);
        }
      }
      await emit(`Wrote ${written} of ${files.length} decision record${files.length === 1 ? "" : "s"} to ${repo} under docs/adr${denied ? ` (${denied} not approved)` : ""}.`);
      return { text, toolCallsCount: files.length, usage: estimate(req.context.prompt, text), modelUsed: "fake-architect-1" };
    }

    const outbound = batch.find((m) => /\b(publish|upload|push|create|open|file)\b/i.test(m.text) && /\b(confluence|jira|github|page|stor(y|ies)|epics?|tickets?|issues?|repo|wiki)\b/i.test(m.text));
    if (outbound) {
      const wantsTicket = /\b(jira|stor(y|ies)|epics?|tickets?|issues?)\b/i.test(outbound.text);
      const pick = req.mcpServers.flatMap((s) => s.tools.map((t) => ({ server: s, tool: t }))).find(({ tool }) => (wantsTicket ? /story|issue|ticket|epic/i.test(tool.name) : /publish|page|create_page|upload/i.test(tool.name)));
      if (!pick) {
        await emit(`${outbound.speaker}, I can do that once you register a tool for it: credentials → External tools. I have no external tool registered for you.`);
        return { text, toolCallsCount: 0, usage: estimate(req.context.prompt, text), modelUsed: "fake-architect-1" };
      }
      const doc = artifacts.find((a) => a.type === "design_doc") ?? artifacts.find((a) => a.type === "mermaid");
      const args = wantsTicket
        ? { project: outbound.text.match(/\b([A-Z]{2,6})\b(?!.*\b[A-Z]{2,6}\b)/)?.[1] ?? "ORD", summary: `Implement ${doc?.title ?? "the design"}`, description: `From Tandem session ${req.sessionId}` }
        : { space: outbound.text.match(/\b(?:space|under|to)\s+([A-Z]{2,8})\b/)?.[1] ?? "ARCH", title: doc?.title ?? "Design document", body: `Exported from Tandem session ${req.sessionId} (${doc?.id ?? "no document yet"}).` };
      await emit(`Asking ${outbound.speaker} to approve ${pick.server.name}.${pick.tool.name}… `);
      const { callId, decision } = await req.external.ask(pick.server, pick.tool.name, args, pick.tool.readOnly);
      if (decision !== "approved") {
        await emit("That was not approved, so nothing was sent.");
        return { text, toolCallsCount: 0, usage: estimate(req.context.prompt, text), modelUsed: "fake-architect-1" };
      }
      try {
        const r = await callMcpTool(pick.server.config, pick.tool.name, args);
        req.external.done(callId, r.ok, r.text);
        await emit(r.ok ? `Done: ${r.text}` : `The tool reported an error: ${r.text}`);
      } catch (e) {
        req.external.done(callId, false, (e as Error).message);
        await emit(`The tool failed: ${(e as Error).message}`);
      }
      return { text, toolCallsCount: 1, usage: estimate(req.context.prompt, text), modelUsed: "fake-architect-1" };
    }

    // 0f. A message written on a card or a component (a thread promoted from the canvas): "this"
    //     is that thing. Move it into a boundary or rename it when asked; otherwise record the point.
    const anchored = batch.filter((m) => m.about);
    if (anchored.length) {
      const modelArt = artifacts.find((a) => a.type === "arch_model");
      const modelNow = modelArt ? ((await call("read_artifact", { artifactId: modelArt.id })) as { content?: ArchModelContent }).content : undefined;
      const componentIn = (id: string) => {
        const c = modelNow?.components.find((x) => x.id === id);
        return c ? { name: c.name, kind: c.kind } : null;
      };
      for (const m of anchored) {
        const a = m.about!;
        const c = a.componentId ? componentIn(a.componentId) : null;
        const bm = m.text.match(/(?:belongs|goes|should (?:be|sit|live)|put (?:this|it)|move (?:this|it)) (?:in|to|into|inside) (?:a |the )?([\w -]+?)(?: (boundary|tier|zone))?(?:[,.!]|$)/i);
        // "a data tier boundary" names the boundary "data tier"; "the payments zone" keeps its word.
        const boundaryName = bm ? `${bm[1]!.trim().replace(/\s+boundary$/i, "")}${bm[2] && bm[2].toLowerCase() !== "boundary" ? ` ${bm[2]}` : ""}` : null;
        const rename = m.text.match(/\b(?:rename|call) (?:this|it)(?: to)? ["“]?(.+?)["”]?[.!]?$/i)?.[1] ?? null;
        if (c && a.componentId && (boundaryName || rename)) {
          await call("upsert_components", {
            components: [{ id: a.componentId, name: rename ?? c.name, kind: c.kind, ...(boundaryName ? { boundary: slugId(boundaryName) } : {}) }],
            derivedFrom: [m.eventId],
            rationale: `${m.speaker} asked for it in a thread on ${a.label}`,
          });
          await emit(rename ? `Renamed ${c.name} to ${rename} on the architecture model; every view follows. ` : `Moved ${c.name} into the ${boundaryName} boundary on the architecture model; the System architecture view follows. `);
        } else {
          await emit(`On ${a.label}: noted, ${m.speaker}. `);
        }
        const r = await call("record_decision", {
          statement: m.text.replace(/\.$/, ""),
          status: "agreed",
          agreedBy: [userIdFor(req.context.prompt, m.speaker)],
          supersedes: null,
          evidence: [m.eventId],
          about: a.componentId ? [a.componentId] : [],
          context: `${m.speaker} raised this in a thread on ${a.label}.`,
          consequences: c ? "Applied to the architecture model." : "Recorded against the card it was written on.",
        });
        if (r.status === "recorded") await emit(`Recorded ${r.label} for ${m.speaker}.`);
      }
      return { text, toolCallsCount: toolCalls, usage: estimate(req.context.prompt, text), modelUsed: "fake-architect-1" };
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
        return { text, toolCallsCount: toolCalls, usage: estimate(req.context.prompt, text), modelUsed: "fake-architect-1" };
      }
      const relations = tables[0] && events.length ? events.map((e) => ({ from: tables[0]!, to: `${e.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase()}_events`, cardinality: "1-n" as const, label: "emits", derivedFrom: ev })) : [];
      const existing = artifacts.find((a) => a.type === "data_model");
      const content = { entities, relations, sections: [{ id: "entities", derivedFrom: ev }] };
      if (existing) await call("update_artifact", { artifactId: existing.id, baseVersionNo: existing.versionNo, content, rationale: "Refresh data model from the discussion", summary: `Data model: ${entities.map((e) => e.name).join(", ")}` });
      else await call("create_artifact", { type: "data_model", title: "Data model", content, rationale: "Drafted from the tables and events named so far", summary: `Data model: ${entities.map((e) => e.name).join(", ")}` });
      await emit(`Drafted the data model with ${entities.map((e) => e.name).join(", ")}${relations.length ? ` and ${relations.length} relation(s)` : ""}. Tell me the fields you actually need and I will refine it.`);
      return { text, toolCallsCount: toolCalls, usage: estimate(req.context.prompt, text), modelUsed: "fake-architect-1" };
    }

    // 0i. As-is from code: "draw the current architecture of repository X" reads the repository's
    //     manifests through the speaker's own read-only tool (or an attached compose file) and
    //     sets the model's as-is baseline. Manifests only; never the source tree.
    const asIsMsg = batch.find((m) => /\b(current|as-is|existing)\b.*\barchitecture\b/i.test(m.text) && /\b(draw|map|capture|import|show|build|scan|read)\b/i.test(m.text));
    if (asIsMsg) {
      const repo = asIsMsg.text.match(/\brepo(?:sitory)?\s+["']?([\w./-]+?)["']?(?:[.,!?]|$)/i)?.[1] ?? null;
      const files: RepoFile[] = [];
      let source = "";
      const contentsNow = extractContents(req.context.prompt);
      const attached = artifacts.filter((a) => a.type === "source" && /(compose[\w.-]*\.ya?ml|package\.json|go\.mod|pom\.xml|requirements\.txt)$/i.test(a.title)).map((a) => ({ path: a.title, text: contentsNow.get(a.id) ?? "" })).filter((f) => f.text);
      if (repo) {
        const tools = req.mcpServers.flatMap((s) => s.tools.map((t) => ({ server: s, tool: t })));
        const treeTool = tools.find(({ tool }) => tool.readOnly && /tree|list_files|ls|list_dir/i.test(tool.name));
        const fileTool = tools.find(({ tool }) => tool.readOnly && /file_contents|read_file|get_file|repo_file|cat/i.test(tool.name));
        if (!treeTool || !fileTool) {
          await emit(`${asIsMsg.speaker}, I can read ${repo} once you register a read-only repository tool (credentials → External tools), or attach its docker-compose.yml or package.json.`);
          return { text, toolCallsCount: 0, usage: estimate(req.context.prompt, text), modelUsed: "fake-architect-1" };
        }
        const readTool = async (pick: typeof treeTool, args: Record<string, unknown>): Promise<string | null> => {
          const { callId, decision } = await req.external.ask(pick.server, pick.tool.name, args, pick.tool.readOnly);
          if (decision !== "approved") return null;
          try {
            const r = await callMcpTool(pick.server.config, pick.tool.name, args);
            req.external.done(callId, r.ok, r.ok ? `${String(r.text).length} characters` : r.text);
            return r.ok ? String(r.text) : null;
          } catch (e) {
            req.external.done(callId, false, (e as Error).message);
            return null;
          }
        };
        const tree = await readTool(treeTool, { repo });
        if (tree === null) {
          await emit(`Could not list ${repo} with ${treeTool.server.name}.${treeTool.tool.name}.`);
          return { text, toolCallsCount: 1, usage: estimate(req.context.prompt, text), modelUsed: "fake-architect-1" };
        }
        const paths = manifestPaths(tree.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
        for (const p of paths) {
          const body = await readTool(fileTool, { repo, path: p });
          if (body !== null) files.push({ path: p, text: body });
        }
        source = `repo:${repo}`;
        await emit(`Read ${files.length} manifest${files.length === 1 ? "" : "s"} from ${repo} (${paths.join(", ") || "none found"}). `);
      } else if (attached.length) {
        files.push(...attached);
        source = `upload:${attached.map((f) => f.path).join(",")}`;
      } else {
        await emit(`${asIsMsg.speaker}, name the repository ("the current architecture of repository owner/name") with a read-only repository tool registered, or attach a docker-compose.yml or package.json.`);
        return { text, toolCallsCount: 0, usage: estimate(req.context.prompt, text), modelUsed: "fake-architect-1" };
      }
      const scan = scanRepo(files, repo ?? attached[0]!.path.replace(/\.[^.]+$/, ""));
      if (!scan.components.length) {
        await emit(`Nothing to draw: ${scan.notes.join("; ")}.`);
        return { text, toolCallsCount: toolCalls, usage: estimate(req.context.prompt, text), modelUsed: "fake-architect-1" };
      }
      const r = (await call("set_as_is", { source, components: scan.components, relationships: scan.relationships, notes: scan.notes, derivedFrom: [asIsMsg.eventId], rationale: `As-is read from ${source} for ${asIsMsg.speaker}` })) as { status: string; components?: number; modelReplaced?: boolean };
      if (r.status === "as_is_set") await emit(`Captured the as-is: ${scan.components.map((c) => c.name).join(", ")}${r.modelReplaced ? ". The model now equals it; changes from here are the target state, and the As-is vs to-be view shows them." : ". The model keeps the target state; the As-is vs to-be view shows the difference."}`);
      else await emit(`Could not record the as-is: ${r.status}.`);
      return { text, toolCallsCount: toolCalls, usage: estimate(req.context.prompt, text), modelUsed: "fake-architect-1" };
    }

    // 0h. "Explore alternatives": three candidate architectures built from the current model,
    //     side by side, with the constraints each meets or strains. The model itself is untouched.
    const explore = batch.find((m) => /\b(explore|compare|propose|show|give)\b.*\balternatives?\b|\balternatives? (for|to)\b/i.test(m.text));
    if (explore) {
      const modelArt = artifacts.find((a) => a.type === "arch_model");
      const cur = modelArt ? ((await call("read_artifact", { artifactId: modelArt.id })) as { content?: ArchModelContent }).content : undefined;
      if (!cur || cur.components.length === 0) {
        await emit("There is no architecture model yet to build alternatives from. Describe the systems involved first.");
        return { text, toolCallsCount: toolCalls, usage: estimate(req.context.prompt, text), modelUsed: "fake-architect-1" };
      }
      const ks = extractConstraints(req.context.prompt);
      const ids = ks.map((k) => k.id);
      const strip = (c: ArchModelContent["components"][number]) => ({ id: c.id, name: c.name, kind: c.kind, technology: c.technology, boundary: c.boundary });
      const rel = (r: ArchModelContent["relationships"][number]) => ({ from: r.from, to: r.to, kind: r.kind, label: r.label });
      const queues = cur.components.filter((c) => c.kind === "queue").map((c) => c.id);
      const services = cur.components.filter((c) => c.kind === "service").map((c) => c.id);
      const asIs = { title: "Keep the current design", summary: "The architecture as it stands on the model today.", components: cur.components.map(strip), relationships: cur.relationships.map(rel), pros: ["No rework", "Already agreed piece by piece"], cons: ["Nothing improves"], constraintsMet: ids, constraintsAtRisk: [] as string[] };
      let second;
      if (queues.length) {
        const direct: ReturnType<typeof rel>[] = cur.relationships.filter((r) => !queues.includes(r.from) && !queues.includes(r.to)).map(rel);
        for (const q of queues) {
          const pubs = cur.relationships.filter((r) => r.to === q && r.kind === "publishes");
          const subs = cur.relationships.filter((r) => r.to === q && r.kind === "subscribes");
          for (const p of pubs) for (const s of subs) if (p.from !== s.from) direct.push({ from: p.from, to: s.from, kind: "calls", label: p.label });
        }
        second = { title: "Direct calls instead of the queue", summary: `Drop ${queues.map((q) => cur.components.find((c) => c.id === q)?.name ?? q).join(", ")}; producers call consumers synchronously.`, components: cur.components.filter((c) => !queues.includes(c.id)).map(strip), relationships: direct, pros: ["Simpler to operate", "Lower end-to-end latency"], cons: ["Callers fail when a consumer is down", "Tighter coupling"], constraintsMet: ks.filter((k) => k.category === "latency").map((k) => k.id), constraintsAtRisk: ks.filter((k) => k.category === "availability").map((k) => k.id) };
      } else {
        second = { title: "Introduce an event bus", summary: "Services publish events to a bus instead of calling each other.", components: [...cur.components.map(strip), { id: "event-bus", name: "Event bus", kind: "queue" as const }], relationships: [...cur.relationships.filter((r) => !(services.includes(r.from) && services.includes(r.to))).map(rel), ...services.flatMap((s) => [{ from: s, to: "event-bus", kind: "publishes" as const }, { from: s, to: "event-bus", kind: "subscribes" as const }])], pros: ["Loose coupling", "Replayable history"], cons: ["Eventual consistency", "One more system to run"], constraintsMet: ks.filter((k) => k.category === "availability").map((k) => k.id), constraintsAtRisk: ks.filter((k) => k.category === "latency").map((k) => k.id) };
      }
      const third = { title: "Add a read model", summary: "Keep the current flow and add a read-optimised store the services query.", components: [...cur.components.map(strip), { id: "read-model", name: "Read model", kind: "database" as const, technology: "Redis" }], relationships: [...cur.relationships.map(rel), ...services.map((s) => ({ from: s, to: "read-model", kind: "reads" as const, label: "hot reads" }))], pros: ["Fast reads", "Isolates read load"], cons: ["Another store to keep in sync"], constraintsMet: ids, constraintsAtRisk: ks.filter((k) => k.category === "budget").map((k) => k.id) };
      const r = (await call("propose_alternatives", { question: explore.text.replace(/^(explore|compare|propose|show|give)( (me|us))?( (the|some|two|three))? alternatives?( (for|to))?\s*/i, "").replace(/[.?]$/, "").trim() ? `Which architecture for ${explore.text.replace(/^(explore|compare|propose|show|give)( (me|us))?( (the|some|two|three))? alternatives?( (for|to))?\s*/i, "").replace(/[.?]$/, "").trim()}?` : "Which architecture should we adopt?", candidates: [asIs, second, third], derivedFrom: [explore.eventId], rationale: `Alternatives requested by ${explore.speaker}` })) as { status: string; candidates?: { id: string; title: string }[] };
      if (r.status === "alternatives_proposed") await emit(`Three candidates side by side: ${r.candidates!.map((c) => `${c.id.toUpperCase()}. ${c.title}`).join("; ")}. The model is unchanged; press Decide on the card to vote, and the winner becomes the model.`);
      else await emit(`Could not propose alternatives: ${r.status}.`);
      return { text, toolCallsCount: toolCalls, usage: estimate(req.context.prompt, text), modelUsed: "fake-architect-1" };
    }

    // 0g. Relaxing or dropping a constraint: "Exception to C-01: …" or "Remove C-01". The setter has
    //     to agree, so the tool answers pending_approval when the speaker is someone else.
    for (const m of batch) {
      const exc = m.text.match(/^(?:(?:add |make )?(?:an? )?exception (?:to|for)|amend) (C-\d+)\s*[:,-]?\s*(.+)$/i);
      const rm = m.text.match(/^(?:remove|drop|delete) (C-\d+)\b/i);
      if (!exc && !rm) continue;
      const cid = (exc?.[1] ?? rm![1]!).toUpperCase();
      const r = exc
        ? await call("upsert_constraints", { constraints: [{ statement: exc[2]!.replace(/\.$/, ""), kind: constraintIn(exc[2]!)?.kind ?? "must", category: constraintIn(exc[2]!)?.category ?? "other", source: m.eventId, exceptionTo: cid }], derivedFrom: [m.eventId], rationale: `${m.speaker} asked for an exception to ${cid}` })
        : await call("remove_constraints", { constraintIds: [cid], rationale: `${m.speaker} asked to remove ${cid}` });
      if (r.status === "pending_approval") await emit(`${exc ? `The exception to ${cid}` : `Removing ${cid}`} is proposed to ${r.approvers.map((u) => nameFor(req.context.prompt, u)).join(", ")}, who set it; nothing changes until they approve. `);
      else if (r.status === "constraints_updated") await emit(exc ? `Recorded the exception to ${cid} as ${r.constraints[r.constraints.length - 1]!.id}. ` : `Removed ${cid}. `);
      else await emit(`Could not change ${cid}: ${"message" in r ? r.message : r.status}. `);
      return { text, toolCallsCount: toolCalls, usage: estimate(req.context.prompt, text), modelUsed: "fake-architect-1" };
    }

    // 0d. A stated constraint: record it, attributed to the speaker.
    const stated = batch.map((m) => ({ m, k: constraintIn(m.text) })).filter((x): x is { m: (typeof batch)[number]; k: NonNullable<ReturnType<typeof constraintIn>> } => Boolean(x.k));
    if (stated.length && !batch.some((m) => /decision point .* resolved/i.test(m.text))) {
      const r = (await call("upsert_constraints", {
        constraints: stated.map(({ m, k }) => ({ statement: m.text.replace(/\.$/, ""), kind: k.kind, category: k.category, source: m.eventId })),
        derivedFrom: stated.map(({ m }) => m.eventId),
        rationale: `Stated by ${stated.map(({ m }) => m.speaker).join(", ")}`,
      })) as { status: string; constraints?: { id: string; statement: string }[] };
      const ids = (r.constraints ?? []).slice(-stated.length).map((k) => k.id);
      await emit(`Recorded ${ids.length === 1 ? `constraint ${ids[0]}` : `constraints ${ids.join(", ")}`} for ${stated.map(({ m }) => m.speaker).join(", ")}; every change from here is checked against ${ids.length === 1 ? "it" : "them"}.`);
      return { text, toolCallsCount: toolCalls, usage: estimate(req.context.prompt, text), modelUsed: "fake-architect-1" };
    }

    // 0e. A directive that would break a recorded constraint: raise a decision point, change nothing.
    const constraints = extractConstraints(req.context.prompt);
    for (const msg of batch) {
      const t = msg.text.toLowerCase();
      const hit = constraints.find((k) => {
        if (k.kind !== "must_not") return false;
        const kr = k.statement.match(REGION)?.[1]?.toLowerCase();
        const mr = t.match(REGION)?.[1]?.toLowerCase();
        if (kr && mr && kr !== mr && PLACEMENT.test(t)) return true; // data must stay in one region, directive puts it in another
        const named = tokenise(k.statement).filter((w) => !["data", "must", "leave", "leaves", "outside"].includes(w));
        return named.length > 0 && named.every((w) => t.includes(w)) && !/\b(not|never|no)\b/.test(t);
      });
      if (!hit) continue;
      const blocks = artifacts.filter((a) => a.type === "mermaid" || a.type === "view" || a.type === "arch_model").map((a) => a.id);
      await emit(`${msg.speaker}, that would break ${hit.id} ("${hit.statement}"). I have not changed the canvas. `);
      await call("create_decision_point", {
        question: `Keep ${hit.id} or make an exception for ${msg.speaker}'s request?`,
        context: `${hit.id} says: ${hit.statement}. ${msg.speaker} now asks: "${msg.text}".`,
        options: [
          { id: "keep", title: `Keep ${hit.id}`, tradeoffs: "The request is declined; the constraint holds.", canvasImpact: "No change." },
          { id: "exception", title: "Make an exception for this case", tradeoffs: "The constraint stands in general but this case is allowed and recorded.", canvasImpact: "The change is applied with a note.", proposedBy: userIdFor(req.context.prompt, msg.speaker) },
          { id: "amend", title: `Amend ${hit.id}`, tradeoffs: "The constraint is rewritten; whoever set it should agree.", canvasImpact: "The constraints card changes, then the request is applied." },
        ],
        blocksArtifactIds: blocks,
        directiveEventIds: [msg.eventId],
        contradictsDecisionId: null,
        violatesConstraintIds: [hit.id],
      });
      await emit("I raised a decision point naming the constraint; vote on the card and I will apply the outcome.");
      return { text, toolCallsCount: toolCalls, usage: estimate(req.context.prompt, text), modelUsed: "fake-architect-1" };
    }

    // 1. Contradiction check: a directive that shares vocabulary with an agreed decision and contains a negation word.
    const negation = /\b(drop|remove|instead|replace|not|no longer|rather than|switch)\b/i;
    for (const msg of batch) {
      if (!negation.test(msg.text)) continue;
      const words = new Set(tokenise(msg.text));
      const hit = decisions.find((d) => d.status === "agreed" && tokenise(d.statement).filter((w) => words.has(w)).length >= 2);
      if (hit) {
        const blocks = artifacts.filter((a) => a.type === "mermaid" || a.type === "view" || a.type === "arch_model").map((a) => a.id);
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
        return { text, toolCallsCount: toolCalls, usage: estimate(req.context.prompt, text), modelUsed: "fake-architect-1" };
      }
    }

    // 2. Resolution of a decision point (synthetic system directive).
    const resolution = batch.find((m) => /decision point .* resolved/i.test(m.text));
    if (resolution) {
      const optM = resolution.text.match(/option "([^"]+)"/);
      const supersedes = resolution.text.match(/supersedes decision ([^\s.]+)/)?.[1] ?? null;
      const chosen = optM?.[1] ?? "the chosen option";
      const dpArt = artifacts.find((a) => a.type === "decision_point");
      const dpContent = dpArt ? ((await call("read_artifact", { artifactId: dpArt.id })) as { content?: { question?: string; context?: string; options?: { title: string; tradeoffs?: string }[] } }).content : undefined;
      const r = await call("record_decision", {
        statement: `Resolved: ${chosen}`,
        status: "agreed",
        agreedBy: (resolution.text.match(/voters: ([^)]+)\)/)?.[1] ?? "").split(",").map((s) => userIdFor(req.context.prompt, s.trim())).filter(Boolean),
        supersedes,
        evidence: [resolution.eventId],
        context: dpContent?.context ?? `The group had to settle: ${dpContent?.question ?? "a contested change"}.`,
        options: (dpContent?.options ?? []).map((o) => ({ title: o.title, tradeoffs: o.tradeoffs, chosen: o.title === chosen })),
        consequences: `The canvas follows "${chosen}"; anything that assumed the superseded decision needs revisiting.`,
      });
      const view = artifacts.find((a) => a.type === "view") ?? artifacts.find((a) => a.type === "mermaid");
      if (view && view.type === "view") {
        const cur = await call("read_artifact", { artifactId: view.id });
        const content = ((cur as { content?: Record<string, unknown> }).content ?? { kind: "container", sections: [] }) as Record<string, unknown>;
        await call("update_artifact", {
          artifactId: view.id,
          baseVersionNo: view.versionNo,
          content: { ...content, note: `Resolved: ${chosen}`, sections: [{ id: "resolution", derivedFrom: [resolution.eventId] }] },
          rationale: "Apply the resolved decision point",
          summary: `${view.title} (updated for ${chosen})`,
        });
      } else if (view) {
        const cur = await call("read_artifact", { artifactId: view.id });
        const src = (cur as { content?: { source?: string } }).content?.source ?? "flowchart LR";
        await call("update_artifact", { artifactId: view.id, baseVersionNo: view.versionNo, content: { source: `${src}\n  note[/"${chosen}"/]`, kind: "flowchart", sections: [{ id: "resolution", derivedFrom: [resolution.eventId] }] }, rationale: "Apply the resolved decision point", summary: `${view.title} (updated for ${chosen})` });
      }
      await emit(`Applied the resolution: ${chosen}. Recorded as ${(r as { label?: string }).label ?? "a decision"}.`);
      return { text, toolCallsCount: toolCalls, usage: estimate(req.context.prompt, text), modelUsed: "fake-architect-1" };
    }

    // 3. Ordinary directives: grow the architecture model (components + relationships), keep a
    //    container view of it, and record one decision per directive.
    const names = [...new Set(batch.flatMap((m) => serviceNames(m.text)))];
    const kindOf = (n: string): "service" | "queue" | "database" | "storage" | "external" => {
      if (/kafka|rabbitmq|sqs|pubsub/i.test(n)) return "queue";
      if (/postgres|mysql|mongodb|dynamodb|redis|cassandra/i.test(n)) return "database";
      if (/\bs3\b|blob|bucket/i.test(n)) return "storage";
      if (/gateway/i.test(n)) return "service";
      if (/^service |^app |^application |^system /i.test(n)) return "service";
      return "external";
    };
    const verbKind = (t: string): "publishes" | "subscribes" | "writes" | "reads" | "calls" | "uses" => {
      const v = t.match(/\b(publish|publishes|emit|emits|send|sends|subscribe|subscribes|listen|listens|write|writes|save|saves|read|reads|call|calls)\b/i)?.[1]?.toLowerCase() ?? "uses";
      if (/^(publish|emit|send)/.test(v)) return "publishes";
      if (/^(subscribe|listen)/.test(v)) return "subscribes";
      if (/^(write|save)/.test(v)) return "writes";
      if (/^read/.test(v)) return "reads";
      if (/^call/.test(v)) return "calls";
      return "uses";
    };
    const sections = batch.map((m) => ({ id: `msg-${m.eventId.slice(-6)}`, derivedFrom: [m.eventId] }));
    if (names.length > 0) {
      const derivedFrom = batch.map((m) => m.eventId);
      await call("upsert_components", {
        components: names.map((n) => ({ id: slugId(n), name: n, kind: kindOf(n) })),
        derivedFrom,
        rationale: `Components named by ${batch.map((m) => m.speaker).join(", ")}`,
      });
      const rels: { from: string; to: string; kind: ReturnType<typeof verbKind>; label?: string }[] = [];
      for (const m of batch) {
        const ns = serviceNames(m.text);
        const label = m.text.match(/\b([A-Z][A-Za-z]+) event\b/)?.[1];
        for (let i = 0; i + 1 < ns.length; i++) rels.push({ from: slugId(ns[i]!), to: slugId(ns[i + 1]!), kind: verbKind(m.text), label });
      }
      if (rels.length) await call("upsert_relationships", { relationships: rels, derivedFrom, rationale: "Relationships stated in the discussion" });
      const view = artifacts.find((a) => a.type === "view" && /architecture/i.test(a.title));
      if (!view) {
        await call("create_artifact", { type: "view", title: "System architecture", content: { kind: "container", sections }, rationale: "Container view of the architecture model", summary: "Container view generated from the architecture model" });
        await emit(`Added ${names.join(", ")} to the architecture model and created the System architecture view. `);
      } else {
        await emit(`Updated the architecture model with ${names.join(", ")}; the System architecture view reflects it. `);
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
        about: serviceNames(m.text).map(slugId),
        context: `${m.speaker} stated this while describing the system.`,
        consequences: "Reflected in the architecture model and its views.",
      });
      if (r.status === "recorded") await emit(`Recorded ${r.label} for ${m.speaker}. `);
    }
    await emit("Anything you want me to elaborate, or shall I draft the data model next?");
    return { text, toolCallsCount: toolCalls, usage: estimate(req.context.prompt, text), modelUsed: "fake-architect-1" };
  },
};
