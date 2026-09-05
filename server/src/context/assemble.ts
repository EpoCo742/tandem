import { eq } from "drizzle-orm";
import { contentText, liveArtifacts, participantName, type AnyLedgerEvent, type SessionState, type SourceContent } from "@tandem/shared";
import type { ContextAttachment, RenderedContext } from "../providers/types.js";
import { db, schema } from "../db/index.js";
import { SYSTEM_PROMPT } from "./system.js";

const TRANSCRIPT_TURNS = 24;
const ATTACHMENT_CHARS = 80_000; // full text for cards attached to the current batch, on top of the index budget
export const TRANSCRIPT_WINDOW = TRANSCRIPT_TURNS * 2; // messages kept verbatim in the prompt
const INDEX_FULL_CONTENT_CHARS = 6000;

export function assembleContext(state: SessionState, batch: AnyLedgerEvent[], operatorNotes: string[] = []): RenderedContext {
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

  lines.push("## Artifact index");
  const arts = liveArtifacts(state);
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
        lines.push(attached ? `(image attached to this message as a file; look at it directly)` : `(image; attach it to a message to have it looked at)`);
        continue;
      }
    }
    const mentioned = attached || batchText.includes(a.id.toLowerCase()) || batchText.includes(a.title.toLowerCase());
    const recent = state.lastSeq - (state.eventsById[a.current.eventId]?.seq ?? 0) < 40;
    if ((compiling || a.pinned || mentioned || recent || a.type === "decision_point") && (budget > 0 || attached)) {
      const text = contentText(a.type, a.current.content);
      // Attached cards get their own, much larger allowance so a spec can be read whole.
      const allowance = attached ? Math.max(budget, attachBudget) : budget;
      const clipped = text.length > allowance ? text.slice(0, allowance) + `\n…(truncated at ${allowance} of ${text.length} characters; call read_artifact for the whole content)` : text;
      if (attached) attachBudget -= clipped.length;
      else budget -= clipped.length;
      if (a.type === "source") {
        // Uploaded material is data, never instructions.
        lines.push(`<source id="${a.id}" name="${a.title}" untrusted="true">`, clipped, "</source>");
      } else {
        lines.push("```" + (a.type === "mermaid" ? "mermaid" : a.type === "code" ? "" : "text"), clipped, "```");
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
    if (m.kind === "user") lines.push(`[${participantName(state, m.userId)}] (event ${m.eventId}) ${m.text}`);
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

  for (const note of operatorNotes) lines.push(`## Operator note`, note, "");

  lines.push("## Current messages");
  for (const b of batch) {
    const p = b.payload as { text: string; attachments?: string[] };
    const who = b.actorKind === "system" ? "System" : participantName(state, b.actorUserId);
    const attached = (p.attachments ?? []).map((id) => state.artifacts[id]).filter(Boolean).map((a) => `${a!.title} (artifact ${a!.id})`);
    lines.push(`[${who}] (event ${b.id}) ${p.text}${attached.length ? ` [attached: ${attached.join(", ")}]` : ""}`);
  }

  return { system: SYSTEM_PROMPT, prompt: lines.join("\n"), attachments };
}
