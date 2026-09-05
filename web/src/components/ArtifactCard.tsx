import { useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { participantName, modelToMermaid, AI_COLOR, type Artifact, type ArchModelContent, type DecisionPointContent, type DataModelContent, type MermaidContent, type MarkdownContent, type CodeContent, type SourceContent, type ViewContent } from "@tandem/shared";
import { api } from "../api";
import { useStore } from "../state/store";
import { Mermaid } from "./Mermaid";
import { ArtifactEditor } from "./ArtifactEditor";

// Render ```mermaid fences inside Markdown cards as diagrams instead of code.
const mdComponents: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  code({ className, children }) {
    const text = String(children).replace(/\n$/, "");
    if (className === "language-mermaid") return <Mermaid source={text} />;
    return <code className={className}>{children}</code>;
  },
};

export function ArtifactCard({ artifact: a, sessionId, sized = false, onResetSize }: { artifact: Artifact; sessionId: string; sized?: boolean; onResetSize?: () => void }) {
  const state = useStore((s) => s.state);
  const me = useStore((s) => s.me)!;
  const setHighlight = useStore((s) => s.setHighlight);
  const [editing, setEditing] = useState(false);
  const [viewVersion, setViewVersion] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const editors = useStore((s) => s.editing[a.id]) ?? [];
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
    <div className={"art" + (sized ? " sized" : "") + (a.blockedByDecisionPoint ? " blocked" : "") + (isDp ? " dp" : "")} style={{ borderTopColor: isDp ? undefined : authorColor }}>
      <div className="art-head">
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
        {pending > 0 && <span className="chip accent">{pending} pending</span>}
        {editors.map((u) => <span key={u.userId} className="chip solid" style={{ background: u.color }} title={`${u.name} has this card open in the editor`}>{u.name} editing</span>)}
        {a.type === "source" && <button className="icon nodrag" style={{ padding: "0 5px" }} title={open ? "Fold this upload" : "Show the uploaded content"} onClick={() => setOpen((o) => !o)}>{open ? "▴" : "▾"}</button>}
        {sized && onResetSize && <button className="icon nodrag" style={{ padding: "0 5px" }} title="Back to automatic size" onClick={onResetSize}>&#x21BA;</button>}
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
        {!isDp && a.type !== "source" && <button onClick={() => setEditing(true)} disabled={Boolean(a.blockedByDecisionPoint)}>edit</button>}
        {!isDp && !confirmDelete && <button title="Remove this card from the canvas (it stays in history)" onClick={() => setConfirmDelete(true)} disabled={Boolean(a.blockedByDecisionPoint)}>delete</button>}
        {confirmDelete && (
          <span className="confirm">
            <button className="danger" onClick={remove}>confirm delete</button>
            <button onClick={() => setConfirmDelete(false)}>cancel</button>
          </span>
        )}
      </div>
      {editing && <ArtifactEditor artifact={a} sessionId={sessionId} onClose={() => setEditing(false)} />}
      {expanded && createPortal(
        <div className="modal-bg nodrag nowheel" onClick={() => setExpanded(false)}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <div className="row">
              <span className="chip" style={{ color: AI_COLOR }}>{a.type.replace("_", " ")}</span>
              <b style={{ flex: 1 }}>{a.title}</b>
              <span className="mono">v{v.versionNo} &middot; {authorLabel}</span>
              <button onClick={() => setExpanded(false)}>close</button>
            </div>
            <div className={"modal-body" + (a.type === "mermaid" ? " diagram-full" : " md-doc")}>
              <ArtifactBody artifact={a} version={v} sessionId={sessionId} myId={me.user!.id} onVote={vote} large />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function ArtifactBody({ artifact: a, version: v, sessionId, myId, onVote, large = false }: { artifact: Artifact; version: Artifact["current"]; sessionId: string; myId: string; onVote: (id: string) => void; large?: boolean }) {
  return (
    <>
      {a.type === "mermaid" && <Mermaid source={(v.content as MermaidContent).source} />}
      {(a.type === "markdown" || a.type === "design_doc") && <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{(v.content as MarkdownContent).markdown}</ReactMarkdown></div>}
      {a.type === "code" && <pre>{(v.content as CodeContent).source}</pre>}
      {a.type === "data_model" && <DataModel content={v.content as DataModelContent} />}
      {a.type === "source" && <SourceView sessionId={sessionId} content={v.content as SourceContent} full={large} />}
      {a.type === "arch_model" && <ModelTable content={v.content as ArchModelContent} />}
      {a.type === "view" && <ModelView content={v.content as ViewContent} />}
      {a.type === "decision_point" && <DecisionPoint content={v.content as DecisionPointContent} myId={myId} onVote={onVote} />}
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

// A view card draws itself from the session's architecture model, so it never goes stale.
function ModelView({ content }: { content: ViewContent }) {
  const state = useStore((s) => s.state);
  const model = Object.values(state.artifacts).find((x) => x.type === "arch_model" && !x.deleted)?.current.content as ArchModelContent | undefined;
  if (!model) return <div className="muted">No architecture model yet. Describe the systems involved and the AI will build one.</div>;
  const focusName = content.focus ? model.components.find((c) => c.id === content.focus)?.name : undefined;
  return (
    <div>
      <div className="mono" style={{ marginBottom: 6 }}>{content.kind} view{focusName ? ` of ${focusName}` : ""} · {model.components.length} components</div>
      <Mermaid source={modelToMermaid(model, content)} />
      {content.note && <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>{content.note}</div>}
    </div>
  );
}

function ModelTable({ content }: { content: ArchModelContent }) {
  const state = useStore((s) => s.state);
  const focus = useStore((s) => s.focusComponentId);
  const setFocus = useStore((s) => s.setFocusComponent);
  const bname = (id?: string) => (id ? content.boundaries.find((b) => b.id === id)?.name ?? id : "");
  const name = (id: string) => content.components.find((c) => c.id === id)?.name ?? id;
  const decisionsAbout = (id: string) => Object.values(state.decisions).filter((d) => d.about.includes(id) && d.status !== "superseded").length;
  return (
    <div className="stack">
      <div className="muted" style={{ fontSize: 12 }}>The source of truth for structure. Views are drawn from it; click a component to see its decisions.</div>
      <table>
        <thead><tr><th>Component</th><th>Kind</th><th>Technology</th><th>Boundary</th></tr></thead>
        <tbody>
          {content.components.map((c) => {
            const n = decisionsAbout(c.id);
            return (
              <tr key={c.id} className={focus === c.id ? "focus" : ""} onClick={() => setFocus(focus === c.id ? null : c.id)} style={{ cursor: "pointer" }} title={c.description ?? c.id}>
                <td><b>{c.name}</b>{n ? <span className="chip" style={{ marginLeft: 6, color: "var(--ok)" }}>{n} decision{n === 1 ? "" : "s"}</span> : null}</td>
                <td className="mono">{c.kind}</td>
                <td className="mono">{c.technology ?? ""}</td>
                <td className="mono">{bname(c.boundary)}</td>
              </tr>
            );
          })}
          {content.components.length === 0 && <tr><td colSpan={4} className="muted">empty</td></tr>}
        </tbody>
      </table>
      {content.relationships.length > 0 && (
        <div className="mono" style={{ lineHeight: 1.6 }}>
          {content.relationships.map((r) => <div key={r.id}>{name(r.from)} <span className="muted">{r.kind.replace("_", " ")}</span> {name(r.to)}{r.label ? <span className="muted"> ({r.label})</span> : null}</div>)}
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

function DecisionPoint({ content, myId, onVote }: { content: DecisionPointContent; myId: string; onVote: (id: string) => void }) {
  const state = useStore((s) => s.state);
  const tally = new Map<string, string[]>();
  for (const [u, o] of Object.entries(content.votes ?? {})) tally.set(o, [...(tally.get(o) ?? []), u]);
  return (
    <div>
      <div style={{ marginBottom: 8 }}>{content.context}</div>
      {content.options.map((o) => {
        const voters = tally.get(o.id) ?? [];
        const mine = content.votes?.[myId] === o.id;
        const chosen = content.resolvedOptionId === o.id;
        return (
          <div key={o.id} className={"option" + (chosen ? " chosen" : "")}>
            <div className="row">
              <b>{o.title}</b>
              <div className="votes">
                {voters.map((u) => <span key={u} className="chip solid" style={{ background: state.participants[u]?.color ?? AI_COLOR }}>{participantName(state, u)}</span>)}
                {!content.resolvedOptionId && <button className={mine ? "primary" : ""} onClick={() => onVote(o.id)}>{mine ? "voted" : "vote"}</button>}
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
