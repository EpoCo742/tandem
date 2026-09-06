import { useEffect, useRef, useState } from "react";
import { participantName, pendingProposals, describeAnchor, describeTarget, targetOf, AI_COLOR, type ExternalCall, type Proposal } from "@tandem/shared";
import { api } from "../api";
import { useStore } from "../state/store";
import { signalTyping } from "../ws";

export function ConversationPane({ sessionId }: { sessionId: string }) {
  const me = useStore((s) => s.me)!;
  const meta = useStore((s) => s.meta)!;
  const state = useStore((s) => s.state);
  const streaming = useStore((s) => s.streaming);
  const toolProgress = useStore((s) => s.toolProgress);
  const turn = useStore((s) => s.turn);
  const typing = useStore((s) => s.typing);
  const highlight = useStore((s) => s.highlight);
  const setMeta = useStore((s) => s.setMeta);
  const [text, setText] = useState("");
  const replay = useStore((s) => s.replay);
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [staged, setStaged] = useState<File | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // A chosen file waits in the composer so the message sent with it can say what to do with it.
  // Sending with an empty message just uploads the file as a source card.
  async function upload(file: File): Promise<{ artifactId: string; kind: string }> {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/v1/sessions/${sessionId}/uploads`, { method: "POST", body: fd, credentials: "same-origin" });
    if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? res.statusText);
    return (await res.json()) as { artifactId: string; kind: string };
  }

  const myId = me.user!.id;
  const consented = state.participants[myId]?.consented ?? meta.me.consented;
  const messages = state.messages.filter((m) => !(m.kind === "user" && m.mode === "note"));
  // Approvals are decisions people make; show them where people are looking, in the lane, in time order.
  type Row = { kind: "msg"; at: string; m: (typeof messages)[number] } | { kind: "call"; at: string; c: ExternalCall } | { kind: "proposal"; at: string; p: Proposal };
  const rows: Row[] = [
    ...messages.map((m) => ({ kind: "msg" as const, at: m.createdAt, m })),
    // Reads never wait on anyone, so they do not take a row in the lane (the History tab lists them).
    ...Object.values(state.externalCalls).filter((c) => !c.readOnly || c.status === "failed").map((c) => ({ kind: "call" as const, at: c.createdAt, c })),
    ...pendingProposals(state).map((p) => ({ kind: "proposal" as const, at: p.createdAt, p })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const requestTab = useStore((s) => s.requestTab);
  const setFocusArtifact = useStore((s) => s.setFocusArtifact);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows.length, streaming?.text]);

  useEffect(() => {
    if (highlight.length === 0) return;
    const first = document.getElementById(`msg-${highlight[0]}`);
    first?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlight]);

  async function send() {
    const t = text.trim();
    const file = staged;
    if (!t && !file) return;
    setErr(null);
    setText(""); // clear at once so a fast second message never inherits the first
    setStaged(null);
    if (fileRef.current) fileRef.current.value = "";
    try {
      const attachments: string[] = [];
      if (file) {
        setUploading(true);
        try {
          const up = await upload(file);
          attachments.push(up.artifactId);
        } finally {
          setUploading(false);
        }
      }
      if (!t) return; // upload only
      await api("POST", `/api/v1/sessions/${sessionId}/messages`, { text: t, mode: "directive", attachments });
    } catch (e) {
      setErr((e as Error).message);
      setText(t);
    }
  }

  async function consent() {
    await api("POST", `/api/v1/sessions/${sessionId}/consent`);
    setMeta({ ...meta, me: { ...meta.me, consented: true } });
  }

  const typingNames = Object.entries(typing).filter(([u, lane]) => lane === "ai" && u !== myId).map(([u]) => participantName(state, u));
  const busy = turn.state !== "idle";
  const payerName = turn.payerUserId ? participantName(state, turn.payerUserId) : null;

  return (
    <div className="pane">
      <div className="pane-head"><span style={{ whiteSpace: "nowrap" }}>AI lane</span><span className="grow" /><UsageStrip /><span style={{ whiteSpace: "nowrap", flex: "none" }}>{Object.keys(state.participants).length} participants</span></div>
      <div className="pane-body" ref={bodyRef}>
        {rows.map((row) => {
          if (row.kind === "call") return <ExternalCallCard key={row.c.id} call={row.c} sessionId={sessionId} myId={myId} onOpen={() => requestTab("proposals")} />;
          if (row.kind === "proposal") return <ProposalCard key={row.p.id} proposal={row.p} sessionId={sessionId} myId={myId} onOpen={() => requestTab("proposals")} />;
          const m = row.m;
          const color = m.kind === "user" ? state.participants[m.userId!]?.color ?? "#999" : AI_COLOR;
          const cls = m.kind === "ai" ? "msg ai" : m.kind === "system" ? "msg system" : m.kind === "clarification" ? "msg ai" : "msg";
          const flash = highlight.includes(m.eventId) ? " flash" : "";
          return (
            <div key={m.eventId} id={`msg-${m.eventId}`} className={cls + flash} style={m.kind === "user" ? { borderLeftColor: color } : undefined}>
              <div className="who">
                {m.kind === "user" && <span style={{ color }}>{participantName(state, m.userId)}{m.mode === "promoted" ? (m.anchor ? " · promoted from a thread" : " · promoted from side channel") : ""}</span>}
                {m.kind === "user" && m.anchor && <button className="chip" style={{ cursor: "pointer" }} title="Show the card this message is about" onClick={() => setFocusArtifact(m.anchor!.artifactId)}>about {describeAnchor(state, m.anchor)}</button>}
                {m.mentions?.includes(myId) && <span className="chip accent">mentions you</span>}
                {m.kind === "ai" && (
                  <>
                    <span style={{ color: AI_COLOR }}>AI · for {participantName(state, m.onBehalfOf)}</span>
                    <span className="chip" style={{ color: state.participants[m.payerUserId ?? ""]?.color ?? AI_COLOR }} title="whose credential funded this turn">
                      ran on {participantName(state, m.payerUserId)}'s {m.provider}{meta.payerMode === "sponsor" ? " (sponsor)" : ""} · {m.model}
                    </span>
                    {m.turnId && state.turns[m.turnId]?.usage && (state.turns[m.turnId]!.usage!.inputTokens || state.turns[m.turnId]!.usage!.outputTokens) ? (
                      <span className="chip" style={{ color: "var(--ink-3)" }} title="Tokens this turn: prompt in, reply out">
                        {fmtTokens(state.turns[m.turnId]!.usage!.inputTokens ?? 0)} in · {fmtTokens(state.turns[m.turnId]!.usage!.outputTokens ?? 0)} out
                      </span>
                    ) : null}
                    {m.partial && <span className="chip" style={{ color: "var(--warn)" }}>interrupted</span>}
                  </>
                )}
                {m.kind === "clarification" && <span style={{ color: AI_COLOR }}>AI asks</span>}
                {m.kind === "system" && <span>system</span>}
              </div>
              <div className="text">{m.intent === "compile" ? <em>asked the AI to compile the design document from the canvas</em> : m.text}</div>
              {m.attachments && m.attachments.length > 0 && (
                <div>
                  {m.attachments.map((id) => (
                    <span key={id} className="attach-chip" title="Attached source card">&#x1F4CE; {state.artifacts[id]?.title ?? "attachment"}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {streaming && (
          <div className="msg ai">
            <div className="who"><span style={{ color: AI_COLOR }}>AI · streaming{payerName ? ` · on ${payerName}'s credential` : ""}</span></div>
            <div className="text">{streaming.text}<span className="cursor" /></div>
          </div>
        )}
        {busy && !streaming && (
          <div className="msg ai"><div className="who"><span style={{ color: AI_COLOR }}>AI</span></div><div className="text muted">{toolProgress ?? (turn.state === "collecting" ? "collecting messages…" : `${turn.state}…`)}<span className="cursor" /></div></div>
        )}
        {busy && streaming && toolProgress && <div className="turnstate"><span className="dot on" />{toolProgress}</div>}
      </div>
      <div className="pane-foot">
        {!consented ? (
          <div className="consent stack">
            <div>Everything posted in this session, including other people's uploads, is sent to the AI provider account that funds each turn ({meta.payerMode === "sponsor" ? "the session sponsor's" : "each speaker's"} {meta.provider}).</div>
            <button className="primary" onClick={consent}>I understand, let me address the AI</button>
          </div>
        ) : (
          <div className="composer">
            <div className="turnstate">
              <span className={"dot" + (busy ? " on" : "")} />
              {busy ? `${turn.state}${turn.queued ? ` · ${turn.queued} queued` : ""}` : "idle"}
              {typingNames.length > 0 && <span>· {typingNames.join(", ")} typing</span>}
            </div>
            <textarea
              value={text}
              placeholder="Address the AI. Messages sent within ~1.5 s of each other are answered together."
              onChange={(e) => { setText(e.target.value); signalTyping("ai"); }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            />
            {staged && (
              <div className="attach" title={staged.name}>
                <span>&#x1F4CE; {staged.name} ({Math.max(1, Math.round(staged.size / 1024))} KB)</span>
                <span className="muted">{text.trim() ? "sent with your message" : "will upload as a source card"}</span>
                <button className="x" title="Remove attachment" onClick={() => { setStaged(null); if (fileRef.current) fileRef.current.value = ""; }}>&times;</button>
              </div>
            )}
            <div className="actions">
              <button className="primary" onClick={send} disabled={(!text.trim() && !staged) || uploading || Boolean(replay)} title={replay ? "Leave replay to send" : undefined}>{uploading ? "Uploading…" : staged && !text.trim() ? "Upload" : "Send to AI"}</button>
              <button onClick={() => api("POST", `/api/v1/sessions/${sessionId}/turns/send-now`)} disabled={turn.state !== "collecting"} title="Close the batch window now">Send now</button>
              <button className="danger" onClick={() => api("POST", `/api/v1/sessions/${sessionId}/turns/current/interrupt`)} disabled={turn.state !== "generating"}>Stop</button>
              <input ref={fileRef} type="file" style={{ display: "none" }} accept="image/*,.md,.markdown,.txt,.mmd,.json,.yaml,.yml,.csv" onChange={(e) => setStaged(e.target.files?.[0] ?? null)} />
              <button onClick={() => fileRef.current?.click()} disabled={uploading} title="Attach a screenshot, Markdown, text or .mmd diagram. Type what the AI should do with it, then send.">Attach file</button>
              <span className="grow" />
              {err && <span className="err">{err}</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// An outbound write waiting for its owner, or the record of what happened to it.
function ExternalCallCard({ call: c, sessionId, myId, onOpen }: { call: ExternalCall; sessionId: string; myId: string; onOpen: () => void }) {
  const state = useStore((s) => s.state);
  const mine = c.ownerUserId === myId || state.participants[myId]?.role === "owner";
  const target = describeTarget(targetOf(c.args));
  const decide = (decision: "approved" | "denied", remember = false) => api("POST", `/api/v1/sessions/${sessionId}/external-calls/${c.id}/resolve`, { decision, remember });
  if (c.status === "pending") {
    return (
      <div className="msg approval" id={`call-${c.id}`}>
        <div className="who"><span>Approval needed</span><span className="chip accent">outbound write</span></div>
        <div className="text">
          The AI, for {participantName(state, c.onBehalfOf)}, wants to run <b>{c.serverName}.{c.toolName}</b> ({target}) with {participantName(state, c.ownerUserId)}'s tool.
          {c.readOnly ? "" : " Nothing is sent until it is approved; unanswered, it is denied."}
        </div>
        <div className="row" style={{ flexWrap: "wrap", marginTop: 6 }}>
          {mine ? (
            <>
              <button className="primary" onClick={() => decide("approved")}>Approve</button>
              {c.ownerUserId === myId && <button onClick={() => decide("approved", true)} title="Approve, and let this tool run for this target without asking again">Approve, always for {target}</button>}
              <button onClick={() => decide("denied")}>Deny</button>
            </>
          ) : (
            <span className="muted">Waiting for {participantName(state, c.ownerUserId)}.</span>
          )}
          <button className="icon" onClick={onOpen} title="See the full arguments in the Proposals tab">details</button>
        </div>
      </div>
    );
  }
  // Resolved: one quiet line. The result itself arrives as a system message when the tool ran.
  return (
    <div className="msg system" style={{ fontSize: 12 }}>
      {c.serverName}.{c.toolName} {c.status === "denied" ? "denied" : "approved"}{c.decidedBy ? ` by ${participantName(state, c.decidedBy)}` : c.reason ? ` (${c.reason})` : ""}
    </div>
  );
}

// A change to someone's card waiting for them.
function ProposalCard({ proposal: p, sessionId, myId, onOpen }: { proposal: Proposal; sessionId: string; myId: string; onOpen: () => void }) {
  const state = useStore((s) => s.state);
  const mine = p.requiresApprovalFrom.includes(myId) || state.participants[myId]?.role === "owner";
  const secs = p.autoApplyAt ? Math.max(0, Math.round((new Date(p.autoApplyAt).getTime() - Date.now()) / 1000)) : null;
  const decide = (decision: "approve" | "reject") => api("POST", `/api/v1/sessions/${sessionId}/proposals/${p.id}/resolve`, { decision });
  return (
    <div className="msg approval">
      <div className="who"><span>Approval needed</span><span className="chip accent">{p.risk.replace(/_/g, " ")}</span></div>
      <div className="text">
        {p.turnId ? "The AI, for " : ""}{participantName(state, p.proposerUserId)} wants to {p.op} <b>{p.title}</b>: {p.rationale}
        {secs !== null ? ` Applies by itself in ${secs}s if nobody answers.` : ""}
      </div>
      <div className="row" style={{ flexWrap: "wrap", marginTop: 6 }}>
        {mine ? (
          <>
            <button className="primary" onClick={() => decide("approve")}>Approve</button>
            <button onClick={() => decide("reject")}>Reject</button>
          </>
        ) : (
          <span className="muted">Waiting for {p.requiresApprovalFrom.map((u) => participantName(state, u)).join(", ")}.</span>
        )}
        <button className="icon" onClick={onOpen} title="See the diff in the Proposals tab">details</button>
      </div>
    </div>
  );
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// Running totals for the session from the completed turns: tokens in and out, requests, by
// model and by the person whose credential paid. Click to open the breakdown.
function UsageStrip() {
  const state = useStore((s) => s.state);
  const [open, setOpen] = useState(false);
  const turns = Object.values(state.turns).filter((t) => t.status === "committed" && t.usage);
  const add = (acc: Record<string, { i: number; o: number; r: number; n: number }>, key: string, t: (typeof turns)[number]) => {
    const cur = acc[key] ?? { i: 0, o: 0, r: 0, n: 0 };
    acc[key] = { i: cur.i + (t.usage!.inputTokens ?? 0), o: cur.o + (t.usage!.outputTokens ?? 0), r: cur.r + (t.usage!.premiumRequests ?? 0), n: cur.n + 1 };
    return acc;
  };
  const byModel = turns.reduce((acc, t) => add(acc, t.modelUsed ?? t.usage!.model ?? t.modelRequested, t), {} as Record<string, { i: number; o: number; r: number; n: number }>);
  const byPayer = turns.reduce((acc, t) => add(acc, t.payerUserId, t), {} as Record<string, { i: number; o: number; r: number; n: number }>);
  const total = Object.values(byModel).reduce((a, b) => ({ i: a.i + b.i, o: a.o + b.o, r: a.r + b.r, n: a.n + b.n }), { i: 0, o: 0, r: 0, n: 0 });
  if (turns.length === 0) return null;
  const lastModel = [...turns].sort((a, b) => a.startedAt.localeCompare(b.startedAt)).pop()!;
  const modelName = lastModel.modelUsed ?? lastModel.usage!.model ?? lastModel.modelRequested;
  return (
    <span className="usage" style={{ position: "relative" }}>
      <button className="icon" onClick={() => setOpen((o) => !o)} title="Tokens for this session so far: prompt in, reply out. Click for the breakdown by model and by who paid.">
        {fmtTokens(total.i)} in · {fmtTokens(total.o)} out · {modelName}
      </button>
      {open && (
        <div className="usage-pop" onMouseLeave={() => setOpen(false)}>
          <div className="mono" style={{ marginBottom: 4 }}>by model</div>
          <table>
            <tbody>
              {Object.entries(byModel).map(([k, v]) => (
                <tr key={k}><td>{k}</td><td className="mono num">{fmtTokens(v.i)} in</td><td className="mono num">{fmtTokens(v.o)} out</td><td className="mono num">{v.n} turn{v.n === 1 ? "" : "s"}{v.r ? ` · ${v.r} req` : ""}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="mono" style={{ margin: "8px 0 4px" }}>by who paid</div>
          <table>
            <tbody>
              {Object.entries(byPayer).map(([k, v]) => (
                <tr key={k}><td style={{ color: state.participants[k]?.color }}>{participantName(state, k)}</td><td className="mono num">{fmtTokens(v.i)} in</td><td className="mono num">{fmtTokens(v.o)} out</td><td className="mono num">{v.n} turn{v.n === 1 ? "" : "s"}{v.r ? ` · ${v.r} req` : ""}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Counts come from the provider per turn. "req" is premium requests on Copilot. Brief compactions are not included.</div>
        </div>
      )}
    </span>
  );
}
