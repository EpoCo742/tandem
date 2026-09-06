import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import { emptyModel, nextDecisionLabel, participantName, upsertComponents, type ArchModelContent, type ConstraintsContent, type ImportedFrom } from "@tandem/shared";
import { db, schema } from "./db/index.js";
import { appendEvent, getState, sessionExists } from "./ledger.js";
import { createCommit, requestChange } from "./governance.js";
import { livePublications } from "./publish.js";

// Copying a library entry into a session without an AI turn. The copy goes through the same
// governance as a hand edit (someone else's model or constraints card becomes a proposal), and
// keeps its origin in importedFrom. A decision arrives as "proposed" for this session to accept.

type Outcome<T> = ({ ok: true } & T) | { ok: false; status: number; error: string };
export type ImportOutcome = { what: string; label?: string; status: "applied" | "pending_approval" | "recorded"; approvers?: string[]; artifactId?: string };

function canReadSource(sourceSessionId: string, userId: string): boolean {
  const p = db.select().from(schema.participants).where(and(eq(schema.participants.sessionId, sourceSessionId), eq(schema.participants.userId, userId))).get();
  return Boolean(p) || livePublications(sourceSessionId).length > 0;
}

export function importFromLibrary(targetSessionId: string, userId: string, ref: ImportedFrom): Outcome<ImportOutcome> {
  if (ref.kind === "document") return { ok: false, status: 400, error: "published documents are read, not copied; open the page instead" };
  if (!sessionExists(ref.sessionId)) return { ok: false, status: 404, error: "the source session no longer exists" };
  if (ref.sessionId === targetSessionId) return { ok: false, status: 400, error: "that is already in this session" };
  if (!canReadSource(ref.sessionId, userId)) return { ok: false, status: 403, error: "you cannot read the source session" };
  const src = getState(ref.sessionId);
  const dst = getState(targetSessionId);
  const sourceTitle = src.title || ref.sessionTitle;
  const provenance: ImportedFrom = { sessionId: ref.sessionId, sessionTitle: sourceTitle, kind: ref.kind, refId: ref.refId };
  const me = participantName(dst, userId);
  const common = { sessionId: targetSessionId, turnId: null, actorKind: "user" as const, actorUserId: userId, causedBy: [] as string[] };

  if (ref.kind === "decision") {
    const d = src.decisions[ref.refId];
    if (!d) return { ok: false, status: 404, error: `no decision ${ref.refId} in the source session` };
    if (Object.values(dst.decisions).some((x) => x.importedFrom?.sessionId === ref.sessionId && x.importedFrom.refId === ref.refId)) return { ok: false, status: 400, error: "that decision is already here" };
    const agreed = d.agreedBy.map((u) => participantName(src, u)).join(", ");
    const label = nextDecisionLabel(dst);
    appendEvent(targetSessionId, {
      type: "decision.recorded",
      actorKind: "user",
      actorUserId: userId,
      payload: {
        decisionId: ulid(),
        label,
        statement: d.statement,
        status: "proposed",
        supersedes: null,
        agreedBy: [userId],
        evidence: [],
        about: [],
        context: `Copied from session "${sourceTitle}" (${d.label}, ${d.status}${agreed ? `, agreed there by ${agreed}` : ""}) by ${me}.${d.context ? ` ${d.context}` : ""}`,
        options: d.options,
        consequences: d.consequences,
        importedFrom: provenance,
      },
    });
    createCommit(targetSessionId, userId, null, `${me} copied ${d.label} from "${sourceTitle}" as ${label}`);
    return { ok: true, what: d.statement, label, status: "recorded" };
  }

  if (ref.kind === "component") {
    const srcModel = Object.values(src.artifacts).find((a) => a.type === "arch_model" && !a.deleted)?.current.content as ArchModelContent | undefined;
    const c = srcModel?.components.find((x) => x.id === ref.refId);
    if (!c) return { ok: false, status: 404, error: `no component ${ref.refId} in the source session` };
    const existing = Object.values(dst.artifacts).find((a) => a.type === "arch_model" && !a.deleted);
    const cur = (existing?.current.content as ArchModelContent | undefined) ?? emptyModel();
    const id = cur.components.some((x) => x.id === c.id) ? `${c.id}-from-${ref.sessionId.slice(-4).toLowerCase()}` : c.id;
    const next = upsertComponents(cur, [{ id, name: c.name, kind: c.kind, description: c.description, technology: c.technology, importedFrom: provenance }], []);
    const r = requestChange({ ...common, op: existing ? "update" : "create", artifactId: existing?.id ?? null, artifactType: "arch_model", title: existing?.title ?? "Architecture model", content: next, summary: `${next.components.length} components`, rationale: `${me} copied ${c.name} from "${sourceTitle}"`, baseVersionNo: existing?.current.versionNo ?? null, provenance: [{ sectionId: "model", derivedFrom: [] }] });
    if (r.status === "applied") {
      createCommit(targetSessionId, userId, null, `${me} copied component ${c.name} from "${sourceTitle}"`);
      return { ok: true, what: c.name, status: "applied", artifactId: r.artifactId };
    }
    if (r.status === "pending_approval") return { ok: true, what: c.name, status: "pending_approval", approvers: r.approvers, artifactId: r.artifactId };
    return { ok: false, status: 409, error: "message" in r ? r.message : r.status };
  }

  // constraint
  const srcK = Object.values(src.artifacts).find((a) => a.type === "constraints" && !a.deleted)?.current.content as ConstraintsContent | undefined;
  const k = srcK?.constraints.find((x) => x.id === ref.refId);
  if (!k) return { ok: false, status: 404, error: `no constraint ${ref.refId} in the source session` };
  const existing = Object.values(dst.artifacts).find((a) => a.type === "constraints" && !a.deleted);
  const cur: ConstraintsContent = (existing?.current.content as ConstraintsContent | undefined) ?? { constraints: [], sections: [] };
  if (cur.constraints.some((x) => x.importedFrom?.sessionId === ref.sessionId && x.importedFrom.refId === ref.refId)) return { ok: false, status: 400, error: "that constraint is already here" };
  const n = cur.constraints.reduce((m, x) => Math.max(m, Number(x.id.replace(/^C-/, "")) || 0), 0) + 1;
  const copy = { id: `C-${String(n).padStart(2, "0")}`, statement: k.statement, kind: k.kind, category: k.category, value: k.value, setBy: userId, importedFrom: provenance, derivedFrom: [] as string[] };
  const content: ConstraintsContent = { constraints: [...cur.constraints, copy], sections: [{ id: "constraints", derivedFrom: [] }] };
  const r = requestChange({ ...common, op: existing ? "update" : "create", artifactId: existing?.id ?? null, artifactType: "constraints", title: existing?.title ?? "Constraints", content, summary: `${content.constraints.length} constraint${content.constraints.length === 1 ? "" : "s"}`, rationale: `${me} copied ${k.id} from "${sourceTitle}"`, baseVersionNo: existing?.current.versionNo ?? null, provenance: [{ sectionId: "constraints", derivedFrom: [] }] });
  if (r.status === "applied") {
    createCommit(targetSessionId, userId, null, `${me} copied ${k.id} from "${sourceTitle}" as ${copy.id}`);
    return { ok: true, what: k.statement, label: copy.id, status: "applied", artifactId: r.artifactId };
  }
  if (r.status === "pending_approval") return { ok: true, what: k.statement, label: copy.id, status: "pending_approval", approvers: r.approvers, artifactId: r.artifactId };
  return { ok: false, status: 409, error: "message" in r ? r.message : r.status };
}
