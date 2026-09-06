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

// Search across sessions: what was decided, built, constrained and published. Your own sessions
// plus everything any session has published. A result opens the session on the right card, or
// the published page.
export function Library() {
  const setFocusArtifact = useStore((s) => s.setFocusArtifact);
  const [q, setQ] = useState(() => new URLSearchParams(location.search).get("q") ?? "");
  const [kind, setKind] = useState<LibraryKind | "">("");
  const [res, setRes] = useState<{ hits: LibraryHit[]; scope: { sessions: number; publicSessions: number } } | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
        {res?.hits.map((h) => (
          <div key={`${h.sessionId}:${h.kind}:${h.refId}`} className="card hit" onClick={() => open(h)}>
            <div className="row" style={{ gap: 8, alignItems: "baseline" }}>
              <span className={"chip kind-" + h.kind}>{h.kind}</span>
              <span style={{ fontWeight: 600, flex: 1 }}>{h.title}</span>
              {h.isPublic && <span className="chip" title="From a session you are not in; visible because it published a document">published</span>}
              <span className="mono">{new Date(h.updatedAt).toLocaleDateString()}</span>
            </div>
            <div className="snippet"><Snippet text={h.snippet} /></div>
            <div className="mono" style={{ marginTop: 4 }}>
              {h.sessionTitle}
              {h.people.length > 0 && <> · {h.kind === "decision" ? "agreed by" : h.kind === "constraint" ? "set by" : "signed by"} {h.people.join(", ")}</>}
            </div>
          </div>
        ))}
        <p className="muted" style={{ marginTop: 20, fontSize: 12.5 }}>
          In a session, ask the AI what earlier sessions decided about something; it searches this library, cites the session and the people, and can copy a decision, component or constraint in with its origin attached.
        </p>
      </div>
    </>
  );
}

// The server marks matched words with [ and ].
function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\])/g);
  return <>{parts.map((p, i) => (p.startsWith("[") && p.endsWith("]") ? <mark key={i}>{p.slice(1, -1)}</mark> : <span key={i}>{p}</span>))}</>;
}
