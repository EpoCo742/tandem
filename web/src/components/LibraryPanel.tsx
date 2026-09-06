import { useEffect, useState } from "react";
import type { LibraryHit } from "@tandem/shared";
import { api } from "../api";
import { navigate } from "../App";
import { useStore } from "../state/store";

interface CopyResult { what: string; label?: string; status: "applied" | "pending_approval" | "recorded"; approvers?: string[]; artifactId?: string }

// The library from inside a session: search what other sessions decided, built and constrained,
// and copy it here with one click and no AI turn. Documents open on their public page.
export function LibraryPanel({ sessionId }: { sessionId: string }) {
  const meta = useStore((s) => s.meta);
  const state = useStore((s) => s.state);
  const canCopy = meta?.me.role === "owner" || meta?.me.role === "editor";
  const archived = state.status === "archived";
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<LibraryHit[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, CopyResult | { error: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api<{ hits: LibraryHit[] }>("GET", `/api/v1/library?q=${encodeURIComponent(q)}&limit=25&exclude=${sessionId}`)
        .then((r) => { setHits(r.hits); setErr(null); })
        .catch((e) => setErr((e as Error).message));
    }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q, sessionId]);

  const key = (h: LibraryHit) => `${h.sessionId}:${h.kind}:${h.refId}`;

  async function copy(h: LibraryHit) {
    setBusy(key(h));
    try {
      const r = await api<CopyResult>("POST", `/api/v1/sessions/${sessionId}/library/import`, { ref: h.importRef });
      setDone((d) => ({ ...d, [key(h)]: r }));
    } catch (e) {
      setDone((d) => ({ ...d, [key(h)]: { error: (e as Error).message } }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="pane-body">
      <input placeholder="Search other sessions: Kafka, data residency, retries…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="muted" style={{ fontSize: 11.5, margin: "4px 0 8px" }}>
        {canCopy && !archived ? "Copy here puts a decision (as proposed), a component or a constraint on this canvas with a link back to where it came from. No AI turn." : archived ? "This session is archived; reopen it to copy things in." : "Reviewers and viewers cannot copy; ask the AI to pull something in."}
      </div>
      {err && <div className="err">{err}</div>}
      {hits && hits.length === 0 && <div className="muted">{q ? "Nothing matches in other sessions." : "Nothing from other sessions yet."}</div>}
      {hits?.map((h) => {
        const r = done[key(h)];
        return (
          <div key={key(h)} className="lib-hit">
            <div className="row" style={{ gap: 6, alignItems: "baseline" }}>
              <span className={"chip kind-" + h.kind}>{h.kind}</span>
              <span style={{ fontWeight: 600, flex: 1, minWidth: 0 }}>{h.title}</span>
            </div>
            <div className="mono" style={{ marginTop: 2 }}>
              {h.sessionTitle}{h.people.length > 0 && <> · {h.kind === "decision" ? "agreed by" : h.kind === "constraint" ? "set by" : "signed by"} {h.people.join(", ")}</>}
            </div>
            <div className="row" style={{ marginTop: 4, gap: 6 }}>
              {h.kind === "document" ? (
                <a className="mono" href={h.link} onClick={(e) => { e.preventDefault(); navigate(h.link); }}>open page</a>
              ) : r ? (
                "error" in r ? <span className="err" style={{ fontSize: 12 }}>{r.error}</span> : (
                  <span className="mono" style={{ color: "var(--ok)" }}>
                    {r.status === "recorded" && `copied as ${r.label} (proposed)`}
                    {r.status === "applied" && `copied${r.label ? ` as ${r.label}` : ""}`}
                    {r.status === "pending_approval" && "proposed; the card belongs to someone else"}
                  </span>
                )
              ) : (
                canCopy && !archived && <button className="icon" disabled={busy === key(h)} onClick={() => copy(h)} title="Copy into this session, no AI turn; the origin stays attached">copy here</button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
