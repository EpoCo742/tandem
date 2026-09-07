import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

const EMPTY_SET: Set<string> = new Set();
const ChangedRowsContext = createContext<Set<string>>(EMPTY_SET);
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { participantName, modelToMermaid, modelDiff, diffModels, compareMermaid, boundaryColor, violationsOf, contractsOf, contractsConsumedBy, threadsFor, AI_COLOR, type AlternativesContent, type Artifact, type ArchModelContent, type ConstraintsContent, type DecisionPointContent, type DataModelContent, type MermaidContent, type MarkdownContent, type CodeContent, type SourceContent, type ViewContent, type ContractContent } from "@tandem/shared";
import { api } from "../api";
import { useStore } from "../state/store";
import { Mermaid } from "./Mermaid";
import { ArtifactEditor } from "./ArtifactEditor";
import { AlternativesView } from "./AlternativesView";
import { ReviewPanel } from "./ReviewPanel";
import { PublishPanel } from "./PublishPanel";
import { ContractSpec } from "./ContractSpec";
import { useZoom, ZoomBar, ZoomBody } from "./Zoomable";
import { parseContract } from "@tandem/shared";
import { ImpactPanel } from "./ImpactPanel";
import { navigate } from "../App";
import { recordAction } from "../undo";
import { ImportModel } from "./ImportModel";
import { MermaidLegend } from "./MermaidLegend";

// Render ```mermaid fences inside Markdown cards as diagrams instead of code.
const mdComponents: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  code({ className, children }) {
    const text = String(children).replace(/\n$/, "");
    if (className === "language-mermaid") return <Mermaid source={text} />;
    return <code className={className}>{children}</code>;
  },
};

// True for a moment after the version changes (not on first render): the card lights up so a
// change made by the AI or by someone else is seen, not just present.
function useGlow(versionNo: number, ms = 2600): boolean {
  const [glow, setGlow] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setGlow(true);
    const t = setTimeout(() => setGlow(false), ms);
    return () => clearTimeout(t);
  }, [versionNo, ms]);
  return glow;
}

// Ids of the rows that differ between the previous version and this one (model components,
// constraints), so a table can light up only what changed.
function changedRows(a: Artifact): Set<string> {
  const prev = a.versions.length > 1 ? a.versions[a.versions.length - 2] : undefined;
  if (!prev) return new Set();
  const key = (c: unknown) => JSON.stringify(c);
  const out = new Set<string>();
  if (a.type === "arch_model") {
    const before = new Map(((prev.content as ArchModelContent).components ?? []).map((c) => [c.id, key(c)]));
    for (const c of (a.current.content as ArchModelContent).components ?? []) if (before.get(c.id) !== key(c)) out.add(c.id);
  } else if (a.type === "constraints") {
    const before = new Map(((prev.content as ConstraintsContent).constraints ?? []).map((c) => [c.id, key(c)]));
    for (const c of (a.current.content as ConstraintsContent).constraints ?? []) if (before.get(c.id) !== key(c)) out.add(c.id);
  }
  return out;
}

export function ArtifactCard({ artifact: a, sessionId, sized = false, onResetSize }: { artifact: Artifact; sessionId: string; sized?: boolean; onResetSize?: () => void }) {
  const state = useStore((s) => s.state);
  const seenAtOpen = useStore((s) => s.seenAtOpen);
  const acknowledged = useStore((s) => s.acknowledged[a.id]);
  const acknowledge = useStore((s) => s.acknowledge);
  const glow = useGlow(a.current.versionNo);
  const changed = glow ? changedRows(a) : EMPTY_SET;
  const currentSeq = state.eventsById[a.current.eventId]?.seq ?? 0;
  const fresh = !acknowledged && currentSeq > seenAtOpen && seenAtOpen > 0;
  const me = useStore((s) => s.me)!;
  const setHighlight = useStore((s) => s.setHighlight);
  const setThreadTarget = useStore((s) => s.setThreadTarget);
  const openThreads = threadsFor(state, a.id).filter((t) => !t.resolved).length;
  const [editing, setEditing] = useState(false);
  const [viewVersion, setViewVersion] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const zoom = useZoom(1);
  const isDiagram = a.type === "mermaid" || a.type === "view";
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
      else zoom.onKey(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, zoom.onKey]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const editors = useStore((s) => s.editing[a.id]) ?? [];
  const selectors = useStore((s) => s.selections[a.id]) ?? [];
  // Uploads stay first-class for provenance but start folded so generated work has the room.
  const [open, setOpen] = useState(a.type !== "source");

  const v = viewVersion ? a.versions.find((x) => x.versionNo === viewVersion) ?? a.current : a.current;
  const authorColor = state.participants[v.authorUserId]?.color ?? AI_COLOR;
  const authorLabel = `${v.authorKind === "ai" ? "AI for " : ""}${participantName(state, v.authorUserId)}`;
  const derived = [...new Set(v.provenance.flatMap((p) => p.derivedFrom))].filter((id) => state.eventsById[id]);
  const isDp = a.type === "decision_point";
  const pending = Object.values(state.proposals).filter((p) => p.artifactId === a.id && p.status === "pending").length;

  const [renaming, setRenaming] = useState<string | null>(null);
  async function rename(value: string) {
    const title = value.trim();
    setRenaming(null);
    if (!title || title === a.title) return;
    setMsg(null);
    try {
      const r = await api<{ status: string; approvers?: string[] }>("POST", `/api/v1/sessions/${sessionId}/artifacts/${a.id}/versions`, { content: a.current.content, title, rationale: `Renamed to "${title}"` });
      if (r.status === "pending_approval") setMsg(`Rename proposed; waiting for ${(r.approvers ?? []).map((u) => participantName(state, u)).join(", ")}.`);
      else if (r.status !== "applied") setMsg(`Could not rename: ${r.status.replace(/_/g, " ")}.`);
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function remove() {
    setConfirmDelete(false);
    setMsg(null);
    try {
      const r = await api<{ status: string; approvers?: string[] }>("DELETE", `/api/v1/sessions/${sessionId}/artifacts/${a.id}`, { rationale: "Removed from the canvas" });
      if (r.status === "applied") {
        recordAction({
          label: `the removal of "${a.title}"`,
          undo: () => api("POST", `/api/v1/sessions/${sessionId}/artifacts/${a.id}/restore`).then(() => undefined),
          redo: () => api("DELETE", `/api/v1/sessions/${sessionId}/artifacts/${a.id}`, { rationale: "Removed again (redo)" }).then(() => undefined),
        });
      }
      if (r.status === "pending_approval") setMsg(`Removal proposed; waiting for ${(r.approvers ?? []).map((u) => participantName(state, u)).join(", ")}.`);
      else if (r.status !== "applied") setMsg(`Could not remove: ${r.status.replace(/_/g, " ")}.`);
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function vote(optionId: string) {
    setMsg(null);
    try {
      const r = await api<{ resolved: boolean }>("POST", `/api/v1/sessions/${sessionId}/decision-points/${a.id}/vote`, { optionId });
      setMsg(r.resolved ? "Resolved. The AI is applying the outcome." : "Vote recorded; waiting for a majority.");
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  return (
    <div className={"art type-" + a.type + (sized ? " sized" : "") + (a.blockedByDecisionPoint ? " blocked" : "") + (isDp ? " dp" : "") + (glow ? " glow" : "") + (fresh ? " fresh" : "")} style={{ borderTopColor: isDp ? undefined : authorColor, ...(selectors[0] ? { boxShadow: `0 0 0 2px ${selectors[0].color}, var(--shadow)` } : {}) }} onMouseDown={() => fresh && acknowledge(a.id)}>
      <ChangedRowsContext.Provider value={changed}>
      <div className="art-head">
        {fresh && <span className="chip fresh-chip" title="Changed since you last looked at this session">new</span>}
        <span className="chip" style={{ color: isDp ? "var(--warn)" : AI_COLOR }}>{a.type.replace("_", " ")}</span>
        {renaming === null ? (
          <span className="title" title={`${a.title} (double-click to rename)`} onDoubleClick={() => !a.blockedByDecisionPoint && setRenaming(a.title)}>{a.title}</span>
        ) : (
          <input
            className="title-edit nodrag"
            autoFocus
            value={renaming}
            onChange={(e) => setRenaming(e.target.value)}
            onBlur={(e) => rename(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === "Enter") rename(e.currentTarget.value); if (e.key === "Escape") setRenaming(null); }}
          />
        )}
        <span className="mono">v{v.versionNo}</span>
        {a.blockedByDecisionPoint && <span className="chip" style={{ color: "var(--warn)" }} title="blocked until the decision point resolves">blocked</span>}
        {a.type === "design_doc" && (() => { const r = state.reviews[a.id]; const st = r?.status ?? "draft"; return <span className={"chip status-" + st} title={st === "approved" ? `Approved at v${r?.approvedVersionNo}` : st === "in_review" ? `${Object.keys(r?.signoffs ?? {}).length} of ${r?.reviewers.length ?? 0} signed` : "Draft; not yet reviewed"}>{st === "in_review" ? "in review" : st}</span>; })()}
        {pending > 0 && <span className="chip accent">{pending} pending</span>}
        {a.type === "arch_model" && (() => { const n = violationsOf(state).length; return n ? <span className="chip" style={{ color: "var(--warn)", borderColor: "var(--warn)" }} title="Classified flows that break a residency or security constraint; see the relationships below">{n} flow violation{n === 1 ? "" : "s"}</span> : null; })()}
        {editors.map((u) => <span key={u.userId} className="chip solid" style={{ background: u.color }} title={`${u.name} has this card open in the editor`}>{u.name} editing</span>)}
        {selectors.filter((u) => !editors.some((e) => e.userId === u.userId)).map((u) => <span key={u.userId} className="chip" style={{ color: u.color, borderColor: u.color }} title={`${u.name} has this card selected`}>{u.name}</span>)}
        {a.type === "source" && <button className="icon nodrag" style={{ padding: "0 5px" }} title={open ? "Fold this upload" : "Show the uploaded content"} onClick={() => setOpen((o) => !o)}>{open ? "▴" : "▾"}</button>}
        {sized && onResetSize && <button className="icon nodrag" style={{ padding: "0 5px" }} title="Back to automatic size" onClick={onResetSize}>&#x21BA;</button>}
        <button className={"icon nodrag" + (openThreads ? " has-threads" : "")} style={{ padding: "0 5px" }} title={openThreads ? `${openThreads} open thread${openThreads === 1 ? "" : "s"} on this card` : "Start a thread on this card (people only; promote a message to bring the AI in)"} onClick={() => setThreadTarget({ artifactId: a.id })}>&#x1F5E8;{openThreads ? <span className="mono" style={{ marginLeft: 2 }}>{openThreads}</span> : null}</button>
        <button className="icon nodrag" style={{ padding: "0 5px" }} title="Open this card full size" onClick={() => setExpanded(true)}>&#x2922;</button>
      </div>
      {open ? (
      <div className="art-body nodrag nowheel">
        <ArtifactBody artifact={a} version={v} sessionId={sessionId} myId={me.user!.id} onVote={vote} />
        {msg && <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>{msg}</div>}
      </div>
      ) : (
        <div className="art-body art-folded nodrag" onDoubleClick={() => setOpen(true)}>
          <span className="mono">{(v.content as SourceContent).kind} · {(v.content as SourceContent).mime}</span>
          <span className="muted" style={{ marginLeft: 8 }}>{(v.content as SourceContent).aiSummary}</span>
          {msg && <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>{msg}</div>}
        </div>
      )}
      <div className="art-foot">
        <span style={{ color: authorColor }}>{authorLabel}</span>
        {derived.length > 0 && (
          <button title="Highlight the messages this version was derived from" onClick={() => setHighlight(derived)}>from {derived.length} msg{derived.length > 1 ? "s" : ""}</button>
        )}
        <span className="grow" />
        {a.versions.length > 1 && (
          <select value={viewVersion ?? a.current.versionNo} onChange={(e) => setViewVersion(Number(e.target.value) === a.current.versionNo ? null : Number(e.target.value))} style={{ width: "auto", padding: "0 4px", fontSize: 10.5 }}>
            {a.versions.map((x) => <option key={x.versionId} value={x.versionNo}>v{x.versionNo} · {participantName(state, x.authorUserId)}</option>)}
          </select>
        )}
        {a.type === "design_doc" && (
          <button
            title="Download this document as Markdown"
            onClick={() => {
              const blob = new Blob([(v.content as MarkdownContent).markdown], { type: "text/markdown" });
              const url = URL.createObjectURL(blob);
              const el = document.createElement("a");
              el.href = url;
              el.download = `${a.title.replace(/[^\w-]+/g, "-")}-v${v.versionNo}.md`;
              el.click();
              URL.revokeObjectURL(url);
            }}
          >
            download .md
          </button>
        )}
        {a.type === "design_doc" && (
          <button title="Read this document as a page: contents, versions, status, print" onClick={() => navigate(`/s/${sessionId}/doc/${a.id}`)}>
            read
          </button>
        )}
        {!isDp && a.type !== "source" && <button onClick={() => setEditing(true)} disabled={Boolean(a.blockedByDecisionPoint)}>edit</button>}
        {!isDp && !confirmDelete && <button title="Remove this card from the canvas (it stays in history)" onClick={() => setConfirmDelete(true)} disabled={Boolean(a.blockedByDecisionPoint)}>delete</button>}
        {confirmDelete && (
          <span className="confirm">
            <button className="danger" onClick={remove}>confirm delete</button>
            <button onClick={() => setConfirmDelete(false)}>cancel</button>
          </span>
        )}
      </div>
      </ChangedRowsContext.Provider>
      {editing && <ArtifactEditor artifact={a} sessionId={sessionId} onClose={() => setEditing(false)} />}
      {expanded && createPortal(
        <div className="modal-bg nodrag nowheel" onClick={() => setExpanded(false)}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <div className="row">
              <span className="chip" style={{ color: AI_COLOR }}>{a.type.replace("_", " ")}</span>
              <b style={{ flex: 1 }}>{a.title}</b>
              <span className="mono">v{v.versionNo} &middot; {authorLabel}</span>
              <ZoomBar z={zoom} diagram={isDiagram} />
              <button onClick={() => setExpanded(false)} title="Close (Esc)">close</button>
            </div>
            <ZoomBody z={zoom} diagram={isDiagram} className={"modal-body" + (isDiagram ? " diagram-full" : " md-doc")}>
              <ArtifactBody artifact={a} version={v} sessionId={sessionId} myId={me.user!.id} onVote={vote} large />
            </ZoomBody>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

export function ArtifactBody({ artifact: a, version: v, sessionId, myId, onVote, large = false }: { artifact: Artifact; version: Artifact["current"]; sessionId: string; myId: string; onVote: (id: string) => void; large?: boolean }) {
  return (
    <>
      {a.type === "mermaid" && <Mermaid source={(v.content as MermaidContent).source} />}
      {a.type === "design_doc" && <ReviewPanel artifact={a} sessionId={sessionId} />}
      {a.type === "design_doc" && <PublishPanel artifact={a} sessionId={sessionId} />}
      {(a.type === "markdown" || a.type === "design_doc") && <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{(v.content as MarkdownContent).markdown}</ReactMarkdown></div>}
      {a.type === "code" && <pre>{(v.content as CodeContent).source}</pre>}
      {a.type === "contract" && <ContractView artifactId={a.id} content={v.content as ContractContent} />}
      {a.type === "data_model" && <DataModel content={v.content as DataModelContent} />}
      {a.type === "source" && <SourceView sessionId={sessionId} content={v.content as SourceContent} full={large} />}
      {a.type === "arch_model" && <ModelTable content={v.content as ArchModelContent} artifactId={a.id} />}
      {a.type === "constraints" && <ConstraintsTable content={v.content as ConstraintsContent} />}
      {a.type === "alternatives" && <AlternativesView content={v.content as AlternativesContent} artifactId={a.id} sessionId={sessionId} large={large} />}
      {a.type === "view" && <ModelView content={v.content as ViewContent} />}
      {a.type === "decision_point" && <DecisionPoint content={v.content as DecisionPointContent} myId={myId} onVote={onVote} sessionId={sessionId} artifactId={a.id} />}
    </>
  );
}

function SourceView({ sessionId, content, full = false }: { sessionId: string; content: SourceContent; full?: boolean }) {
  const url = `/api/v1/sessions/${sessionId}/files/${content.uploadId}`;
  if (content.kind === "image") return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={content.name} style={{ maxWidth: "100%", display: "block" }} /></a>;
  const text = content.extractedText ?? content.aiSummary;
  const LIMIT = 6000;
  const clipped = !full && text.length > LIMIT;
  const shown = clipped ? text.slice(0, LIMIT) : text;
  return (
    <div>
      <div className="mono" style={{ marginBottom: 6 }}>{content.kind} &middot; {content.mime} &middot; <a href={url} target="_blank" rel="noreferrer">open original</a></div>
      {content.kind === "markdown" ? <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{shown}</ReactMarkdown></div> : <pre>{shown}</pre>}
      {clipped && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Showing the first {LIMIT.toLocaleString()} characters. Open the card full size for all of it.</div>}
    </div>
  );
}

// The rules the design has to respect: who set each one and where it came from.
function ConstraintsTable({ content }: { content: ConstraintsContent }) {
  const changedRows = useContext(ChangedRowsContext);
  const state = useStore((s) => s.state);
  const setHighlight = useStore((s) => s.setHighlight);
  const sourceLabel = (k: ConstraintsContent["constraints"][number]) => {
    if (!k.source) return null;
    const art = state.artifacts[k.source];
    if (art) return <span className="mono" title="from an uploaded document">from {art.title}</span>;
    if (state.eventsById[k.source]) return <button className="icon" style={{ padding: "0 5px" }} onClick={() => setHighlight([k.source!])} title="Highlight the message that set it">message</button>;
    return null;
  };
  const kindLabel = { must: "must", must_not: "must not", target: "target" } as const;
  const exceptionsOf = (id: string) => content.constraints.filter((k) => k.exceptionTo === id).map((k) => k.id);
  return (
    <div className="stack">
      <div className="muted" style={{ fontSize: 12 }}>Every change the AI makes is checked against these; a directive that breaks one becomes a decision point rather than a change. Amending, excepting or removing a constraint needs the person who set it.</div>
      <table>
        <thead><tr><th>Constraint</th><th>Kind</th><th>Area</th><th>Set by</th></tr></thead>
        <tbody>
          {content.constraints.map((k) => (
            <tr key={k.id} className={changedRows.has(k.id) ? "row-changed" : ""}>
              <td>
                <span className="mono">{k.id}</span> {k.statement}{k.value ? <span className="mono" style={{ marginLeft: 6 }}>{k.value}</span> : null}
                {k.exceptionTo && <span className="chip" style={{ marginLeft: 6 }} title={`Relaxes ${k.exceptionTo}; agreed by whoever set it`}>exception to {k.exceptionTo}</span>}
                {exceptionsOf(k.id).length > 0 && <span className="chip" style={{ marginLeft: 6, color: "var(--ok)" }} title="Exceptions recorded against this constraint">{exceptionsOf(k.id).join(", ")} excepted</span>}
                {k.importedFrom && <span className="chip" style={{ marginLeft: 6, color: "var(--accent)" }} title={`Copied from session "${k.importedFrom.sessionTitle}" (${k.importedFrom.refId}) through the library`}>from {k.importedFrom.sessionTitle}</span>}
              </td>
              <td className="mono">{kindLabel[k.kind]}</td>
              <td className="mono">{k.category.replace(/_/g, " ")}</td>
              <td>
                {k.setBy ? <span style={{ color: state.participants[k.setBy]?.color }}>{participantName(state, k.setBy)}</span> : <span className="muted">document</span>}
                {" "}{sourceLabel(k)}
              </td>
            </tr>
          ))}
          {content.constraints.length === 0 && <tr><td colSpan={4} className="muted">none yet</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// "top to bottom" or "left to right" for this view; stored on the view as an ordinary edit.
function DirectionToggle({ content }: { content: ViewContent }) {
  const meta = useStore((s) => s.meta);
  const state = useStore((s) => s.state);
  const artifact = Object.values(state.artifacts).find((a) => a.type === "view" && !a.deleted && a.current.content === content);
  if (!meta || !artifact) return null;
  const set = (direction: "TB" | "LR" | undefined) => api("POST", `/api/v1/sessions/${meta.id}/artifacts/${artifact.id}/versions`, { content: { ...content, direction }, rationale: direction ? `Drawn ${direction === "TB" ? "top to bottom" : "left to right"}` : "Direction chosen automatically" }).catch(() => undefined);
  return (
    <div className="row" style={{ gap: 4, marginTop: 4 }}>
      <span className="mono">direction</span>
      {(["auto", "TB", "LR"] as const).map((d) => (
        <button key={d} className={"icon" + ((content.direction ?? "auto") === d ? " primary" : "")} onClick={() => set(d === "auto" ? undefined : d)} title={d === "auto" ? "Let the shape of the model decide" : d === "TB" ? "Top to bottom" : "Left to right"}>{d === "auto" ? "auto" : d === "TB" ? "top-down" : "left-right"}</button>
      ))}
    </div>
  );
}

// A view card draws itself from the session's architecture model, so it never goes stale.
function ModelView({ content }: { content: ViewContent }) {
  const state = useStore((s) => s.state);
  const model = Object.values(state.artifacts).find((x) => x.type === "arch_model" && !x.deleted)?.current.content as ArchModelContent | undefined;
  if (!model) return <div className="muted">No architecture model yet. Describe the systems involved and the AI will build one.</div>;
  const focusName = content.focus ? model.components.find((c) => c.id === content.focus)?.name : undefined;
  return (
    <div>
      <div className="mono" style={{ marginBottom: 6 }}>{content.kind === "diff" ? "as-is vs to-be" : `${content.kind} view`}{focusName ? ` ${content.kind === "sequence" ? "from" : "of"} ${focusName}` : ""}{content.kind === "deployment" ? ` · ${content.environment ?? model.deployment?.environments[0] ?? "production"}` : ""} · {content.kind === "sequence" ? `${content.depth ?? 3} hops` : content.kind === "deployment" ? `${model.deployment?.nodes.length ?? 0} nodes` : `${model.components.length} components`}</div>
      {content.kind === "diff" && !model.asIs && <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>No as-is baseline yet. Ask the AI to draw the current architecture of a repository, or attach its docker-compose.yml.</div>}
      {(() => { const src = modelToMermaid(model, content, { violating: new Set(violationsOf(state).map((v) => v.relationshipId)) }); return <><Mermaid source={src} /><MermaidLegend source={src} /></>; })()}
      {(content.kind === "container" || content.kind === "context" || content.kind === "component" || content.kind === "diff") && <DirectionToggle content={content} />}
      {content.kind === "diff" && model.asIs && (() => { const d = modelDiff(model)!; return <div className="mono" style={{ marginTop: 6, fontSize: 11 }}><span style={{ color: "var(--ok)" }}>+{d.added.length} added</span> · <span style={{ color: "var(--warn)" }}>−{d.removed.length} removed</span> · <span style={{ color: "var(--accent)" }}>~{d.changed.length} changed</span> · {d.same.length} unchanged · as-is from {model.asIs.source}</div>; })()}
      {content.note && <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>{content.note}</div>}
    </div>
  );
}

function ModelTable({ content, artifactId }: { content: ArchModelContent; artifactId: string }) {
  const changedRows = useContext(ChangedRowsContext);
  const [impactOf, setImpactOf] = useState<string | null>(null);
  const state = useStore((s) => s.state);
  const violations = violationsOf(state);
  const focus = useStore((s) => s.focusComponentId);
  const setFocus = useStore((s) => s.setFocusComponent);
  const setThreadTarget = useStore((s) => s.setThreadTarget);
  const threadsOn = (id: string) => threadsFor(state, artifactId).filter((t) => t.anchor.componentId === id && !t.resolved).length;
  const diff = modelDiff(content);
  const statusOf = (id: string): "added" | "changed" | null => (diff ? (diff.added.some((c) => c.id === id) ? "added" : diff.changed.some((x) => x.after.id === id) ? "changed" : null) : null);
  const bname = (id?: string) => (id ? content.boundaries.find((b) => b.id === id)?.name ?? id : "");
  const name = (id: string) => content.components.find((c) => c.id === id)?.name ?? id;
  const decisionsAbout = (id: string) => Object.values(state.decisions).filter((d) => d.about.includes(id) && d.status !== "superseded").length;
  return (
    <div className="stack">
      <div className="muted" style={{ fontSize: 12 }}>The source of truth for structure. Views are drawn from it; click a component to see its decisions, or start a thread on one.</div>
      {content.asIs && diff && (
        <div className="consent" style={{ fontSize: 12 }} title={content.asIs.notes?.join("\n")}>
          As-is from <span className="mono">{content.asIs.source}</span>; this model is the target state: <span style={{ color: "var(--ok)" }}>{diff.added.length} added</span>, <span style={{ color: "var(--warn)" }}>{diff.removed.length} removed{diff.removed.length ? ` (${diff.removed.map((c) => c.name).join(", ")})` : ""}</span>, <span style={{ color: "var(--accent)" }}>{diff.changed.length} changed</span>.
        </div>
      )}
      <table>
        <thead><tr><th>Component</th><th>Kind</th><th>Technology</th><th>Boundary</th><th></th></tr></thead>
        <tbody>
          {content.components.map((c) => {
            const n = decisionsAbout(c.id);
            return (
              <tr key={c.id} className={(focus === c.id ? "focus" : "") + (changedRows.has(c.id) ? " row-changed" : "")} onClick={() => setFocus(focus === c.id ? null : c.id)} style={{ cursor: "pointer" }} title={c.description ?? c.id}>
                <td><b>{c.name}</b>{n ? <span className="chip" style={{ marginLeft: 6, color: "var(--ok)" }}>{n} decision{n === 1 ? "" : "s"}</span> : null}{statusOf(c.id) && <span className="chip" style={{ marginLeft: 6, color: statusOf(c.id) === "added" ? "var(--ok)" : "var(--accent)" }} title="Against the as-is baseline">{statusOf(c.id)}</span>}{c.importedFrom && <span className="chip" style={{ marginLeft: 6, color: "var(--accent)" }} title={`Copied from session "${c.importedFrom.sessionTitle}" through the library`}>from {c.importedFrom.sessionTitle}</span>}{contractsConsumedBy(state, c.id).map((k) => <span key={k.artifact.id} className="chip" style={{ marginLeft: 6, color: k.changedAfterModel ? "var(--warn)" : "var(--link)", ...(k.changedAfterModel ? { borderColor: "var(--warn)" } : {}) }} title={k.changedAfterModel ? `${k.artifact.title} v${k.artifact.current.versionNo} changed after the model; this consumer may not have caught up` : `Consumes ${k.artifact.title} v${k.artifact.current.versionNo}`}>{k.changedAfterModel ? "contract changed" : `contract v${k.artifact.current.versionNo}`}</span>)}</td>
                <td className="mono">{c.kind}</td>
                <td className="mono">{c.technology ?? ""}</td>
                <td className="mono">{c.boundary ? <><span className="swatch" style={{ background: boundaryColor(content, c.boundary) }} />{bname(c.boundary)}</> : ""}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <button className="icon" style={{ padding: "0 4px" }} title={`What depends on ${c.name}: decisions, constraints, views, documents, threads`} onClick={(e) => { e.stopPropagation(); setImpactOf(c.id); }}>&#x2058;</button>
                  <button className="icon" style={{ padding: "0 4px" }} title={threadsOn(c.id) ? `${threadsOn(c.id)} open thread(s) on ${c.name}` : `Start a thread on ${c.name}`} onClick={(e) => { e.stopPropagation(); setThreadTarget({ artifactId, componentId: c.id }); }}>
                    &#x1F5E8;{threadsOn(c.id) ? <span className="mono" style={{ marginLeft: 2 }}>{threadsOn(c.id)}</span> : null}
                  </button>
                </td>
              </tr>
            );
          })}
          {content.components.length === 0 && <tr><td colSpan={5} className="muted">empty</td></tr>}
        </tbody>
      </table>
      {content.relationships.length > 0 && (
        <div className="mono" style={{ lineHeight: 1.6 }}>
          {content.relationships.map((r) => {
            const bad = violations.filter((v) => v.relationshipId === r.id);
            return (
              <div key={r.id}>
                {name(r.from)} <span className="muted">{r.kind.replace("_", " ")}</span> {name(r.to)}{r.label ? <span className="muted"> ({r.label})</span> : null}
                {(r.dataClasses ?? []).map((c) => <span key={c} className="chip" style={{ marginLeft: 5, color: c === "internal" || c === "public" ? "var(--ink-3)" : "var(--accent)" }} title="What this flow carries">{c === "pii" ? "PII" : c}</span>)}
                {bad.map((v) => <span key={v.constraintId} className="chip" style={{ marginLeft: 5, color: "var(--warn)", borderColor: "var(--warn)" }} title={v.reason}>breaks {v.constraintId}</span>)}
              </div>
            );
          })}
        </div>
      )}
      {content.boundaries.length > 0 && <BoundaryLegend artifactId={artifactId} content={content} />}
      {content.deployment && content.deployment.nodes.length > 0 && (
        <div className="mono" style={{ marginTop: 6, lineHeight: 1.6 }}>
          {content.deployment.environments.map((env) => (
            <div key={env}>
              <span className="muted">{env}:</span>{" "}
              {content.deployment!.nodes.map((n) => {
                const on = Object.entries(content.deployment!.placements[env] ?? {}).filter(([, nid]) => nid === n.id).map(([cid]) => name(cid));
                return <span key={n.id} style={{ marginRight: 10 }} title={[n.kind, n.technology, n.region ? `region ${n.region}` : "", n.trust ? `${n.trust} trust` : ""].filter(Boolean).join(", ")}><b>{n.name}</b>{n.region ? <span className="muted"> {n.region}</span> : null}{n.trust === "public" ? <span style={{ color: "var(--warn)" }}> public</span> : null}: {on.join(", ") || "—"}</span>;
              })}
            </div>
          ))}
        </div>
      )}
      {content.relationships.length > 0 && <SequenceFrom content={content} />}
      <ImportButton />
      <CompareVersions artifactId={artifactId} current={content} />
      {impactOf && <ImpactPanel componentId={impactOf} onClose={() => setImpactOf(null)} />}
    </div>
  );
}

// A contract card: format, what it is attached to, who provides and consumes it, and the text.
function ContractView({ artifactId, content }: { artifactId: string; content: ContractContent }) {
  const state = useStore((s) => s.state);
  const setFocus = useStore((s) => s.setFocusComponent);
  const st = contractsOf(state).find((c) => c.artifact.id === artifactId);
  const model = Object.values(state.artifacts).find((x) => x.type === "arch_model" && !x.deleted)?.current.content as ArchModelContent | undefined;
  const cname = (id: string) => model?.components.find((c) => c.id === id)?.name ?? id;
  const spec = useMemo(() => parseContract(content.body), [content.body]);
  const [raw, setRaw] = useState(false);
  return (
    <div>
      <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
        <span className="chip" style={{ color: "var(--link)" }}>{content.format}{content.version ? ` ${content.version}` : ""}</span>
        {spec && <button className="icon" onClick={() => setRaw((v) => !v)} title={raw ? "Endpoints grouped and readable" : "The contract text as written"}>{raw ? "reference" : "raw"}</button>}
        {st?.provider && <span className="mono">provided by <a href="#" onClick={(e) => { e.preventDefault(); setFocus(st.provider!); }}>{cname(st.provider)}</a></span>}
        {st && st.consumers.length > 0 && <span className="mono">consumed by {st.consumers.map((id, i) => <span key={id}>{i ? ", " : ""}<a href="#" onClick={(e) => { e.preventDefault(); setFocus(id); }}>{cname(id)}</a></span>)}</span>}
        {!content.attachedTo?.relationshipId && !content.attachedTo?.componentId && <span className="muted" style={{ fontSize: 12 }}>not attached to the model yet</span>}
        {st?.changedAfterModel && <span className="chip" style={{ color: "var(--warn)", borderColor: "var(--warn)" }} title="This contract changed after the model last changed; the consumers may not have caught up">changed after the model</span>}
      </div>
      {spec && !raw ? <ContractSpec spec={spec} /> : content.format === "markdown" ? <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{content.body}</ReactMarkdown></div> : <pre>{content.body}</pre>}
    </div>
  );
}

// "import…": paste a diagram in another notation into the model.
function ImportButton() {
  const meta = useStore((s) => s.meta);
  const [open, setOpen] = useState(false);
  if (!meta) return null;
  return (
    <div className="row" style={{ gap: 6, marginTop: 6 }}>
      <button className="icon" onClick={() => setOpen(true)} title="Paste a Mermaid flowchart, Structurizr DSL or PlantUML component diagram and merge it into the model, replace the model, or record it as the as-is baseline">import…</button>
      <a className="mono" href={`/api/v1/sessions/${meta.id}/export?format=structurizr`} title="Download the model as Structurizr DSL">structurizr .dsl</a>
      {open && <ImportModel sessionId={meta.id} onClose={() => setOpen(false)} />}
    </div>
  );
}

// "Sequence from Service A": a sequence view generated from the model's relationships, no AI turn.
function SequenceFrom({ content }: { content: ArchModelContent }) {
  const meta = useStore((s) => s.meta);
  const [msg, setMsg] = useState<string | null>(null);
  const starts = content.components.filter((c) => content.relationships.some((r) => r.from === c.id));
  if (!meta || starts.length === 0) return null;
  async function create(id: string) {
    const c = content.components.find((x) => x.id === id)!;
    setMsg(null);
    try {
      const r = await api<{ status: string; approvers?: string[] }>("POST", `/api/v1/sessions/${meta!.id}/artifacts`, { type: "view", title: `Sequence from ${c.name}`, content: { kind: "sequence", focus: id, depth: 3, sections: [{ id: "body", derivedFrom: [] }] }, summary: `Sequence view from ${c.name}` });
      setMsg(r.status === "applied" ? `Added "Sequence from ${c.name}" to the canvas.` : `Sequence view ${r.status.replace(/_/g, " ")}.`);
    } catch (e) {
      setMsg((e as Error).message);
    }
  }
  return (
    <div className="row" style={{ gap: 6, marginTop: 6 }}>
      <span className="mono">sequence from</span>
      <select defaultValue="" onChange={(e) => { if (e.target.value) { void create(e.target.value); e.target.value = ""; } }} style={{ width: "auto", padding: "0 4px", fontSize: 10.5 }} title="Generate a sequence diagram that follows the relationships from this component; it redraws when the model changes">
        <option value="">choose a component</option>
        {starts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      {msg && <span className="muted" style={{ fontSize: 11 }}>{msg}</span>}
    </div>
  );
}

// Boundaries with their tints; picking a colour is an ordinary edit of the model card.
function BoundaryLegend({ artifactId, content }: { artifactId: string; content: ArchModelContent }) {
  const meta = useStore((s) => s.meta);
  const [msg, setMsg] = useState<string | null>(null);
  async function recolor(id: string, color: string) {
    if (!meta) return;
    const next = { ...content, boundaries: content.boundaries.map((b) => (b.id === id ? { ...b, color } : b)) };
    try {
      const r = await api<{ status: string }>("POST", `/api/v1/sessions/${meta.id}/artifacts/${artifactId}/versions`, { content: next, rationale: `Recoloured boundary ${id}` });
      setMsg(r.status === "applied" ? null : `Colour change ${r.status.replace(/_/g, " ")}`);
    } catch (e) {
      setMsg((e as Error).message);
    }
  }
  return (
    <div className="row" style={{ gap: 10, flexWrap: "wrap", marginTop: 6 }}>
      {content.boundaries.map((b) => {
        const c = boundaryColor(content, b.id);
        return (
          <label key={b.id} className="mono" style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }} title={`${b.name} (${b.kind ?? "system"}${b.region ? `, region ${b.region}` : ""}${b.trust ? `, ${b.trust} trust` : ""}); click the swatch to change its tint in every view`}>
            <input type="color" value={c} onChange={(e) => void recolor(b.id, e.target.value)} style={{ width: 16, height: 16, padding: 0, border: "none", background: "transparent" }} />
            <span style={{ color: c }}>{b.name}</span>
            {b.region && <span className="muted">{b.region}</span>}
            {b.trust === "public" && <span style={{ color: "var(--warn)" }}>public</span>}
          </label>
        );
      })}
      {msg && <span className="muted" style={{ fontSize: 11 }}>{msg}</span>}
    </div>
  );
}

// "Compare with v3": the model at an earlier version against the model now, drawn like the as-is view.
function CompareVersions({ artifactId, current }: { artifactId: string; current: ArchModelContent }) {
  const state = useStore((s) => s.state);
  const [against, setAgainst] = useState<number | null>(null);
  const a = state.artifacts[artifactId];
  if (!a || a.versions.length < 2) return null;
  const older = against ? a.versions.find((v) => v.versionNo === against) : undefined;
  const before = older?.content as ArchModelContent | undefined;
  const d = before ? diffModels(before, current) : null;
  return (
    <div className="compare">
      <div className="row" style={{ gap: 6 }}>
        <span className="mono">compare with</span>
        <select value={against ?? ""} onChange={(e) => setAgainst(e.target.value ? Number(e.target.value) : null)} style={{ width: "auto", padding: "0 4px", fontSize: 10.5 }}>
          <option value="">choose an earlier version</option>
          {a.versions.filter((v) => v.versionNo !== a.current.versionNo).map((v) => <option key={v.versionId} value={v.versionNo}>v{v.versionNo} · {participantName(state, v.authorUserId)} · {new Date(v.createdAt).toLocaleString()}</option>)}
        </select>
        {against && <button className="icon" onClick={() => setAgainst(null)}>close</button>}
      </div>
      {before && d && (
        <div style={{ marginTop: 6 }}>
          <div className="mono" style={{ fontSize: 11, marginBottom: 4 }}><span style={{ color: "var(--ok)" }}>+{d.added.length} added</span> · <span style={{ color: "var(--warn)" }}>−{d.removed.length} removed</span> · <span style={{ color: "var(--accent)" }}>~{d.changed.length} changed</span> · {d.same.length} unchanged since v{against}</div>
          <Mermaid source={compareMermaid(before, current)} />
        </div>
      )}
    </div>
  );
}

function DataModel({ content }: { content: DataModelContent }) {
  const state = useStore((s) => s.state);
  const model = Object.values(state.artifacts).find((x) => x.type === "arch_model" && !x.deleted)?.current.content as ArchModelContent | undefined;
  const ownerName = (id: string) => model?.components.find((c) => c.id === id)?.name ?? id;
  return (
    <div className="stack">
      {content.entities.map((e) => (
        <table key={e.name}>
          <thead><tr><th colSpan={2}>{e.name}{e.ownedBy ? <span className="mono" style={{ fontWeight: 400, marginLeft: 8 }}>owned by {ownerName(e.ownedBy)}</span> : null}</th></tr></thead>
          <tbody>
            {e.fields.map((f) => (
              <tr key={f.name}><td>{f.pk ? "🔑 " : ""}{f.name}{f.fk ? ` → ${f.fk}` : ""}</td><td className="mono">{f.type}{f.nullable ? "?" : ""}</td></tr>
            ))}
          </tbody>
        </table>
      ))}
      {content.relations.length > 0 && <div className="mono">{content.relations.map((r) => `${r.from} ${r.cardinality} ${r.to}${r.label ? ` (${r.label})` : ""}`).join(" · ")}</div>}
    </div>
  );
}

function DecisionPoint({ content, myId, onVote, sessionId, artifactId }: { content: DecisionPointContent; myId: string; onVote: (id: string) => void; sessionId?: string; artifactId?: string }) {
  const state = useStore((s) => s.state);
  const tally = new Map<string, string[]>();
  for (const [u, o] of Object.entries(content.votes ?? {})) tally.set(o, [...(tally.get(o) ?? []), u]);
  const closed = Boolean(content.resolvedOptionId || content.expired);
  const deadline = content.deadline ? new Date(content.deadline) : null;
  const [copied, setCopied] = useState(false);
  async function setDeadline(minutes: number) {
    if (!sessionId || !artifactId) return;
    await api("POST", `/api/v1/sessions/${sessionId}/decision-points/${artifactId}/deadline`, { minutes });
  }
  async function copyLink() {
    if (!sessionId || !artifactId) return;
    try {
      await navigator.clipboard.writeText(`${location.origin}/s/${sessionId}/vote/${artifactId}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }
  return (
    <div>
      <div style={{ marginBottom: 8 }}>{content.context}</div>
      {content.violatesConstraintIds && content.violatesConstraintIds.length > 0 && (
        <div className="chip" style={{ color: "var(--warn)", marginBottom: 8 }} title="Raised because a directive would break a recorded constraint">breaks {content.violatesConstraintIds.join(", ")}</div>
      )}
      {content.expired && <div className="consent" style={{ marginBottom: 8 }}>Expired without a majority. The blocked cards are editable again; the question is still open if anyone wants to raise it.</div>}
      {!closed && (
        <div className="row" style={{ flexWrap: "wrap", marginBottom: 8, fontSize: 12 }}>
          {deadline ? (
            <span className="mono" title={deadline.toLocaleString()}>closes {deadline.getTime() - Date.now() < 3_600_000 ? `in ${Math.max(1, Math.round((deadline.getTime() - Date.now()) / 60_000))} min` : deadline.toLocaleString()}</span>
          ) : (
            <span className="mono">no deadline</span>
          )}
          {sessionId && (
            <select defaultValue="" onChange={(e) => { if (e.target.value) setDeadline(Number(e.target.value)); e.target.value = ""; }} style={{ width: "auto", padding: "0 4px", fontSize: 11 }} title="Set a deadline; without a majority by then the point expires and unblocks its cards">
              <option value="">{deadline ? "move deadline…" : "set deadline…"}</option>
              <option value="60">1 hour</option>
              <option value="240">4 hours</option>
              <option value="1440">1 day</option>
              <option value="4320">3 days</option>
            </select>
          )}
          {sessionId && <button style={{ padding: "0 6px", fontSize: 11 }} onClick={copyLink} title="A link that opens just this decision for someone who is not in the session">{copied ? "link copied" : "copy vote link"}</button>}
        </div>
      )}
      {(content.options ?? []).map((o) => {
        const voters = tally.get(o.id) ?? [];
        const mine = content.votes?.[myId] === o.id;
        const chosen = content.resolvedOptionId === o.id;
        return (
          <div key={o.id} className={"option" + (chosen ? " chosen" : "")}>
            <div className="row">
              <b>{o.title}</b>
              <div className="votes">
                {voters.map((u) => <span key={u} className="chip solid" style={{ background: state.participants[u]?.color ?? AI_COLOR }}>{participantName(state, u)}</span>)}
                {!closed && <button className={mine ? "primary" : ""} onClick={() => onVote(o.id)}>{mine ? "voted" : "vote"}</button>}
                {chosen && <span className="chip" style={{ color: "var(--ok)" }}>chosen</span>}
              </div>
            </div>
            <div className="meta">{o.tradeoffs} <span className="mono">canvas: {o.canvasImpact}</span></div>
          </div>
        );
      })}
    </div>
  );
}
