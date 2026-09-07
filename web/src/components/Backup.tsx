import { useRef, useState } from "react";
import { navigate } from "../App";

// Sessions leave and come back as one JSON file (a "bundle"): the ledger, the people, the
// uploads, the canvas layout and the published pages. Export from a session's … menu or from
// the home page (select several, or all); import on the home page.

export interface ImportReport {
  sourceId: string;
  sessionId: string | null;
  title: string;
  outcome: "imported" | "replaced" | "skipped";
  reason?: string;
  events: number;
  uploads: number;
  publications: number;
  people: number;
}

/** Download one or more sessions as a bundle file; the browser saves it. */
export async function downloadBundle(sessionIds: string[], name?: string): Promise<void> {
  const res = await fetch("/api/v1/backup/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionIds }), credentials: "same-origin" });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? `${res.status} ${res.statusText}`);
  }
  const served = res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1];
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const el = document.createElement("a");
  el.href = url;
  el.download = name ? `${name.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "session"}.session-zero.json` : served ?? "sessions.session-zero.json";
  el.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Pick a bundle file, choose copy or restore, see what came back. */
export function ImportBundle({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [peek, setPeek] = useState<{ sessions: { id: string; title: string; events: number; people: number }[]; exportedAt: string } | null>(null);
  const [mode, setMode] = useState<"copy" | "replace">("copy");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport[] | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function pick(f: File | null) {
    setFile(f);
    setPeek(null);
    setReport(null);
    setErr(null);
    if (!f) return;
    try {
      const j = JSON.parse(await f.text()) as { format?: string; exportedAt?: string; sessions?: { id: string; title: string; events?: unknown[]; participants?: unknown[] }[] };
      if (j.format !== "session-zero-bundle" || !Array.isArray(j.sessions)) throw new Error("this file is not a session bundle (expected one exported from a session's … menu or the home page)");
      setPeek({ exportedAt: j.exportedAt ?? "", sessions: j.sessions.map((s) => ({ id: s.id, title: s.title, events: s.events?.length ?? 0, people: s.participants?.length ?? 0 })) });
    } catch (e) {
      setErr((e as Error).message);
      setFile(null);
    }
  }

  async function run() {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/v1/backup/import?mode=${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: file, credentials: "same-origin" });
      const j = (await res.json()) as { error?: string; sessions?: ImportReport[] };
      if (!res.ok) throw new Error(j.error ?? `${res.status} ${res.statusText}`);
      setReport(j.sessions ?? []);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack import-bundle">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div style={{ fontWeight: 600 }}>Import sessions</div>
        <button onClick={onClose}>close</button>
      </div>
      {!report && (
        <>
          <div className="muted" style={{ fontSize: 12.5 }}>A bundle file exported from this app (yours or a colleague's, here or on another install). Credentials never travel with it; the sessions run on your own credential after import.</div>
          <input ref={input} type="file" accept=".json,application/json" onChange={(e) => void pick(e.target.files?.[0] ?? null)} />
          {peek && (
            <>
              <div className="mono">{peek.sessions.length} session{peek.sessions.length === 1 ? "" : "s"}{peek.exportedAt ? ` · exported ${new Date(peek.exportedAt).toLocaleString()}` : ""}</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {peek.sessions.map((s) => <li key={s.id}>{s.title} <span className="mono">{s.events} events · {s.people} people</span></li>)}
              </ul>
              <label className="row">
                <input type="radio" name="bundle-mode" checked={mode === "copy"} onChange={() => setMode("copy")} />
                <span><b>Add as new sessions.</b> Safe: new ids, you become the owner, nothing here is touched. Use this for a copy from someone else or from another install.</span>
              </label>
              <label className="row">
                <input type="radio" name="bundle-mode" checked={mode === "replace"} onChange={() => setMode("replace")} />
                <span><b>Restore in place.</b> Keeps every id, roles and published pages. A session with the same id that you own is replaced by the file's copy; one you do not own is skipped.</span>
              </label>
              <div className="row">
                <button className="primary" disabled={busy} onClick={run}>{busy ? "Importing…" : mode === "copy" ? "Add sessions" : "Restore"}</button>
              </div>
            </>
          )}
        </>
      )}
      {report && (
        <>
          {report.map((r) => (
            <div key={r.sourceId} className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
              <span>
                <span className="chip" style={{ marginRight: 8, color: r.outcome === "skipped" ? "var(--warn, var(--ink-3))" : "var(--accent)" }}>{r.outcome}</span>
                <b>{r.title}</b>
                {r.reason ? <span className="muted"> · {r.reason}</span> : <span className="mono"> · {r.events} events · {r.uploads} uploads · {r.people} people{r.publications ? ` · ${r.publications} published page${r.publications === 1 ? "" : "s"}` : ""}</span>}
              </span>
              {r.sessionId && <button onClick={() => navigate(`/s/${r.sessionId}`)}>Open</button>}
            </div>
          ))}
          <div className="row">
            <button onClick={() => { setReport(null); setFile(null); setPeek(null); if (input.current) input.current.value = ""; }}>Import another</button>
          </div>
        </>
      )}
      {err && <div className="err">{err}</div>}
    </div>
  );
}
