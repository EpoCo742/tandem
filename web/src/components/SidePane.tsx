import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { participantName, pendingProposals, contentText, describeAnchor, describeTarget, targetOf, completeness, AI_COLOR, type Proposal } from "@tandem/shared";
import { api } from "../api";
import { useStore } from "../state/store";
import { signalTyping } from "../ws";
import { promotionStates } from "../threadState";

type Tab = "side" | "proposals" | "decisions" | "history" | "sources" | "brief" | "checklist";

export function SidePane({ sessionId }: { sessionId: string }) {
  const state = useStore((s) => s.state);
  const me = useStore((s) => s.me)!;
  const [tab, setTab] = useState<Tab>("side");
  const focusComponent = useStore((s) => s.focusComponentId);
  useEffect(() => {
    if (focusComponent) setTab("decisions");
  }, [focusComponent]);
  const requestedTab = useStore((s) => s.requestedTab);
  const requestTab = useStore((s) => s.requestTab);
  useEffect(() => {
    if (requestedTab) {
      setTab(requestedTab as Tab);
      requestTab(null);
    }
  }, [requestedTab, requestTab]);
  // Something new is waiting on me: bring the Proposals tab forward once per item.
  const seen = useRef(new Set<string>());
  const waitingOnMe = [
    ...pendingProposals(state).filter((p) => p.requiresApprovalFrom.includes(me.user!.id)).map((p) => p.id),
    ...Object.values(state.externalCalls).filter((c) => c.status === "pending" && c.ownerUserId === me.user!.id).map((c) => c.id),
  ];
  useEffect(() => {
    const fresh = waitingOnMe.filter((id) => !seen.current.has(id));
    if (fresh.length) {
      fresh.forEach((id) => seen.current.add(id));
      setTab("proposals");
    }
  }, [waitingOnMe.join("|")]);
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
        {state.template && <button className={tab === "checklist" ? "active" : ""} onClick={() => setTab("checklist")}>Checklist</button>}
      </div>
      {tab === "side" && <SideChannel sessionId={sessionId} />}
      {tab === "proposals" && <Proposals sessionId={sessionId} proposals={pending} />}
      {tab === "decisions" && <Decisions />}
      {tab === "checklist" && <Checklist />}
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
  const setThreadTarget = useStore((s) => s.setThreadTarget);
  const [text, setText] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const notes = state.messages.filter((m) => m.kind === "user" && m.mode === "note");
  const promotion = promotionStates(state);
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
        <div className="muted" style={{ fontSize: 12 }}>Human-only. Nothing here reaches the AI unless you promote it. Threads started on cards show up here too.</div>
        {notes.map((m) => (
          <div key={m.eventId} className={"msg note" + (m.replyTo ? " reply" : "")} style={{ borderLeftColor: state.participants[m.userId!]?.color }}>
            <div className="who">
              <span style={{ color: state.participants[m.userId!]?.color }}>{participantName(state, m.userId)}</span>
              {m.anchor && <button className="chip" style={{ cursor: "pointer" }} title="Open the thread on this card" onClick={() => setThreadTarget(m.anchor!)}>on {describeAnchor(state, m.anchor)}</button>}
              <span className="grow" />
              {promotion(m) === "promoted" ? (
                <span className="chip" title="This message was sent to the AI">promoted</span>
              ) : promotion(m) === "sent" ? (
                <span className="chip muted" title="Went to the AI as background when a later message in its thread was promoted">sent as context</span>
              ) : (
                <button style={{ padding: "0 6px", fontSize: 10.5 }} onClick={() => api("POST", `/api/v1/sessions/${sessionId}/messages/${m.eventId}/promote`)}>promote to AI</button>
              )}
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
              <div className="row" style={{ flexWrap: "wrap" }}>
                <button className="primary" onClick={() => api("POST", `/api/v1/sessions/${sessionId}/external-calls/${c.id}/resolve`, { decision: "approved" })}>Approve</button>
                {c.ownerUserId === me.user!.id && (
                  <button title={`Approve, and let ${c.toolName} run without asking when the target is ${describeTarget(targetOf(c.args))}. Remove the rule under credentials → External tools.`} onClick={() => api("POST", `/api/v1/sessions/${sessionId}/external-calls/${c.id}/resolve`, { decision: "approved", remember: true })}>
                    Approve, always for {describeTarget(targetOf(c.args))}
                  </button>
                )}
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

// What a whole design of this kind still lacks, evaluated from the ledger; the AI sees the same list.
function Checklist() {
  const state = useStore((s) => s.state);
  const c = completeness(state);
  if (!c) return <div className="pane-body muted">This session has no template.</div>;
  return (
    <div className="pane-body">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
        <span><b>{c.template.name}</b></span>
        <span className="mono">{c.done} of {c.total}</span>
      </div>
      <div className="gauge" title={`${c.done} of ${c.total} items done`}><div className="gauge-fill" style={{ width: `${Math.round((100 * c.done) / Math.max(1, c.total))}%` }} /></div>
      <p className="muted" style={{ fontSize: 12, margin: "8px 0 10px" }}>{c.template.guidance}</p>
      {c.items.map((i) => (
        <div key={i.id} className={"check " + (i.done ? "done" : "todo")}>
          <span className="mark">{i.done ? "✓" : "○"}</span>
          <div>
            <div>{i.title}{i.done && i.detail ? <span className="mono" style={{ marginLeft: 6 }}>{i.detail}</span> : null}</div>
            {!i.done && <div className="muted" style={{ fontSize: 12 }}>{i.hint}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function Decisions() {
  const state = useStore((s) => s.state);
  const setHighlight = useStore((s) => s.setHighlight);
  const focus = useStore((s) => s.focusComponentId);
  const setFocus = useStore((s) => s.setFocusComponent);
  const model = Object.values(state.artifacts).find((x) => x.type === "arch_model" && !x.deleted)?.current.content as { components: { id: string; name: string }[] } | undefined;
  const cname = (id: string) => model?.components.find((c) => c.id === id)?.name ?? id;
  const all = Object.values(state.decisions).sort((a, b) => a.label.localeCompare(b.label));
  const decisions = focus ? all.filter((d) => d.about.includes(focus)) : all;
  return (
    <div className="pane-body">
      {focus && (
        <div className="row" style={{ fontSize: 12 }}>
          <span>Decisions about <b>{cname(focus)}</b></span>
          <button style={{ padding: "0 6px", fontSize: 10.5 }} onClick={() => setFocus(null)}>show all</button>
        </div>
      )}
      {all.length === 0 && <div className="muted">The AI records settled statements here and checks new directives against them.</div>}
      {focus && decisions.length === 0 && all.length > 0 && <div className="muted">No decision names this component yet.</div>}
      {decisions.map((d) => (
        <div key={d.id} className={"decision " + d.status} onClick={() => setHighlight(d.evidence)} style={{ cursor: "pointer" }} title="Highlight the evidence messages">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="mono">{d.label} · {d.status}</span>
            <span>{d.agreedBy.map((u) => <span key={u} className="chip solid" style={{ background: state.participants[u]?.color ?? AI_COLOR, marginLeft: 3 }}>{participantName(state, u)}</span>)}</span>
          </div>
          <div>{d.statement}</div>
          {d.about.length > 0 && <div style={{ marginTop: 3 }}>{d.about.map((id) => <span key={id} className="chip" style={{ marginRight: 4, color: "var(--ink-2)", cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); setFocus(id); }}>{cname(id)}</span>)}</div>}
          {d.supersedes && <div className="mono">supersedes {state.decisions[d.supersedes]?.label}</div>}
          {d.importedFrom && <div className="mono" title={`Copied from session "${d.importedFrom.sessionTitle}" (${d.importedFrom.refId}) through the library`}>from <a href={`/s/${d.importedFrom.sessionId}`} onClick={(e) => e.stopPropagation()}>{d.importedFrom.sessionTitle}</a></div>}
          {(d.context || d.options.length > 0 || d.consequences) && (
            <details className="adr" onClick={(e) => e.stopPropagation()}>
              <summary className="mono">record</summary>
              {d.context && <div><span className="mono">context</span> {d.context}</div>}
              {d.options.length > 0 && (
                <div><span className="mono">options</span>
                  <ul>{d.options.map((o, i) => <li key={i} className={o.chosen ? "chosen" : ""}>{o.title}{o.chosen ? " (chosen)" : ""}{o.tradeoffs ? `: ${o.tradeoffs}` : ""}</li>)}</ul>
                </div>
              )}
              {d.consequences && <div><span className="mono">consequences</span> {d.consequences}</div>}
            </details>
          )}
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
  const calls = Object.values(state.externalCalls).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <div className="pane-body">
      {calls.length > 0 && (
        <>
          <div className="pane-head" style={{ padding: "0 0 4px", borderBottom: "none" }}>External actions</div>
          {calls.map((c) => (
            <div key={c.id} className="commit">
              <span className="id">{new Date(c.createdAt).toLocaleTimeString()}</span>
              <span style={{ flex: 1 }}>
                <b>{c.serverName}.{c.toolName}</b> for {participantName(state, c.onBehalfOf)} with {participantName(state, c.ownerUserId)}'s tool
                <div className="mono">
                  {c.status}{c.decidedBy ? ` · by ${participantName(state, c.decidedBy)}` : c.reason ? ` · ${c.reason}` : ""}{c.result ? ` · ${c.result.slice(0, 120)}` : ""}
                </div>
              </span>
            </div>
          ))}
          <div className="pane-head" style={{ padding: "8px 0 4px", borderBottom: "none" }}>Commits</div>
        </>
      )}
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
