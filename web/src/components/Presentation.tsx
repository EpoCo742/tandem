import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { liveArtifacts, participantName, AI_COLOR, type Artifact } from "@tandem/shared";
import type { Collab } from "../collab";
import { useStore } from "../state/store";
import { ArtifactBody } from "./ArtifactCard";

// Presentation mode: one card per screen in an order the presenter sets, the AI lane and the
// side pane out of the way, the decision log as the closing screen. The order lives in the
// shared layout document (not the ledger), so everyone presenting this session sees the same
// sequence and nobody's history is touched.

function defaultOrder(artifacts: Artifact[], collab: Collab): string[] {
  const pos = (id: string) => collab.nodes.get(id) ?? { x: 0, y: 0 };
  return [...artifacts]
    .filter((a) => a.type !== "source")
    .sort((a, b) => {
      const pa = pos(a.id);
      const pb = pos(b.id);
      return Math.round(pa.y / 200) - Math.round(pb.y / 200) || pa.x - pb.x;
    })
    .map((a) => a.id);
}

export function Presentation({ sessionId, collab, onClose }: { sessionId: string; collab: Collab; onClose: () => void }) {
  const state = useStore((s) => s.state);
  const me = useStore((s) => s.me)!;
  const artifacts = useMemo(() => liveArtifacts(state), [state]);
  const order = useMemo(() => collab.doc.getArray<string>("present"), [collab]);
  const [ids, setIds] = useState<string[]>(() => order.toArray());
  const [i, setI] = useState(0);
  const [arranging, setArranging] = useState(false);
  const [contents, setContents] = useState(false);

  useEffect(() => {
    const read = () => setIds(order.toArray());
    order.observe(read);
    return () => order.unobserve(read);
  }, [order]);

  // First presenter writes the default order; later ones find it there.
  useEffect(() => {
    if (order.length === 0 && artifacts.length) order.push(defaultOrder(artifacts, collab));
  }, [order, artifacts, collab]);

  const slides = ids.map((id) => artifacts.find((a) => a.id === id)).filter((a): a is Artifact => Boolean(a));
  const total = slides.length + 1; // the decision log closes
  const at = Math.min(i, total - 1);
  const a = slides[at];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") setI((x) => Math.min(total - 1, x + 1));
      if (e.key === "ArrowLeft" || e.key === "PageUp") setI((x) => Math.max(0, x - 1));
      if (e.key === "Home") setI(0);
      if (e.key === "End") setI(total - 1);
      if (e.key === "c" || e.key === "C") setContents((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [total, onClose]);

  function move(id: string, dir: -1 | 1) {
    const cur = order.toArray();
    const from = cur.indexOf(id);
    const to = from + dir;
    if (from < 0 || to < 0 || to >= cur.length) return;
    collab.doc.transact(() => {
      order.delete(from, 1);
      order.insert(to, [id]);
    });
  }
  function toggle(id: string) {
    const cur = order.toArray();
    const k = cur.indexOf(id);
    if (k >= 0) order.delete(k, 1);
    else order.push([id]);
  }
  function resetOrder() {
    collab.doc.transact(() => {
      order.delete(0, order.length);
      order.push(defaultOrder(artifacts, collab));
    });
  }

  const decisions = Object.values(state.decisions).sort((x, y) => x.label.localeCompare(y.label));
  const assumptions = Object.values(state.assumptions).sort((x, y) => x.label.localeCompare(y.label));

  return createPortal(
    <div className="present" onClick={() => setI((x) => Math.min(total - 1, x + 1))}>
      <div className="present-top" onClick={(e) => e.stopPropagation()}>
        <span className="mono">{state.title}</span>
        <span className="mono">{at + 1} / {total}</span>
        <span className="grow" />
        <button className={"icon" + (contents ? " primary" : "")} onClick={() => { setContents((v) => !v); setArranging(false); }} title="Jump to a slide (C)">contents</button>
        <button className="icon" onClick={() => { setArranging((v) => !v); setContents(false); }} title="Choose which cards are shown and in what order (shared with everyone presenting this session)">{arranging ? "done" : "arrange"}</button>
        <button className="icon" onClick={onClose} title="Leave presentation (Esc)">exit</button>
      </div>
      <div className="present-body" onClick={(e) => e.stopPropagation()}>
        {a ? (
          <div className="present-slide">
            <div className="row" style={{ gap: 10, marginBottom: 10 }}>
              <span className="chip" style={{ color: AI_COLOR }}>{a.type.replace("_", " ")}</span>
              <h1 style={{ fontSize: 28, margin: 0 }}>{a.title}</h1>
              <span className="mono">v{a.current.versionNo} · {a.current.authorKind === "ai" ? "AI for " : ""}{participantName(state, a.current.authorUserId)}</span>
            </div>
            <div className={"present-card" + (a.type === "mermaid" || a.type === "view" ? " diagram-full" : " md-doc")}>
              <ArtifactBody artifact={a} version={a.current} sessionId={sessionId} myId={me.user!.id} onVote={() => undefined} large />
            </div>
          </div>
        ) : (
          <div className="present-slide">
            <h1 style={{ fontSize: 28, marginBottom: 12 }}>Decisions</h1>
            {decisions.length === 0 && <p className="muted">No decisions recorded.</p>}
            {decisions.map((d) => (
              <div key={d.id} className={"decision " + d.status} style={{ fontSize: 16 }}>
                <span className="mono">{d.label} · {d.status}</span> {d.statement}
                {d.agreedBy.length > 0 && <span className="muted"> ({d.agreedBy.map((u) => participantName(state, u)).join(", ")})</span>}
              </div>
            ))}
            {assumptions.length > 0 && (
              <>
                <h2 style={{ fontSize: 20, margin: "18px 0 8px" }}>Assumptions</h2>
                {assumptions.map((x) => <div key={x.id} className="decision" style={{ fontSize: 15 }}><span className="mono">{x.label} · {x.status}</span> {x.statement} <span className="muted">({participantName(state, x.ownerUserId)})</span></div>)}
              </>
            )}
          </div>
        )}
      </div>
      <div className="present-nav" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => setI((x) => Math.max(0, x - 1))} disabled={at === 0}>◀ previous</button>
        <span className="mono">← → to move · C for contents · Esc to leave</span>
        <button onClick={() => setI((x) => Math.min(total - 1, x + 1))} disabled={at === total - 1}>next ▶</button>
      </div>
      {contents && (
        <div className="present-arrange present-contents" onClick={(e) => e.stopPropagation()}>
          <div className="mono" style={{ marginBottom: 6 }}>contents · {total} slides</div>
          {slides.map((s, k) => (
            <div key={s.id} className={"present-item present-toc-item" + (k === at ? " current" : "")} onClick={() => { setI(k); setContents(false); }} title={s.title}>
              <span className="mono" style={{ width: 22 }}>{k + 1}</span>
              <span className="chip" style={{ color: AI_COLOR, fontSize: 10 }}>{s.type.replace("_", " ")}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</span>
            </div>
          ))}
          <div className={"present-item present-toc-item" + (at === total - 1 ? " current" : "")} onClick={() => { setI(total - 1); setContents(false); }}>
            <span className="mono" style={{ width: 22 }}>{total}</span>
            <span className="chip" style={{ fontSize: 10 }}>closing</span>
            <span style={{ flex: 1 }}>Decisions{assumptions.length ? " and assumptions" : ""}</span>
          </div>
        </div>
      )}
      {arranging && (
        <div className="present-arrange" onClick={(e) => e.stopPropagation()}>
          <div className="row" style={{ marginBottom: 6 }}>
            <span className="mono">order</span>
            <span className="grow" />
            <button className="icon" onClick={resetOrder} title="Back to the canvas order, every card included">reset</button>
          </div>
          {artifacts.map((x) => {
            const k = ids.indexOf(x.id);
            return (
              <div key={x.id} className={"row present-item" + (k < 0 ? " off" : "")} style={{ gap: 4 }}>
                <input type="checkbox" checked={k >= 0} onChange={() => toggle(x.id)} title={k >= 0 ? "Leave this card out" : "Include this card"} />
                <span className="mono" style={{ width: 20 }}>{k >= 0 ? k + 1 : ""}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} onClick={() => k >= 0 && setI(k)}>{x.title}</span>
                <button className="icon" disabled={k <= 0} onClick={() => move(x.id, -1)}>↑</button>
                <button className="icon" disabled={k < 0 || k >= ids.length - 1} onClick={() => move(x.id, 1)}>↓</button>
              </div>
            );
          })}
        </div>
      )}
    </div>,
    document.body,
  );
}
