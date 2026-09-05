import { useState } from "react";
import { modelToMermaid, participantName, type AlternativesContent, type Candidate, type ConstraintsContent, type DecisionPointContent } from "@tandem/shared";
import { api } from "../api";
import { useStore } from "../state/store";
import { Mermaid } from "./Mermaid";

// Candidate architectures side by side, a comparison against the constraints, and the one
// action that matters: open the decision. The vote lives on the decision point card; when it
// resolves, the server sets the model from the winner and marks the losers here.
export function AlternativesView({ content, artifactId, sessionId, large = false }: { content: AlternativesContent; artifactId: string; sessionId: string; large?: boolean }) {
  const state = useStore((s) => s.state);
  const setFocusArtifact = useStore((s) => s.setFocusArtifact);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const constraints = (Object.values(state.artifacts).find((a) => a.type === "constraints" && !a.deleted)?.current.content as ConstraintsContent | undefined)?.constraints ?? [];
  const dp = Object.values(state.artifacts).find((a) => a.type === "decision_point" && !a.deleted && (a.current.content as DecisionPointContent).alternativesArtifactId === artifactId);
  const dpContent = dp?.current.content as DecisionPointContent | undefined;
  const openVote = dp && dpContent && !dpContent.resolvedOptionId && !dpContent.expired;
  const chosen = content.chosen;
  const canAct = state.participants[useStore.getState().me!.user!.id]?.role !== "viewer";

  async function decide() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ decisionPointArtifactId: string }>("POST", `/api/v1/sessions/${sessionId}/alternatives/${artifactId}/decide`);
      setFocusArtifact(r.decisionPointArtifactId);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const status = (c: Candidate, id: string) => (c.constraintsAtRisk.includes(id) ? "at risk" : c.constraintsMet.includes(id) ? "met" : "");
  const shown = chosen ? content.candidates.filter((c) => c.id === chosen) : content.candidates;
  const folded = chosen ? content.candidates.filter((c) => c.id !== chosen) : [];

  return (
    <div className="stack">
      <div className="muted" style={{ fontSize: 12 }}>{content.question}</div>
      <div className="alts" style={{ gridTemplateColumns: `repeat(${Math.min(shown.length, large ? 3 : 2)}, minmax(0, 1fr))` }}>
        {shown.map((c) => <CandidateCard key={c.id} c={c} chosen={c.id === chosen} />)}
      </div>
      {constraints.length > 0 && (
        <table>
          <thead><tr><th>Constraint</th>{content.candidates.map((c) => <th key={c.id}>{c.id.toUpperCase()}. {c.title}</th>)}</tr></thead>
          <tbody>
            {constraints.map((k) => (
              <tr key={k.id}>
                <td><span className="mono">{k.id}</span> {k.statement}</td>
                {content.candidates.map((c) => {
                  const s = status(c, k.id);
                  return <td key={c.id} className="mono" style={{ color: s === "at risk" ? "var(--warn)" : s === "met" ? "var(--ok)" : undefined }}>{s || "–"}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {folded.length > 0 && (
        <details>
          <summary className="muted" style={{ cursor: "pointer", fontSize: 12 }}>{folded.length} not chosen</summary>
          <div className="alts" style={{ gridTemplateColumns: `repeat(${Math.min(folded.length, large ? 3 : 2)}, minmax(0, 1fr))`, marginTop: 8 }}>
            {folded.map((c) => <CandidateCard key={c.id} c={c} chosen={false} dim />)}
          </div>
        </details>
      )}
      <div className="row" style={{ gap: 8 }}>
        {chosen && <span className="chip" style={{ color: "var(--ok)" }} title="The architecture model was set from this candidate">chosen: {content.candidates.find((c) => c.id === chosen)?.title}</span>}
        {!chosen && openVote && dp && (
          <button onClick={() => setFocusArtifact(dp.id)} title="The vote is on the decision point card">vote on the decision point</button>
        )}
        {!chosen && !openVote && canAct && (
          <button className="primary" disabled={busy} onClick={decide} title="Open a decision point with these candidates as its options; the majority's pick becomes the architecture model">Decide</button>
        )}
        {!chosen && dpContent?.expired && <span className="muted" style={{ fontSize: 12 }}>The last vote expired; open a new one.</span>}
        {err && <span className="err" style={{ fontSize: 12 }}>{err}</span>}
        {dpContent?.resolvedOptionId && chosen && (
          <span className="muted" style={{ fontSize: 12 }}>voted by {Object.keys(dpContent.votes ?? {}).map((u) => participantName(state, u)).join(", ")}</span>
        )}
      </div>
    </div>
  );
}

function CandidateCard({ c, chosen, dim = false }: { c: Candidate; chosen: boolean; dim?: boolean }) {
  return (
    <div className={"alt" + (chosen ? " chosen" : "") + (dim ? " dim" : "")}>
      <div className="row" style={{ marginBottom: 4 }}>
        <span className="chip">{c.id.toUpperCase()}</span>
        <b>{c.title}</b>
        {chosen && <span className="chip" style={{ color: "var(--ok)" }}>chosen</span>}
        {dim && <span className="chip muted">not chosen</span>}
      </div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>{c.summary}</div>
      <Mermaid source={modelToMermaid(c.model, { kind: "container" })} />
      <div className="mono" style={{ fontSize: 11, marginTop: 6 }}>{c.model.components.length} components · {c.model.relationships.length} relationships</div>
      {c.pros.length > 0 && <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12 }}>{c.pros.map((p, i) => <li key={i} style={{ color: "var(--ok)" }}>{p}</li>)}</ul>}
      {c.cons.length > 0 && <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 12 }}>{c.cons.map((p, i) => <li key={i} style={{ color: "var(--warn)" }}>{p}</li>)}</ul>}
    </div>
  );
}
