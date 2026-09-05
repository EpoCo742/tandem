import { useState } from "react";
import { createPortal } from "react-dom";
import { participantName, threadsFor, describeAnchor, type ArchModelContent, type MessageAnchor, type Thread } from "@tandem/shared";
import { api } from "../api";
import { useStore } from "../state/store";

// Threads live on cards. They are conversations between people; the AI only sees a
// message once someone promotes it, and the promoted message carries what it is about.
export function ThreadPanel({ sessionId }: { sessionId: string }) {
  const target = useStore((s) => s.threadTarget);
  if (!target) return null;
  return <ThreadDialog key={`${target.artifactId}:${target.componentId ?? ""}`} sessionId={sessionId} target={target} />;
}

function ThreadDialog({ sessionId, target }: { sessionId: string; target: MessageAnchor }) {
  const state = useStore((s) => s.state);
  const me = useStore((s) => s.me)!;
  const close = useStore((s) => s.setThreadTarget);
  const setFocusArtifact = useStore((s) => s.setFocusArtifact);
  const [text, setText] = useState("");
  const [componentId, setComponentId] = useState(target.componentId ?? "");
  const [err, setErr] = useState<string | null>(null);
  const art = state.artifacts[target.artifactId];
  if (!art) return null;
  const model = Object.values(state.artifacts).find((a) => a.type === "arch_model" && !a.deleted)?.current.content as ArchModelContent | undefined;
  const components = art.type === "arch_model" || art.type === "view" ? model?.components ?? [] : [];
  const all = threadsFor(state, art.id).sort((a, b) => a.root.createdAt.localeCompare(b.root.createdAt));
  const open = all.filter((t) => !t.resolved);
  const resolved = all.filter((t) => t.resolved);
  const canPost = state.participants[me.user!.id]?.role !== "viewer";

  async function start() {
    const t = text.trim();
    if (!t) return;
    setErr(null);
    try {
      await api("POST", `/api/v1/sessions/${sessionId}/messages`, { text: t, mode: "note", anchor: { artifactId: art!.id, ...(componentId ? { componentId } : {}) } });
      setText("");
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return createPortal(
    <div className="modal-bg nodrag nowheel" onClick={() => close(null)}>
      <div className="modal threads" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <span className="chip">threads</span>
          <b style={{ flex: 1 }}>{art.title}</b>
          <button onClick={() => { setFocusArtifact(art!.id); close(null); }} title="Center the canvas on this card">show card</button>
          <button onClick={() => close(null)}>close</button>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>Between people, on this card. Nothing here reaches the AI until someone promotes a message; the promoted message says what it is about, so "this" means this card{components.length ? " or component" : ""}.</div>
        {open.length === 0 && resolved.length === 0 && <div className="muted">No threads yet.</div>}
        {open.map((t) => <ThreadView key={t.root.eventId} sessionId={sessionId} thread={t} canPost={canPost} />)}
        {resolved.length > 0 && (
          <details>
            <summary className="muted" style={{ cursor: "pointer", fontSize: 12 }}>{resolved.length} resolved thread{resolved.length === 1 ? "" : "s"}</summary>
            <div className="stack" style={{ marginTop: 8 }}>
              {resolved.map((t) => <ThreadView key={t.root.eventId} sessionId={sessionId} thread={t} canPost={canPost} />)}
            </div>
          </details>
        )}
        {canPost && (
          <div className="composer" style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
            <div className="row" style={{ marginBottom: 6 }}>
              <span className="mono">new thread on</span>
              {components.length > 0 ? (
                <select value={componentId} onChange={(e) => setComponentId(e.target.value)} style={{ width: "auto" }} title="Anchor the thread to one component of the model, or to the whole card">
                  <option value="">the whole card</option>
                  {components.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              ) : (
                <span className="mono">the whole card</span>
              )}
            </div>
            <textarea value={text} placeholder={componentId ? `About ${components.find((c) => c.id === componentId)?.name ?? componentId}…` : "What about this card?"} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); start(); } }} style={{ minHeight: 48 }} />
            <div className="actions">
              {err && <span className="err" style={{ fontSize: 12 }}>{err}</span>}
              <span className="grow" />
              <button onClick={start} disabled={!text.trim()}>Start thread</button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function ThreadView({ sessionId, thread: t, canPost }: { sessionId: string; thread: Thread; canPost: boolean }) {
  const state = useStore((s) => s.state);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const promotedFrom = new Set(state.messages.filter((m) => m.mode === "promoted").map((m) => state.eventsById[m.eventId]?.causedBy[0]).filter(Boolean));
  const label = t.anchor.componentId ? describeAnchor(state, t.anchor).split(" › ").pop() : "whole card";

  async function post() {
    const txt = reply.trim();
    if (!txt) return;
    setReply("");
    await api("POST", `/api/v1/sessions/${sessionId}/messages`, { text: txt, mode: "note", replyTo: t.root.eventId }).catch(() => setReply(txt));
  }
  async function promote(eventId: string) {
    setBusy(eventId);
    try {
      await api("POST", `/api/v1/sessions/${sessionId}/messages/${eventId}/promote`);
    } finally {
      setBusy(null);
    }
  }
  async function resolve(resolved: boolean) {
    await api("POST", `/api/v1/sessions/${sessionId}/messages/${t.root.eventId}/resolve`, { resolved });
  }

  return (
    <div className={"thread" + (t.resolved ? " resolved" : "")}>
      <div className="row" style={{ fontSize: 11 }}>
        <span className="chip" title={t.anchor.componentId ? "Anchored to one component of the architecture model" : "Anchored to the whole card"}>{label}</span>
        <span className="grow" />
        {canPost && <button style={{ padding: "0 6px", fontSize: 10.5 }} onClick={() => resolve(!t.resolved)} title={t.resolved ? "Reopen this thread" : "Mark this thread as settled; it stays in the record"}>{t.resolved ? "reopen" : "resolve"}</button>}
      </div>
      {[t.root, ...t.replies].map((m) => (
        <div key={m.eventId} className={"msg note" + (m.replyTo ? " reply" : "")} style={{ borderLeftColor: state.participants[m.userId!]?.color }}>
          <div className="who">
            <span style={{ color: state.participants[m.userId!]?.color }}>{participantName(state, m.userId)}</span>
            <span className="grow" />
            {promotedFrom.has(m.eventId) ? (
              <span className="chip" title="This message was sent to the AI, with the anchor">promoted</span>
            ) : canPost ? (
              <button style={{ padding: "0 6px", fontSize: 10.5 }} disabled={busy === m.eventId} onClick={() => promote(m.eventId)} title="Send this message to the AI, keeping the author and saying what it is about">promote to AI</button>
            ) : null}
          </div>
          <div className="text">{m.text}</div>
        </div>
      ))}
      {canPost && !t.resolved && (
        <div className="row">
          <input value={reply} placeholder="Reply" onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); post(); } }} style={{ flex: 1 }} />
          <button onClick={post} disabled={!reply.trim()}>Reply</button>
        </div>
      )}
    </div>
  );
}
