import { eq } from "drizzle-orm";
import { participantName, contractsOf, type ArchModelContent, type ConstraintsContent, type ContractContent, type LibraryHit, type LibraryKind, type SessionState } from "@tandem/shared";
import { db, now, schema, sqlite } from "./db/index.js";
import { getState } from "./ledger.js";
import { latestPublishedMarkdown, livePublications } from "./publish.js";

// The organisation library is a full-text index over every session's decisions, model
// components, constraints and published documents. It is rebuilt per session from the ledger
// whenever the ledger has moved past what was indexed, so nothing has to remember to update it.
//
// Who sees what: items of a session the searcher takes part in, plus items of any session that
// has a live published document (publishing is how a session enters the organisation's memory).

const KINDS: LibraryKind[] = ["decision", "component", "constraint", "document", "contract"];

let prepared: { del: ReturnType<typeof sqlite.prepare>; ins: ReturnType<typeof sqlite.prepare>; maxSeq: ReturnType<typeof sqlite.prepare> } | null = null;
function stmts() {
  if (!prepared) {
    prepared = {
      del: sqlite.prepare(`delete from library_fts where session_id = ?`),
      ins: sqlite.prepare(`insert into library_fts (kind, session_id, ref_id, title, body, people, session_title, is_public, updated_at, link, artifact_id) values (@kind, @sessionId, @refId, @title, @body, @people, @sessionTitle, @isPublic, @updatedAt, @link, @artifactId)`),
      maxSeq: sqlite.prepare(`select coalesce(max(seq), 0) as seq from events where session_id = ?`),
    };
  }
  return prepared;
}

interface Row { kind: LibraryKind; sessionId: string; refId: string; title: string; body: string; people: string; sessionTitle: string; isPublic: number; updatedAt: string; link: string; artifactId: string | null }

function rowsFor(sessionId: string, state: SessionState, sessionTitle: string): Row[] {
  const out: Row[] = [];
  const pubs = livePublications(sessionId);
  const isPublic = pubs.length > 0 ? 1 : 0;
  const names = (ids: string[]) => ids.map((u) => participantName(state, u));
  const live = Object.values(state.artifacts).filter((a) => !a.deleted);
  const model = live.find((a) => a.type === "arch_model");
  const m = model?.current.content as ArchModelContent | undefined;
  const cname = (id: string) => m?.components.find((c) => c.id === id)?.name ?? id;

  for (const d of Object.values(state.decisions)) {
    const opts = d.options.map((o) => `${o.title}${o.chosen ? " (chosen)" : ""}${o.tradeoffs ? `: ${o.tradeoffs}` : ""}`).join("; ");
    out.push({ kind: "decision", sessionId, refId: d.id, title: `${d.label} ${d.statement}`, body: [d.status, d.about.map(cname).join(", "), d.context, opts, d.consequences].filter(Boolean).join("\n"), people: names(d.agreedBy).join(", "), sessionTitle, isPublic, updatedAt: d.createdAt, link: `/s/${sessionId}`, artifactId: null });
  }
  if (m && model) {
    for (const c of m.components) {
      const rels = m.relationships.filter((r) => r.from === c.id || r.to === c.id).map((r) => (r.from === c.id ? `${r.kind} ${cname(r.to)}` : `${cname(r.from)} ${r.kind} this`) + (r.label ? ` (${r.label})` : ""));
      const decisions = Object.values(state.decisions).filter((d) => d.about.includes(c.id)).map((d) => `${d.label} ${d.statement}`);
      const boundary = c.boundary ? m.boundaries.find((b) => b.id === c.boundary)?.name ?? c.boundary : "";
      out.push({ kind: "component", sessionId, refId: c.id, title: `${c.name} (${c.kind}${c.technology ? `, ${c.technology}` : ""})`, body: [c.description, boundary && `in ${boundary}`, ...rels, ...decisions].filter(Boolean).join("\n"), people: "", sessionTitle, isPublic, updatedAt: model.current.createdAt, link: `/s/${sessionId}`, artifactId: model.id });
    }
  }
  const constraints = live.find((a) => a.type === "constraints");
  const kc = constraints?.current.content as ConstraintsContent | undefined;
  if (kc && constraints) {
    for (const k of kc.constraints) {
      out.push({ kind: "constraint", sessionId, refId: k.id, title: `${k.id} ${k.statement}`, body: [k.kind.replace("_", " "), k.category, k.value, k.exceptionTo ? `exception to ${k.exceptionTo}` : ""].filter(Boolean).join("\n"), people: k.setBy ? participantName(state, k.setBy) : "document", sessionTitle, isPublic, updatedAt: constraints.current.createdAt, link: `/s/${sessionId}`, artifactId: constraints.id });
    }
  }
  for (const a of live) {
    if (a.type !== "contract") continue;
    const c = a.current.content as ContractContent;
    const st = contractsOf(state).find((x) => x.artifact.id === a.id);
    out.push({ kind: "contract", sessionId, refId: a.id, title: `${a.title} (${c.format}${c.version ? ` ${c.version}` : ""})`, body: [st?.provider ? `provided by ${cname(st.provider)}` : "", st?.consumers.length ? `consumed by ${st.consumers.map(cname).join(", ")}` : "", c.body.slice(0, 20_000)].filter(Boolean).join("\n"), people: participantName(state, a.current.authorUserId), sessionTitle, isPublic, updatedAt: a.current.createdAt, link: `/s/${sessionId}`, artifactId: a.id });
  }
  for (const p of pubs) {
    const v = latestPublishedMarkdown(p.id);
    if (!v) continue;
    const approval = v.approval ? (JSON.parse(v.approval) as { decisionLabel: string; signerNames: string[] }) : null;
    out.push({ kind: "document", sessionId, refId: p.slug, title: v.title, body: v.markdown.replace(/<!--[\s\S]*?-->/g, "").slice(0, 60_000), people: approval ? approval.signerNames.join(", ") : "", sessionTitle, isPublic: 1, updatedAt: v.publishedAt, link: `/p/${p.slug}`, artifactId: p.artifactId });
  }
  return out;
}

const reindexTx = sqlite.transaction((sessionId: string, rows: Row[], seq: number) => {
  stmts().del.run(sessionId);
  for (const r of rows) stmts().ins.run(r);
  sqlite.prepare(`insert into library_index_state (session_id, indexed_seq, indexed_at) values (?, ?, ?) on conflict(session_id) do update set indexed_seq = excluded.indexed_seq, indexed_at = excluded.indexed_at`).run(sessionId, seq, now());
});

export function reindexSession(sessionId: string) {
  const s = db.select({ title: schema.sessions.title }).from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get();
  if (!s) {
    stmts().del.run(sessionId);
    sqlite.prepare(`delete from library_index_state where session_id = ?`).run(sessionId);
    return;
  }
  const { seq } = stmts().maxSeq.get(sessionId) as { seq: number };
  reindexTx(sessionId, rowsFor(sessionId, getState(sessionId), s.title), seq);
}

/** Bring every session's index up to its ledger head. Cheap when nothing moved: one small query per session. */
export function ensureIndexed() {
  const sessions = db.select({ id: schema.sessions.id }).from(schema.sessions).all();
  const indexed = new Map(sqlite.prepare(`select session_id, indexed_seq from library_index_state`).all().map((r) => [(r as { session_id: string }).session_id, (r as { indexed_seq: number }).indexed_seq]));
  for (const { id } of sessions) {
    const { seq } = stmts().maxSeq.get(id) as { seq: number };
    if ((indexed.get(id) ?? -1) < seq) reindexSession(id);
  }
  for (const id of indexed.keys()) if (!sessions.some((s) => s.id === id)) reindexSession(id); // deleted sessions drop out
}

function ftsQuery(q: string, mode: "and" | "or"): string {
  const tokens = q.replace(/["*]/g, " ").split(/\s+/).map((t) => t.trim()).filter((t) => t.length > 1);
  if (tokens.length === 0) return "";
  return tokens.map((t) => `"${t}"*`).join(mode === "and" ? " " : " OR ");
}

export function searchLibrary(userId: string, q: string, opts: { kind?: LibraryKind; limit?: number; excludeSessionId?: string } = {}): { hits: LibraryHit[]; scope: { sessions: number; publicSessions: number } } {
  ensureIndexed();
  const mine = db.select({ id: schema.participants.sessionId }).from(schema.participants).where(eq(schema.participants.userId, userId)).all().map((r) => r.id);
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const kind = opts.kind && KINDS.includes(opts.kind) ? opts.kind : null;
  const params: unknown[] = [];
  const scope = `(${mine.length ? `session_id in (${mine.map(() => "?").join(",")}) or ` : ""}is_public = 1)`;
  params.push(...mine);
  const filters = [scope];
  if (kind) {
    filters.push(`kind = ?`);
    params.push(kind);
  }
  if (opts.excludeSessionId) {
    filters.push(`session_id <> ?`);
    params.push(opts.excludeSessionId);
  }
  const run = (match: string | null) => {
    const where = [...(match ? [`library_fts match ?`] : []), ...filters].join(" and ");
    const sql = match
      ? `select kind, session_id, ref_id, title, snippet(library_fts, 4, '[', ']', '…', 20) as snippet, people, session_title, is_public, updated_at, link, artifact_id from library_fts where ${where} order by bm25(library_fts, 0, 0, 0, 3.0, 1.0, 1.0, 0.5) limit ?`
      : `select kind, session_id, ref_id, title, substr(body, 1, 160) as snippet, people, session_title, is_public, updated_at, link, artifact_id from library_fts where ${where} order by updated_at desc limit ?`;
    return sqlite.prepare(sql).all(...(match ? [match] : []), ...params, limit) as { kind: LibraryKind; session_id: string; ref_id: string; title: string; snippet: string; people: string; session_title: string; is_public: number; updated_at: string; link: string; artifact_id: string | null }[];
  };
  const trimmed = q.trim();
  let rows = trimmed ? run(ftsQuery(trimmed, "and")) : run(null);
  if (trimmed && rows.length === 0) rows = run(ftsQuery(trimmed, "or"));
  const hits: LibraryHit[] = rows.map((r) => ({
    kind: r.kind,
    sessionId: r.session_id,
    sessionTitle: r.session_title,
    refId: r.ref_id,
    title: r.title,
    snippet: r.snippet.replace(/\s+/g, " ").trim(),
    people: r.people ? r.people.split(", ").filter(Boolean) : [],
    updatedAt: r.updated_at,
    isPublic: !mine.includes(r.session_id),
    link: r.link,
    ...(r.artifact_id ? { artifactId: r.artifact_id } : {}),
    importRef: { sessionId: r.session_id, sessionTitle: r.session_title, kind: r.kind, refId: r.ref_id },
  }));
  const publicSessions = (sqlite.prepare(`select count(distinct session_id) as n from library_fts where is_public = 1`).get() as { n: number }).n;
  return { hits, scope: { sessions: mine.length, publicSessions } };
}
