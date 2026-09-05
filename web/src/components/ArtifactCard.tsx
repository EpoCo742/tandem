import { useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { participantName, AI_COLOR, type Artifact, type DecisionPointContent, type DataModelContent, type MermaidContent, type MarkdownContent, type CodeContent, type SourceContent } from "@tandem/shared";
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

export function ArtifactCard({ artifact: a, sessionId, sized = false }: { artifact: Artifact; sessionId: string; sized?: boolean }) {
  const state = useStore((s) => s.state);
  const me = useStore((s) => s.me)!;
  const setHighlight = useStore((s) => s.setHighlight);
  const [editing, setEditing] = useState(false);
  const [viewVersion, setViewVersion] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const v = viewVersion ? a.versions.find((x) => x.versionNo === viewVersion) ?? a.current : a.current;
  const authorColor = state.participants[v.authorUserId]?.color ?? AI_COLOR;
  const authorLabel = `${v.authorKind === "ai" ? "AI for " : ""}${participantName(state, v.authorUserId)}`;
  const derived = [...new Set(v.provenance.flatMap((p) => p.derivedFrom))].filter((id) => state.eventsById[id]);
  const isDp = a.type === "decision_point";
  const pending = Object.values(state.proposals).filter((p) => p.artifactId === a.id && p.status === "pending").length;

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
        <span className="title" title={a.title}>{a.title}</span>
        <span className="mono">v{v.versionNo}</span>
        {a.blockedByDecisionPoint && <span className="chip" style={{ color: "var(--warn)" }} title="blocked until the decision point resolves">blocked</span>}
        {pending > 0 && <span className="chip accent">{pending} pending</span>}
        <button className="icon nodrag" style={{ padding: "0 5px" }} title="Open this card full size" onClick={() => setExpanded(true)}>&#x2922;</button>
      </div>
      <div className="art-body nodrag nowheel">
        <ArtifactBody artifact={a} version={v} sessionId={sessionId} myId={me.user!.id} onVote={vote} />
        {msg && <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>{msg}</div>}
      </div>
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

function DataModel({ content }: { content: DataModelContent }) {
  return (
    <div className="stack">
      {content.entities.map((e) => (
        <table key={e.name}>
          <thead><tr><th colSpan={2}>{e.name}</th></tr></thead>
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
