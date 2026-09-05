import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { participantName, pendingProposals, contentText, AI_COLOR, type Proposal } from "@tandem/shared";
import { api } from "../api";
import { useStore } from "../state/store";
import { signalTyping } from "../ws";

type Tab = "side" | "proposals" | "decisions" | "history" | "sources" | "brief";

export function SidePane({ sessionId }: { sessionId: string }) {
  const state = useStore((s) => s.state);
  const me = useStore((s) => s.me)!;
  const [tab, setTab] = useState<Tab>("side");
  const pending = pendingProposals(state);
  const myCalls = Object.values(state.externalCalls).filter((c) => c.status === "pending" && c.ownerUserId === me.user!.id).length;
  const myPending = pending.filter((p) => p.requiresApprovalFrom.includes(me.user!.id)).length + myCalls;

  return (
    <div className="pane right">
      <div className="tabs">
        <button className={tab === "side" ? "active" : ""} onClick={() => setTab("side")}>Side channel</button>
        <button className={tab === "proposals" ? "active" : ""} onClick={() => setTab("proposals")}>Proposals{myPending ? <span className="badge">{myPending}</span> : null}</button>
        <button className={tab === "decisions" ? "active" : ""} onClick={() => setTab("decisions")}>Decisions</button>
        <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>History</button>
        <button className={tab === "sources" ? "active" : ""} onClick={() => setTab("sources")}>Sources</button>
        <button className={tab === "brief" ? "active" : ""} onClick={() => setTab("brief")}>Brief</button>
      </div>
      {tab === "side" && <SideChannel sessionId={sessionId} />}
      {tab === "proposals" && <Proposals sessionId={sessionId} proposals={pending} />}
      {tab === "decisions" && <Decisions />}
      {tab === "history" && <History sessionId={sessionId} />}
      {tab === "sources" && <Sources sessionId={sessionId} />}
      {tab === "brief" && <Brief sessionId={sessionId} />}
    </div>
  );
}

function SideChannel({ sessionId }: { sessionId: string }) {
  const state = useStore((s) => s.state);
  const typing = useStore((s) => s.typing);
  const me = useStore((s) => s.me)!;
  const [text, setText] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const notes = state.messages.filter((m) => m.kind === "user" && m.mode === "note");
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [notes.length]);
  const typers = Object.entries(typing).filter(([u, l]) => l === "side" && u !== me.user!.id).map(([u]) => participantName(state, u));

  async function send() {
    const t = text.trim();
    if (!t) return;
    setText("");
    await api("POST", `/api/v1/sessions/${sessionId}/messages`, { text: t, mode: "note" }).catch(() => setText(t));
  }

  return (
    <>
      <div className="pane-body" ref={ref}>
        <div className="muted" style={{ fontSize: 12 }}>Human-only. Nothing here reaches the AI unless you promote it.</div>
        {notes.map((m) => (
          <div key={m.eventId} className="msg note" style={{ borderLeftColor: state.participants[m.userId!]?.color }}>
            <div className="who">
              <span style={{ color: state.participants[m.userId!]?.color }}>{participantName(state, m.userId)}</span>
              <span className="grow" />
              <button style={{ padding: "0 6px", fontSize: 10.5 }} onClick={() => api("POST", `/api/v1/sessions/${sessionId}/messages/${m.eventId}/promote`)}>promote to AI</button>
            </div>
            <div className="text">{m.text}</div>
          </div>
        ))}
        {typers.length > 0 && <div className="mono">{typers.join(", ")} typing…</div>}
      </div>
      <div className="pane-foot composer">
        <textarea value={text} placeholder="Talk to the other people" onChange={(e) => { setText(e.target.value); signalTyping("side"); }} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} style={{ minHeight: 44 }} />
        <div className="actions"><button onClick={send} disabled={!text.trim()}>Post note</button></div>
      </div>
    </>
  );
}

function Proposals({ sessionId, proposals }: { sessionId: string; proposals: Proposal[] }) {
  const state = useStore((s) => s.state);
  const me = useStore((s) => s.me)!;
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const calls = Object.values(state.externalCalls).filter((c) => c.status === "pending").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return (
    <div className="pane-body">
      {proposals.length === 0 && calls.length === 0 && <div className="muted">No pending proposals. Under the hybrid policy, additive changes apply at once; edits to someone else's artifact and writes to external systems wait here.</div>}
      {calls.map((c) => {
        const mine = c.ownerUserId === me.user!.id || state.participants[me.user!.id]?.role === "owner";
        return (
          <div key={c.id} className="proposal">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <b>external · {c.serverName}.{c.toolName}</b>
              <span className="chip accent">outbound write</span>
            </div>
            <div style={{ fontSize: 12 }}>AI for {participantName(state, c.onBehalfOf)} wants to use {participantName(state, c.ownerUserId)}'s tool · waits for {participantName(state, c.ownerUserId)}; denied if nobody answers</div>
            <pre>{JSON.stringify(c.args ?? {}, null, 2).slice(0, 1200)}</pre>
            {mine && (
              <div className="row">
                <button className="primary" onClick={() => api("POST", `/api/v1/sessions/${sessionId}/external-calls/${c.id}/resolve`, { decision: "approved" })}>Approve</button>
                <button onClick={() => api("POST", `/api/v1/sessions/${sessionId}/external-calls/${c.id}/resolve`, { decision: "denied" })}>Deny</button>
              </div>
            )}
          </div>
        );
      })}
      {proposals.map((p) => {
        const mine = p.requiresApprovalFrom.includes(me.user!.id) || state.participants[me.user!.id]?.role === "owner";
        const secs = p.autoApplyAt ? Math.max(0, Math.round((new Date(p.autoApplyAt).getTime() - Date.now()) / 1000)) : null;
        const before = state.artifacts[p.artifactId]?.current.content;
        return (
          <div key={p.id} className="proposal">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <b>{p.op} · {p.title}</b>
              <span className="chip accent">{p.risk.replace(/_/g, " ")}</span>
            </div>
            <div style={{ fontSize: 12 }}>
              by {p.turnId ? "AI for " : ""}{participantName(state, p.proposerUserId)} · needs {p.requiresApprovalFrom.map((u) => participantName(state, u)).join(", ")}
              {secs !== null && <span className="mono"> · auto-applies in {secs}s</span>}
            </div>
            <div className="muted" style={{ fontSize: 12 }}>{p.rationale}</div>
            {before !== undefined && <pre>{diffPreview(contentText(p.artifactType, before), contentText(p.artifactType, p.proposedContent))}</pre>}
            {before === undefined && <pre>{contentText(p.artifactType, p.proposedContent).slice(0, 800)}</pre>}
            {mine && (
              <div className="row">
                <button className="primary" onClick={() => api("POST", `/api/v1/sessions/${sessionId}/proposals/${p.id}/resolve`, { decision: "approve" })}>Approve</button>
                <button className="danger" onClick={() => api("POST", `/api/v1/sessions/${sessionId}/proposals/${p.id}/resolve`, { decision: "reject" })}>Reject</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function diffPreview(a: string, b: string): string {
  const al = a.split("\n");
  const bl = b.split("\n");
  const aset = new Set(al);
  const bset = new Set(bl);
  const out: string[] = [];
  for (const l of al) if (!bset.has(l)) out.push("- " + l);
  for (const l of bl) if (!aset.has(l)) out.push("+ " + l);
  return out.length ? out.join("\n") : "(no textual change)";
}

function Decisions() {
  const state = useStore((s) => s.state);
  const setHighlight = useStore((s) => s.setHighlight);
  const decisions = Object.values(state.decisions).sort((a, b) => a.label.localeCompare(b.label));
  return (
    <div className="pane-body">
      {decisions.length === 0 && <div className="muted">The AI records settled statements here and checks new directives against them.</div>}
      {decisions.map((d) => (
        <div key={d.id} className={"decision " + d.status} onClick={() => setHighlight(d.evidence)} style={{ cursor: "pointer" }} title="Highlight the evidence messages">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="mono">{d.label} · {d.status}</span>
            <span>{d.agreedBy.map((u) => <span key={u} className="chip solid" style={{ background: state.participants[u]?.color ?? AI_COLOR, marginLeft: 3 }}>{participantName(state, u)}</span>)}</span>
          </div>
          <div>{d.statement}</div>
          {d.supersedes && <div className="mono">supersedes {state.decisions[d.supersedes]?.label}</div>}
        </div>
      ))}
    </div>
  );
}

function Brief({ sessionId }: { sessionId: string }) {
  const state = useStore((s) => s.state);
  const meta = useStore((s) => s.meta);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const transcript = state.messages.filter((m) => !(m.kind === "user" && m.mode === "note"));
  const folded = transcript.filter((m) => m.seq <= state.briefThroughSeq).length;
  async function refresh() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ status: string; folded?: number; error?: string }>("POST", `/api/v1/sessions/${sessionId}/brief`);
      setMsg(
        r.status === "compacted" ? `Folded ${r.folded} message(s) into the brief.`
        : r.status === "nothing_to_compact" ? "Nothing to fold yet; the whole conversation still fits in the model's window."
        : r.status === "no_credential" ? "No credential can fund the summary."
        : r.status === "busy" ? "A compaction is already running."
        : r.status === "disabled" ? "Compaction is disabled on this server or provider."
        : `Failed: ${r.error ?? r.status}`,
      );
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="pane-body">
      <div className="muted" style={{ fontSize: 12 }}>
        The running summary the AI reads instead of the full transcript once the conversation outgrows its window. Every point keeps who said it and the message it came from. Regenerated automatically; refreshing by hand costs one {meta?.provider ?? "provider"} request on the sponsor's plan.
      </div>
      <div className="row">
        <button onClick={refresh} disabled={busy}>{busy ? "Summarising…" : "Refresh brief"}</button>
        <span className="mono">{state.brief ? `${folded} of ${transcript.length} messages folded` : "no brief yet"}{state.briefUpdatedAt ? ` · ${new Date(state.briefUpdatedAt).toLocaleTimeString()}` : ""}</span>
      </div>
      {msg && <div className="muted" style={{ fontSize: 12 }}>{msg}</div>}
      {state.brief ? <div className="md brief"><ReactMarkdown remarkPlugins={[remarkGfm]}>{state.brief}</ReactMarkdown></div> : <div className="muted">The brief appears once older messages are folded.</div>}
    </div>
  );
}

function Sources({ sessionId }: { sessionId: string }) {
  const state = useStore((s) => s.state);
  const me = useStore((s) => s.me)!;
  const setFocusArtifact = useStore((s) => s.setFocusArtifact);
  const [mineOnly, setMineOnly] = useState(false);
  const uploads = Object.values(state.uploads)
    .filter((u) => !mineOnly || u.uploaderUserId === me.user!.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <div className="pane-body">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="muted" style={{ fontSize: 12 }}>Files uploaded to this session. Each became a card; removed cards stay listed with their file.</span>
      </div>
      <label className="row mono" style={{ gap: 6 }}>
        <input type="checkbox" style={{ width: "auto" }} checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} /> mine only
      </label>
      {uploads.length === 0 && <div className="muted">Nothing uploaded yet. Use "Attach file" in the composer.</div>}
      {uploads.map((u) => {
        const art = u.artifactId ? state.artifacts[u.artifactId] : undefined;
        const gone = !art || art.deleted;
        const color = state.participants[u.uploaderUserId ?? ""]?.color;
        return (
          <div key={u.uploadId} className={"source-row" + (gone ? " gone" : "")}>
            <span className="name" title={u.name}>{u.name}</span>
            <span className="mono" style={{ color }}>{participantName(state, u.uploaderUserId)}</span>
            <span className="mono">{Math.max(1, Math.round(u.bytes / 1024))} KB</span>
            <a className="mono" href={`/api/v1/sessions/${sessionId}/files/${u.uploadId}`} target="_blank" rel="noreferrer">open</a>
            {!gone && <button onClick={() => setFocusArtifact(u.artifactId)} title="Centre the canvas on this card">locate</button>}
            {gone && <span className="mono">removed</span>}
          </div>
        );
      })}
    </div>
  );
}

function History({ sessionId }: { sessionId: string }) {
  const state = useStore((s) => s.state);
  const [msg, setMsg] = useState<string | null>(null);
  const commits = [...state.commits].reverse();
  return (
    <div className="pane-body">
      {commits.length === 0 && <div className="muted">A commit is written after every AI turn and every applied edit.</div>}
      {msg && <div className="muted">{msg}</div>}
      {commits.map((c) => (
        <div key={c.id} className={"commit" + (c.id === state.headCommitId ? " head" : "")}>
          <span className="id">{c.id.slice(-6)}</span>
          <span style={{ flex: 1 }}>{c.message}<div className="mono">{new Date(c.createdAt).toLocaleTimeString()} · {Object.keys(c.artifactVersions).length} artifacts</div></span>
          {c.id !== state.headCommitId && (
            <button onClick={() => api<{ restored: string[] }>("POST", `/api/v1/sessions/${sessionId}/revert`, { commitId: c.id }).then((r) => setMsg(`Restored ${r.restored.length} artifact(s) as a new commit.`)).catch((e) => setMsg((e as Error).message))}>revert to</button>
          )}
        </div>
      ))}
    </div>
  );
}
