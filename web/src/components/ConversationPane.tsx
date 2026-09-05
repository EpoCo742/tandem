import { useEffect, useRef, useState } from "react";
import { participantName, AI_COLOR } from "@tandem/shared";
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

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, streaming?.text]);

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
      <div className="pane-head">AI lane <span className="grow" /><span>{Object.keys(state.participants).length} participants</span></div>
      <div className="pane-body" ref={bodyRef}>
        {messages.map((m) => {
          const color = m.kind === "user" ? state.participants[m.userId!]?.color ?? "#999" : AI_COLOR;
          const cls = m.kind === "ai" ? "msg ai" : m.kind === "system" ? "msg system" : m.kind === "clarification" ? "msg ai" : "msg";
          const flash = highlight.includes(m.eventId) ? " flash" : "";
          return (
            <div key={m.eventId} id={`msg-${m.eventId}`} className={cls + flash} style={m.kind === "user" ? { borderLeftColor: color } : undefined}>
              <div className="who">
                {m.kind === "user" && <span style={{ color }}>{participantName(state, m.userId)}{m.mode === "promoted" ? " · promoted from side channel" : ""}</span>}
                {m.kind === "ai" && (
                  <>
                    <span style={{ color: AI_COLOR }}>AI · for {participantName(state, m.onBehalfOf)}</span>
                    <span className="chip" style={{ color: state.participants[m.payerUserId ?? ""]?.color ?? AI_COLOR }} title="whose credential funded this turn">
                      ran on {participantName(state, m.payerUserId)}'s {m.provider}{meta.payerMode === "sponsor" ? " (sponsor)" : ""} · {m.model}
                    </span>
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
              <button className="primary" onClick={send} disabled={(!text.trim() && !staged) || uploading}>{uploading ? "Uploading…" : staged && !text.trim() ? "Upload" : "Send to AI"}</button>
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
