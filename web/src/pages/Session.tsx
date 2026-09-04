import { useEffect, useRef, useState } from "react";
import { api, type SessionMeta } from "../api";
import { useStore } from "../state/store";
import { connectLedger, disconnectLedger } from "../ws";
import { connectCollab, type Collab } from "../collab";
import { TopBar, Avatar } from "../components/TopBar";
import { navigate } from "../App";
import { ConversationPane } from "../components/ConversationPane";
import { Canvas } from "../components/Canvas";
import { SidePane } from "../components/SidePane";

export function Session({ sessionId }: { sessionId: string }) {
  const me = useStore((s) => s.me)!;
  const meta = useStore((s) => s.meta);
  const setMeta = useStore((s) => s.setMeta);
  const reset = useStore((s) => s.reset);
  const state = useStore((s) => s.state);
  const presence = useStore((s) => s.presence);
  const connected = useStore((s) => s.connected);
  const [err, setErr] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const collabRef = useRef<Collab | null>(null);
  const [collab, setCollab] = useState<Collab | null>(null);

  useEffect(() => {
    reset(sessionId);
    let cancelled = false;
    api<SessionMeta>("GET", `/api/v1/sessions/${sessionId}`)
      .then((m) => {
        if (cancelled) return;
        setMeta(m);
        connectLedger(sessionId);
      })
      .catch((e) => setErr((e as Error).message));
    return () => {
      cancelled = true;
      disconnectLedger();
      collabRef.current?.destroy();
      collabRef.current = null;
      setMeta(null);
    };
  }, [sessionId, reset, setMeta]);

  // Connect Yjs once we know our participant colour.
  const myParticipant = state.participants[me.user!.id];
  useEffect(() => {
    if (!meta || !myParticipant || collabRef.current) return;
    const c = connectCollab(sessionId, meta.collabToken, { userId: me.user!.id, name: myParticipant.name, color: myParticipant.color });
    collabRef.current = c;
    setCollab(c);
  }, [meta, myParticipant, sessionId, me.user]);

  if (err) return <div className="page err">{err}</div>;
  if (!meta) return <div className="page muted">Loading session…</div>;

  async function invite() {
    const r = await api<{ url: string }>("POST", `/api/v1/sessions/${sessionId}/invites`);
    setInviteUrl(r.url);
    try {
      await navigator.clipboard.writeText(r.url);
    } catch {
      /* clipboard may be blocked */
    }
  }

  return (
    <div className="session">
      <TopBar>
        <span style={{ fontWeight: 600 }}>{state.title || meta.title}</span>
        <span className="mono">{meta.provider} · {meta.pinnedModel} · {meta.payerMode} · {state.policy}</span>
        <span className="mono" style={{ color: connected ? "var(--ok)" : "var(--warn)" }}>{connected ? "live" : "reconnecting"}</span>
        <div className="presence" title="present now">
          {presence.map((p) => <Avatar key={p.userId} name={p.name} color={p.color} />)}
        </div>
        <button onClick={invite}>Invite</button>
        {inviteUrl && <span className="mono" style={{ userSelect: "all" }}>{inviteUrl}</span>}
        {state.forkedFrom && (
          <a className="mono" href={`/s/${state.forkedFrom.sessionId}`} onClick={(e) => { e.preventDefault(); navigate(`/s/${state.forkedFrom!.sessionId}`); }} title="This session was forked from another one">forked from {state.forkedFrom.title}</a>
        )}
        <button className="primary" title="Ask the AI to assemble a design document from the canvas and decision registry" onClick={() => api("POST", `/api/v1/sessions/${sessionId}/compile`).catch((e) => setErr((e as Error).message))}>Compile design doc</button>
        <button title="Start a new session from the current canvas and agreed decisions; this one stays intact" onClick={() => api<{ id: string }>("POST", `/api/v1/sessions/${sessionId}/fork`, {}).then((r) => navigate(`/s/${r.id}`)).catch((e) => setErr((e as Error).message))}>Fork as v2</button>
        <a href={`/api/v1/sessions/${sessionId}/export`} target="_blank" rel="noreferrer"><button>Export .md</button></a>
      </TopBar>
      <ConversationPane sessionId={sessionId} />
      <div className="canvas-wrap">{collab ? <Canvas sessionId={sessionId} collab={collab} /> : <div className="page muted">Connecting canvas…</div>}</div>
      <SidePane sessionId={sessionId} />
    </div>
  );
}
