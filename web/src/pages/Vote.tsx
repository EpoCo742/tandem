import { useEffect, useState } from "react";
import { reduceAll, participantName, type AnyLedgerEvent, type DecisionPointContent, type SessionState } from "@tandem/shared";
import { api } from "../api";
import { navigate } from "../App";
import { TopBar } from "../components/TopBar";
import { useStore } from "../state/store";

// Vote on one decision point without opening the canvas: the page a digest or a message links to.
export function Vote({ sessionId, artifactId }: { sessionId: string; artifactId: string }) {
  const me = useStore((s) => s.me)!;
  const [state, setState] = useState<SessionState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () =>
    api<AnyLedgerEvent[]>("GET", `/api/v1/sessions/${sessionId}/events`)
      .then((events) => setState(reduceAll(sessionId, events)))
      .catch((e) => setErr((e as Error).message));
  useEffect(() => {
    load();
  }, [sessionId]);

  async function vote(optionId: string) {
    setMsg(null);
    try {
      const r = await api<{ resolved: boolean }>("POST", `/api/v1/sessions/${sessionId}/decision-points/${artifactId}/vote`, { optionId });
      setMsg(r.resolved ? "Resolved: a majority agreed. The AI is applying the outcome in the session." : "Vote recorded. Waiting for a majority.");
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  const a = state?.artifacts[artifactId];
  const c = a?.current.content as DecisionPointContent | undefined;
  const myVote = c?.votes?.[me.user!.id];
  const closed = Boolean(c?.resolvedOptionId || c?.expired);
  const deadline = c?.deadline ? new Date(c.deadline) : null;

  return (
    <>
      <TopBar />
      <div className="page" style={{ maxWidth: 640 }}>
        {err && <div className="err">{err}</div>}
        {!state && !err && <p className="muted">Loading…</p>}
        {state && !a && <p className="err">That decision point is not in this session.</p>}
        {state && a && c && (
          <>
            <div className="mono">{state.title} · decision point</div>
            <h2 style={{ fontSize: 24, margin: "6px 0 10px" }}>{c.question}</h2>
            <p className="muted" style={{ marginTop: 0 }}>{c.context}</p>
            {deadline && !closed && <p className="mono">{deadline.getTime() > Date.now() ? `closes ${deadline.toLocaleString()}` : "deadline passed; closing"}</p>}
            {c.expired && <div className="consent">This decision point expired without a majority. Its cards are editable again; raise it again in the session if it still matters.</div>}
            {c.resolvedOptionId && <div className="consent">Resolved: <b>{c.options.find((o) => o.id === c.resolvedOptionId)?.title}</b>.</div>}
            <div className="stack" style={{ marginTop: 12 }}>
              {c.options.map((o) => {
                const voters = Object.entries(c.votes ?? {}).filter(([, v]) => v === o.id).map(([u]) => participantName(state, u));
                return (
                  <div key={o.id} className={"card" + (c.resolvedOptionId === o.id ? " option chosen" : "")} style={{ marginBottom: 0 }}>
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <b>{o.title}</b>
                        <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{o.tradeoffs}</div>
                        <div className="mono" style={{ marginTop: 4 }}>canvas: {o.canvasImpact}{voters.length ? ` · votes: ${voters.join(", ")}` : ""}</div>
                      </div>
                      {!closed && <button className={myVote === o.id ? "primary" : ""} onClick={() => vote(o.id)}>{myVote === o.id ? "your vote" : "vote"}</button>}
                    </div>
                  </div>
                );
              })}
            </div>
            {msg && <p className="muted">{msg}</p>}
            <p style={{ marginTop: 18 }}>
              <a href={`/s/${sessionId}`} onClick={(e) => { e.preventDefault(); navigate(`/s/${sessionId}`); }}>Open the session</a>
              <span className="muted"> · </span>
              <a href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }}>Back to your digest</a>
            </p>
          </>
        )}
      </div>
    </>
  );
}
