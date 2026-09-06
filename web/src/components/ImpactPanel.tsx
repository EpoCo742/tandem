import { createPortal } from "react-dom";
import { impactOf, participantName, describeAnchor } from "@tandem/shared";
import { useStore } from "../state/store";

// "What depends on Kafka": decisions, constraints, views, alternatives, documents and threads
// that refer to a component, and what would dangle if it were removed. Computed from state.
export function ImpactPanel({ componentId, onClose }: { componentId: string; onClose: () => void }) {
  const state = useStore((s) => s.state);
  const setFocusComponent = useStore((s) => s.setFocusComponent);
  const setFocusArtifact = useStore((s) => s.setFocusArtifact);
  const setThreadTarget = useStore((s) => s.setThreadTarget);
  const requestTab = useStore((s) => s.requestTab);
  const setHighlight = useStore((s) => s.setHighlight);
  const i = impactOf(state, componentId);
  if (!i) return null;
  const r = i.ifRemoved;
  return createPortal(
    <div className="modal-bg nodrag nowheel" onClick={onClose}>
      <div className="modal impact" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <span className="chip" style={{ color: "var(--link)" }}>impact</span>
          <b style={{ flex: 1 }}>{i.component.name}</b>
          <span className="mono">{i.component.kind}{i.component.technology ? ` · ${i.component.technology}` : ""}</span>
          <button onClick={onClose}>close</button>
        </div>
        <div className="consent" style={{ fontSize: 12.5 }}>
          If removed: {r.relationships} relationship{r.relationships === 1 ? "" : "s"} go, {r.viewsAffected} view{r.viewsAffected === 1 ? "" : "s"} redraw, {r.decisionsLeftPointing} decision{r.decisionsLeftPointing === 1 ? "" : "s"} would point at nothing, {r.threadsOrphaned} open thread{r.threadsOrphaned === 1 ? "" : "s"} would lose their anchor.
        </div>
        <Section title="Relationships" count={i.relationships.length}>
          {i.relationships.map((x) => (
            <div key={x.rel.id} className="mono">{x.direction === "out" ? <>{i.component.name} <span className="muted">{x.rel.kind.replace("_", " ")}</span> {x.other?.name ?? x.rel.to}</> : <>{x.other?.name ?? x.rel.from} <span className="muted">{x.rel.kind.replace("_", " ")}</span> {i.component.name}</>}{x.rel.label ? <span className="muted"> ({x.rel.label})</span> : null}</div>
          ))}
        </Section>
        <Section title="Decisions" count={i.decisions.length}>
          {i.decisions.map((d) => (
            <div key={d.id} className="impact-row" onClick={() => { setFocusComponent(componentId); requestTab("decisions"); setHighlight(d.evidence); onClose(); }} title="Open in the Decisions tab">
              <span className="mono">{d.label} · {d.status}</span> {d.statement} <span className="muted">({d.agreedBy.map((u) => participantName(state, u)).join(", ")})</span>
            </div>
          ))}
        </Section>
        <Section title="Constraints that name it" count={i.constraints.length}>
          {i.constraints.map((k) => <div key={k.id}><span className="mono">{k.id}</span> {k.statement}</div>)}
        </Section>
        <Section title="Views that draw it" count={i.views.length}>
          {i.views.map((v) => <div key={v.id} className="impact-row" onClick={() => { setFocusArtifact(v.id); onClose(); }} title="Show the card">{v.title}</div>)}
        </Section>
        <Section title="Candidate architectures" count={i.alternatives.flatMap((a) => a.candidates).length}>
          {i.alternatives.map((a) => <div key={a.artifact.id} className="impact-row" onClick={() => { setFocusArtifact(a.artifact.id); onClose(); }}>{a.artifact.title}: {a.candidates.join("; ")}</div>)}
        </Section>
        <Section title="Mentioned in" count={i.mentions.length}>
          {i.mentions.map((m) => <div key={m.artifact.id} className="impact-row" onClick={() => { setFocusArtifact(m.artifact.id); onClose(); }}>{m.artifact.title} <span className="mono">{m.count}×</span></div>)}
        </Section>
        <Section title="Threads" count={i.threads.length}>
          {i.threads.map((t) => <div key={t.root.eventId} className="impact-row" onClick={() => { setThreadTarget(t.anchor); onClose(); }}>{describeAnchor(state, t.anchor)}: {t.root.text.slice(0, 80)}{t.resolved ? <span className="mono"> resolved</span> : null}</div>)}
        </Section>
      </div>
    </div>,
    document.body,
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="impact-section">
      <div className="mono" style={{ marginBottom: 3 }}>{title} · {count}</div>
      {count === 0 ? <div className="muted" style={{ fontSize: 12 }}>none</div> : children}
    </div>
  );
}
