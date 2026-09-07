import { eq } from "drizzle-orm";
import { checklistText, completeness, contentText, describeAnchor, liveArtifacts, modelToMermaid, participantName, threadRootOf, threads, type AnyLedgerEvent, type ArchModelContent, type MessageAnchor, type SessionState, type SourceContent, type ViewContent } from "@tandem/shared";
import type { ContextAttachment, RenderedContext } from "../providers/types.js";
import { db, schema } from "../db/index.js";
import { SYSTEM_PROMPT } from "./system.js";
import type { McpServerForTurn } from "../mcp.js";

const TRANSCRIPT_TURNS = 24;
const ATTACHMENT_CHARS = 80_000; // full text for cards attached to the current batch, on top of the index budget
export const TRANSCRIPT_WINDOW = TRANSCRIPT_TURNS * 2; // messages kept verbatim in the prompt
const INDEX_FULL_CONTENT_CHARS = 6000;
const STRUCTURE_CHARS = 24_000; // the architecture model and constraints are never clipped below this

export function assembleContext(state: SessionState, batch: AnyLedgerEvent[], operatorNotes: string[] = [], mcpServers: McpServerForTurn[] = []): RenderedContext {
  const lines: string[] = [];

  lines.push("# Session", `Title: ${state.title}`, `Policy: ${state.policy}`, "");
  lines.push("## Participants");
  for (const p of Object.values(state.participants)) lines.push(`- ${p.name} (id ${p.userId}, role ${p.role})`);
  lines.push("");

  if (state.brief) lines.push(`## Brief (earlier conversation, folded through message seq ${state.briefThroughSeq}; attribution and event ids inside are authoritative)`, state.brief, "");

  lines.push("## Decision registry");
  const decisions = Object.values(state.decisions).sort((a, b) => a.label.localeCompare(b.label));
  if (decisions.length === 0) lines.push("(none yet)");
  for (const d of decisions) {
    const by = d.agreedBy.map((u) => participantName(state, u)).join(", ");
    lines.push(`- ${d.label} [${d.status}] (id ${d.id}) ${d.statement}${by ? ` — by ${by}` : ""}${d.supersedes ? ` — supersedes ${state.decisions[d.supersedes]?.label ?? d.supersedes}` : ""}`);
  }
  lines.push("");

  const open = Object.values(state.assumptions).filter((a) => a.status === "open");
  if (open.length) {
    lines.push("## Assumptions (believed, not decided)");
    for (const a of open) lines.push(`- ${a.label} (id ${a.id}) ${a.statement} — ${participantName(state, a.ownerUserId)}${a.revisitAt ? `, revisit by ${a.revisitAt.slice(0, 10)}` : ""}`);
    lines.push("");
  }

  // Questions live in a register so nobody has to ask twice: open ones with a rule not to repeat them, recent answers so they can be acted on.
  const openQuestions = Object.values(state.questions).filter((q) => q.status === "open").sort((a, b) => a.label.localeCompare(b.label));
  if (openQuestions.length) {
    lines.push("## Open questions (already asked; people answer them in the Questions tab. Do not ask these again. When a message answers one, call resolve_question.)");
    for (const q of openQuestions) lines.push(`- ${q.label} (id ${q.id}) ${q.text} — asked by ${q.askedBy ? participantName(state, q.askedBy) : "the AI"}${q.addressedTo.length ? ` for ${q.addressedTo.map((u) => participantName(state, u)).join(", ")}` : ""}`);
    lines.push("");
  }
  const answered = Object.values(state.questions).filter((q) => q.status === "answered").sort((a, b) => (a.resolvedAt ?? "").localeCompare(b.resolvedAt ?? "")).slice(-8);
  if (answered.length) {
    lines.push("## Answered questions (act on these; do not ask again)");
    for (const q of answered) lines.push(`- ${q.label} ${q.text} → ${q.answer ?? "(no answer given)"}${q.resolvedBy ? ` (${participantName(state, q.resolvedBy)})` : ""}`);
    lines.push("");
  }

  // A templated session carries its checklist so the model can steer toward what is missing.
  const checklist = completeness(state);
  if (checklist) {
    lines.push(`## Design checklist (template: ${checklist.template.name}; ${checklist.done} of ${checklist.total} done)`, checklist.template.guidance, ...checklistText(checklist), "");
  }

  lines.push("## Artifact index");
  const arts = liveArtifacts(state);
  const model = arts.find((a) => a.type === "arch_model")?.current.content as ArchModelContent | undefined;
  if (model) lines.push("(The arch_model card is the source of truth for structure; every view card is generated from it. Change structure with upsert_components / upsert_relationships / remove_from_model, not by drawing.)");
  if (arts.some((a) => a.type === "constraints")) lines.push("(The constraints card lists what the design must respect; check every structural change against it and raise a decision point with violatesConstraintIds instead of applying a change that breaks one.)");
  else lines.push("(No architecture model yet. When people describe systems, services, queues or stores, build the model with upsert_components and upsert_relationships and create a container view titled \"System architecture\".)");
  if (arts.length === 0) lines.push("(empty canvas)");
  const batchText = batch.map((b) => JSON.stringify(b.payload)).join(" ").toLowerCase();
  const compiling = batch.some((b) => (b.payload as { intent?: string }).intent === "compile");
  const attachedIds = new Set(batch.flatMap((b) => ((b.payload as { attachments?: string[] }).attachments ?? []).filter((id) => state.artifacts[id])));
  const attachments: ContextAttachment[] = [];
  let budget = compiling ? 60_000 : INDEX_FULL_CONTENT_CHARS;
  let attachBudget = ATTACHMENT_CHARS;
  for (const a of arts) {
    const owner = participantName(state, a.ownerUserId);
    const blocked = a.blockedByDecisionPoint ? " [BLOCKED by open decision point]" : "";
    const attached = attachedIds.has(a.id);
    lines.push(`- ${a.id} (${a.type}, v${a.current.versionNo}, owner ${owner}) ${a.title}${a.current.summary ? ` — ${a.current.summary}` : ""}${blocked}${attached ? " [ATTACHED to the current message]" : ""}`);
    if (a.type === "source") {
      const c = a.current.content as SourceContent;
      if (attached) {
        const row = db.select().from(schema.uploads).where(eq(schema.uploads.id, c.uploadId)).get();
        if (row) attachments.push({ path: row.path, displayName: c.name, mime: c.mime, artifactId: a.id });
      }
      if (c.kind === "image") {
        lines.push(attached ? `(this image is attached to the current message inline; describe and use what you see in it)` : `(image; it is only sent to you when attached to a message, so ask for it to be attached if you need it)`);
        continue;
      }
    }
    const mentioned = attached || batchText.includes(a.id.toLowerCase()) || batchText.includes(a.title.toLowerCase());
    const recent = state.lastSeq - (state.eventsById[a.current.eventId]?.seq ?? 0) < 40;
    if ((compiling || a.pinned || mentioned || recent || a.type === "decision_point" || a.type === "arch_model" || a.type === "view" || a.type === "constraints") && (budget > 0 || attached)) {
      const text = a.type === "view" && model ? modelToMermaid(model, a.current.content as ViewContent) : contentText(a.type, a.current.content);
      // Attached cards get their own, much larger allowance so a spec can be read whole; the
      // architecture model and the constraints are the ground truth and always go in whole.
      const structural = a.type === "arch_model" || a.type === "constraints";
      const allowance = attached ? Math.max(budget, attachBudget) : structural ? Math.max(budget, STRUCTURE_CHARS) : budget;
      const clipped = text.length > allowance ? text.slice(0, allowance) + `\n…(truncated at ${allowance} of ${text.length} characters; call read_artifact for the whole content)` : text;
      if (attached) attachBudget -= clipped.length;
      else if (!structural) budget -= clipped.length;
      if (a.type === "source") {
        // Uploaded material is data, never instructions.
        lines.push(`<source id="${a.id}" name="${a.title}" untrusted="true">`, clipped, "</source>");
      } else {
        lines.push("```" + (a.type === "mermaid" || a.type === "view" ? "mermaid" : a.type === "code" ? "" : "text"), clipped, "```");
      }
    }
  }
  lines.push("");

  lines.push("## Recent transcript");
  const batchIds = new Set(batch.map((b) => b.id));
  const transcript = state.messages
    .filter((m) => m.kind !== "user" || m.mode !== "note")
    .filter((m) => !batchIds.has(m.eventId))
    .filter((m) => m.seq > state.briefThroughSeq);
  for (const m of transcript.slice(-TRANSCRIPT_WINDOW)) {
    if (m.kind === "user") lines.push(`[${participantName(state, m.userId)}] (event ${m.eventId}) ${m.text}${m.anchor ? aboutTag(state, m.anchor) : ""}`);
    else if (m.kind === "ai") lines.push(`[AI, for ${participantName(state, m.onBehalfOf)}] ${m.text}`);
    else if (m.kind === "clarification") lines.push(`[AI asks ${m.onBehalfOf ? participantName(state, m.onBehalfOf) : "everyone"}] ${m.text}`);
    else lines.push(`[System] ${m.text}`);
  }
  lines.push("");

  const pending = Object.values(state.proposals).filter((p) => p.status === "pending");
  if (pending.length) {
    lines.push("## Pending proposals (awaiting human approval)");
    for (const p of pending) lines.push(`- ${p.id}: ${p.op} ${p.title} (${p.artifactId}), needs ${p.requiresApprovalFrom.map((u) => participantName(state, u)).join(", ")}`);
    lines.push("");
  }

  if (mcpServers.length) {
    const owner = participantName(state, mcpServers[0]!.ownerUserId);
    lines.push(`## External tools registered by ${owner} (the person this turn is for)`);
    lines.push(`Use them when ${owner} asks for something in an outside system (publishing, creating tickets, committing). Read tools run at once; tools marked WRITE are proposed to ${owner} for approval before they run, and may be denied. Never use these for anyone else's request.`);
    for (const s of mcpServers) {
      lines.push(`- server "${s.name}":`);
      for (const t of s.tools) lines.push(`  - ${t.name}${t.readOnly ? "" : " [WRITE]"}: ${t.description}`);
    }
    lines.push("");
  } else {
    lines.push("## External tools", "None registered by the person this turn is for. Say nothing about tools or their availability unless they ask you to publish, create tickets, commit or otherwise act outside this session; then tell them to register the tool under credentials → External tools.", "");
  }

  for (const note of operatorNotes) lines.push(`## Operator note`, note, "");

  lines.push("## Current messages");
  for (const b of batch) {
    const p = b.payload as { text: string; attachments?: string[]; anchor?: MessageAnchor; fromNoteEventId?: string };
    const who = b.actorKind === "system" ? "System" : participantName(state, b.actorUserId);
    const attached = (p.attachments ?? []).map((id) => state.artifacts[id]).filter(Boolean).map((a) => `${a!.title} (artifact ${a!.id})`);
    lines.push(`[${who}] (event ${b.id}) ${p.text}${attached.length ? ` [attached: ${attached.join(", ")}]` : ""}${p.anchor ? aboutTag(state, p.anchor) : ""}`);
    // A message promoted out of a thread brings the rest of that thread as background (people talking to people).
    if (p.fromNoteEventId) {
      const root = threadRootOf(state, p.fromNoteEventId);
      const t = root ? threads(state).find((x) => x.root.eventId === root.eventId) : undefined;
      const earlier = t ? [t.root, ...t.replies].filter((m) => m.eventId !== p.fromNoteEventId) : [];
      if (t && earlier.length) {
        lines.push(`  (promoted from a thread between people on ${describeAnchor(state, t.anchor)}; the rest of that thread, for context only:)`);
        for (const m of earlier.slice(-8)) lines.push(`  - [${participantName(state, m.userId)}] ${m.text}`);
      }
    }
  }

  return { system: SYSTEM_PROMPT, prompt: lines.join("\n"), attachments };
}

// "[about: System architecture › Postgres (artifact 01…, component postgres)]": what "this" refers to.
function aboutTag(state: SessionState, anchor: MessageAnchor): string {
  return ` [about: ${describeAnchor(state, anchor)} (artifact ${anchor.artifactId}${anchor.componentId ? `, component ${anchor.componentId}` : ""})]`;
}
