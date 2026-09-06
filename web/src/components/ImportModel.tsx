import { useState } from "react";
import { createPortal } from "react-dom";
import type { ParsedModel } from "@tandem/shared";
import { api } from "../api";

// Paste a Mermaid flowchart, Structurizr DSL or a PlantUML component diagram: preview what it
// maps to, then merge it into the model, replace the model, or record it as the as-is baseline.
// Goes through the same governance as any hand edit.
export function ImportModel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [text, setText] = useState("");
  const [notation, setNotation] = useState<"auto" | "mermaid" | "structurizr" | "plantuml">("auto");
  const [mode, setMode] = useState<"merge" | "replace" | "as_is">("merge");
  const [preview, setPreview] = useState<ParsedModel | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run(apply: boolean) {
    setBusy(true);
    setResult(null);
    try {
      const r = await api<{ preview: ParsedModel; status?: string; approvers?: string[] }>("POST", `/api/v1/sessions/${sessionId}/model/import`, { text, notation, mode, apply });
      setPreview(r.preview);
      if (apply) {
        setResult(r.status === "applied" ? "Applied to the model." : r.status === "pending_approval" ? "Sent as a proposal to the model's owner." : `Not applied: ${r.status?.replace(/_/g, " ")}`);
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
        <div className="muted" style={{ fontSize: 12.5 }}>Paste a Mermaid flowchart, Structurizr DSL, or a PlantUML component diagram. Nodes become components (kind guessed from shape and name), subgraphs, groups and packages become boundaries, arrows become relationships. Preview first; nothing changes until you apply.</div>
        <textarea value={text} onChange={(e) => { setText(e.target.value); setPreview(null); }} placeholder={"flowchart LR\n  api[Orders API] --> db[(Postgres)]\n  api -->|OrderPlaced| kafka{{Kafka}}"} style={{ minHeight: 200 }} />
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <label className="row" style={{ gap: 6 }}>
            <span className="mono">notation</span>
            <select value={notation} onChange={(e) => setNotation(e.target.value as typeof notation)} style={{ width: "auto" }}>
              <option value="auto">detect</option>
              <option value="mermaid">Mermaid flowchart</option>
              <option value="structurizr">Structurizr DSL</option>
              <option value="plantuml">PlantUML component</option>
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
        {preview && (
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
