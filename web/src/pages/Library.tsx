import { useEffect, useState } from "react";
import type { LibraryHit, LibraryKind } from "@tandem/shared";
import { api } from "../api";
import { navigate } from "../App";
import { TopBar } from "../components/TopBar";
import { useStore } from "../state/store";

const KINDS: { id: LibraryKind | ""; label: string }[] = [
  { id: "", label: "everything" },
  { id: "decision", label: "decisions" },
  { id: "component", label: "components" },
  { id: "constraint", label: "constraints" },
  { id: "document", label: "published documents" },
];

interface SessionRow { id: string; title: string; status: "active" | "archived"; role: string; updatedAt: string }
interface CopyResult { what: string; label?: string; status: "applied" | "pending_approval" | "recorded"; approvers?: string[]; artifactId?: string }

// Search across sessions: what was decided, built, constrained and published. Your own sessions
// plus everything any session has published. A result opens the session on the right card, or
// the published page; decisions, components and constraints can be copied into one of your
// sessions without an AI turn, keeping their origin.
export function Library() {
  const setFocusArtifact = useStore((s) => s.setFocusArtifact);
  const [q, setQ] = useState(() => new URLSearchParams(location.search).get("q") ?? "");
  const [kind, setKind] = useState<LibraryKind | "">("");
  const [res, setRes] = useState<{ hits: LibraryHit[]; scope: { sessions: number; publicSessions: number } } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [targets, setTargets] = useState<SessionRow[]>([]);

  useEffect(() => {
    api<SessionRow[]>("GET", "/api/v1/sessions").then((rows) => setTargets(rows.filter((s) => s.status !== "archived" && s.role !== "viewer" && s.role !== "reviewer"))).catch(() => undefined);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      api<typeof res>("GET", `/api/v1/library?q=${encodeURIComponent(q)}&kind=${kind}&limit=40`)
        .then((r) => { setRes(r); setErr(null); })
        .catch((e) => setErr((e as Error).message));
    }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q, kind]);

  function open(h: LibraryHit) {
    if (h.kind === "document") return navigate(h.link);
    setFocusArtifact(h.artifactId ?? null);
    navigate(h.link);
  }

  return (
    <>
      <TopBar>
        <span className="mono">library</span>
      </TopBar>
      <div className="page library">
        <h2 style={{ fontSize: 26, marginBottom: 4 }}>Library</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Decisions, components, constraints and published documents across sessions.
          {res && <> Searching {res.scope.sessions} session{res.scope.sessions === 1 ? "" : "s"} you are in{res.scope.publicSessions ? ` and ${res.scope.publicSessions} that published a document` : ""}.</>}
        </p>
        <input autoFocus placeholder="Search, e.g. Kafka, data residency, order events" value={q} onChange={(e) => setQ(e.target.value)} style={{ fontSize: 16, padding: "10px 12px" }} />
        <div className="row" style={{ gap: 6, margin: "10px 0 16px", flexWrap: "wrap" }}>
          {KINDS.map((k) => (
            <button key={k.id} className={"icon" + (kind === k.id ? " primary" : "")} onClick={() => setKind(k.id)}>{k.label}</button>
          ))}
        </div>
        {err && <div className="err">{err}</div>}
        {res && res.hits.length === 0 && <p className="muted">{q ? "Nothing matches. Try fewer words." : "Nothing here yet. Decisions, components and constraints appear as sessions record them."}</p>}
        {!q && res && res.hits.length > 0 && <div className="mono" style={{ marginBottom: 6 }}>most recent</div>}
        {res?.hits.map((h) => <Hit key={`${h.sessionId}:${h.kind}:${h.refId}`} h={h} targets={targets.filter((t) => t.id !== h.sessionId)} onOpen={() => open(h)} />)}
        <p className="muted" style={{ marginTop: 20, fontSize: 12.5 }}>
          Copy puts a decision (as proposed), a component or a constraint into one of your sessions with a "from …" link back here; someone else's card there makes it a proposal. In a session, the AI can search this library too, cite what it finds, and copy it in the same way.
        </p>
      </div>
    </>
  );
}

function Hit({ h, targets, onOpen }: { h: LibraryHit; targets: SessionRow[]; onOpen: () => void }) {
  const [choosing, setChoosing] = useState(false);
  const [target, setTarget] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ sessionId: string; title: string; r: CopyResult } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const chosen = target || targets[0]?.id || "";

  async function copy() {
    const t = targets.find((x) => x.id === chosen);
    if (!t) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api<CopyResult>("POST", `/api/v1/sessions/${t.id}/library/import`, { ref: h.importRef });
      setDone({ sessionId: t.id, title: t.title, r });
      setChoosing(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card hit" onClick={onOpen}>
      <div className="row" style={{ gap: 8, alignItems: "baseline" }}>
        <span className={"chip kind-" + h.kind}>{h.kind}</span>
        <span style={{ fontWeight: 600, flex: 1 }}>{h.title}</span>
        {h.isPublic && <span className="chip" title="From a session you are not in; visible because it published a document">published</span>}
        <span className="mono">{new Date(h.updatedAt).toLocaleDateString()}</span>
        {h.kind !== "document" && targets.length > 0 && !done && (
          <button className="icon" onClick={(e) => { e.stopPropagation(); setChoosing((c) => !c); }} title="Copy into one of your sessions, no AI turn; the origin stays attached">copy into…</button>
        )}
      </div>
      <div className="snippet"><Snippet text={h.snippet} /></div>
      <div className="mono" style={{ marginTop: 4 }}>
        {h.sessionTitle}
        {h.people.length > 0 && <> · {h.kind === "decision" ? "agreed by" : h.kind === "constraint" ? "set by" : "signed by"} {h.people.join(", ")}</>}
      </div>
      {choosing && (
        <div className="row" style={{ marginTop: 8, gap: 6 }} onClick={(e) => e.stopPropagation()}>
          <select value={chosen} onChange={(e) => setTarget(e.target.value)} style={{ width: "auto", flex: 1 }}>
            {targets.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
          <button className="primary" style={{ fontSize: 12 }} disabled={busy || !chosen} onClick={copy}>Copy</button>
          <button style={{ fontSize: 12 }} onClick={() => setChoosing(false)}>cancel</button>
        </div>
      )}
      {done && (
        <div className="consent" style={{ marginTop: 8, fontSize: 12.5 }} onClick={(e) => e.stopPropagation()}>
          {done.r.status === "recorded" && <>Copied into <b>{done.title}</b> as {done.r.label}, proposed until that session agrees. </>}
          {done.r.status === "applied" && <>Copied into <b>{done.title}</b>{done.r.label ? ` as ${done.r.label}` : ""}. </>}
          {done.r.status === "pending_approval" && <>Proposed in <b>{done.title}</b>; the card there belongs to someone else, so it waits for their approval. </>}
          <a href={`/s/${done.sessionId}`} onClick={(e) => { e.preventDefault(); navigate(`/s/${done.sessionId}`); }}>open</a>
        </div>
      )}
      {err && <div className="err" style={{ marginTop: 6, fontSize: 12.5 }}>{err}</div>}
    </div>
  );
}

// The server marks matched words with [ and ].
function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\])/g);
  return <>{parts.map((p, i) => (p.startsWith("[") && p.endsWith("]") ? <mark key={i}>{p.slice(1, -1)}</mark> : <span key={i}>{p}</span>))}</>;
}
