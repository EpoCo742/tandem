import { useState } from "react";
import { createPortal } from "react-dom";
import type { ParsedModel } from "@tandem/shared";

// A PlantUML use case diagram previews as actors and use cases and lands on the Use cases card.
type UseCasePreview = { notation: "plantuml"; kind: "use_cases"; system: string; actors: { id: string; name: string; kind?: string }[]; useCases: { id: string; name: string }[]; links: { actor: string; useCase: string }[]; relations: { from: string; to: string; kind: string }[]; notes: string[] };
import { api } from "../api";

// Paste a Mermaid flowchart, Structurizr DSL or a PlantUML component diagram: preview what it
// maps to, then merge it into the model, replace the model, or record it as the as-is baseline.
// Goes through the same governance as any hand edit.
export function ImportModel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [text, setText] = useState("");
  const [notation, setNotation] = useState<"auto" | "mermaid" | "structurizr" | "plantuml">("auto");
  const [mode, setMode] = useState<"merge" | "replace" | "as_is">("merge");
  const [preview, setPreview] = useState<ParsedModel | UseCasePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run(apply: boolean) {
    setBusy(true);
    setResult(null);
    try {
      const r = await api<{ preview: ParsedModel | UseCasePreview; status?: string; approvers?: string[] }>("POST", `/api/v1/sessions/${sessionId}/model/import`, { text, notation, mode, apply });
      setPreview(r.preview);
      const target = "kind" in r.preview && r.preview.kind === "use_cases" ? "the Use cases card" : "the model";
      if (apply) {
        setResult(r.status === "applied" ? `Applied to ${target}.` : r.status === "pending_approval" ? `Sent as a proposal to the owner of ${target}.` : `Not applied: ${r.status?.replace(/_/g, " ")}`);
        if (r.status === "applied") setTimeout(onClose, 800);
      }
    } catch (e) {
      setResult((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="modal-bg nodrag nowheel" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <b style={{ flex: 1 }}>Import a diagram into the model</b>
          <button onClick={onClose}>close</button>
        </div>
        <div className="muted" style={{ fontSize: 12.5 }}>Paste a Mermaid flowchart, Structurizr DSL, or a PlantUML component diagram. Nodes become components (kind guessed from shape and name), subgraphs, groups and packages become boundaries, arrows become relationships. A PlantUML use case diagram goes to the Use cases card instead. Preview first; nothing changes until you apply.</div>
        <textarea value={text} onChange={(e) => { setText(e.target.value); setPreview(null); }} placeholder={"flowchart LR\n  api[Orders API] --> db[(Postgres)]\n  api -->|OrderPlaced| kafka{{Kafka}}"} style={{ minHeight: 200 }} />
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <label className="row" style={{ gap: 6 }}>
            <span className="mono">notation</span>
            <select value={notation} onChange={(e) => setNotation(e.target.value as typeof notation)} style={{ width: "auto" }}>
              <option value="auto">detect</option>
              <option value="mermaid">Mermaid flowchart</option>
              <option value="structurizr">Structurizr DSL</option>
              <option value="plantuml">PlantUML component or use case</option>
            </select>
          </label>
          <label className="row" style={{ gap: 6 }}>
            <span className="mono">into</span>
            <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} style={{ width: "auto" }}>
              <option value="merge">merge into the model</option>
              <option value="replace">replace the model</option>
              <option value="as_is">record as the as-is baseline</option>
            </select>
          </label>
          <span className="grow" />
          <button disabled={busy || !text.trim()} onClick={() => run(false)}>Preview</button>
          <button className="primary" disabled={busy || !text.trim()} onClick={() => run(true)}>Apply</button>
        </div>
        {preview && "kind" in preview && preview.kind === "use_cases" && (
          <div className="consent" style={{ fontSize: 12.5 }}>
            <div><b>PlantUML use case diagram</b> → the Use cases card: {preview.useCases.length} use case{preview.useCases.length === 1 ? "" : "s"}, {preview.actors.length} actor{preview.actors.length === 1 ? "" : "s"}, {preview.relations.length} include/extend, system “{preview.system}”</div>
            <div className="mono" style={{ marginTop: 4, lineHeight: 1.6 }}>
              {preview.actors.map((a) => <div key={a.id}>{a.name} <span className="muted">({a.kind === "secondary" ? "secondary actor" : "actor"})</span></div>)}
              {preview.useCases.map((u) => <div key={u.id}>{u.name} <span className="muted">← {preview.links.filter((l) => l.useCase === u.id).map((l) => preview.actors.find((a) => a.id === l.actor)?.name ?? l.actor).join(", ") || "no actor"}</span></div>)}
            </div>
            {preview.notes.length > 0 && <div className="muted" style={{ marginTop: 4 }}>{preview.notes.map((n, i) => <div key={i}>{n}</div>)}</div>}
          </div>
        )}
        {preview && !("kind" in preview) && (
          <div className="consent" style={{ fontSize: 12.5 }}>
            <div><b>{preview.notation}</b>: {preview.components.length} component{preview.components.length === 1 ? "" : "s"}, {preview.relationships.length} relationship{preview.relationships.length === 1 ? "" : "s"}, {preview.boundaries.length} boundar{preview.boundaries.length === 1 ? "y" : "ies"}</div>
            <div className="mono" style={{ marginTop: 4, lineHeight: 1.6 }}>
              {preview.components.map((c) => <div key={c.id}>{c.name} <span className="muted">({c.kind}{c.boundary ? `, in ${c.boundary}` : ""})</span></div>)}
              {preview.relationships.map((r, i) => <div key={i} className="muted">{r.from} {r.kind.replace("_", " ")} {r.to}{r.label ? ` (${r.label})` : ""}</div>)}
            </div>
            {preview.notes.length > 0 && <div className="muted" style={{ marginTop: 4 }}>{preview.notes.map((n, i) => <div key={i}>{n}</div>)}</div>}
          </div>
        )}
        {result && <div className="mono">{result}</div>}
      </div>
    </div>,
    document.body,
  );
}
