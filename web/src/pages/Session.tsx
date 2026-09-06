import { useEffect, useRef, useState } from "react";
import { api, type SessionMeta } from "../api";
import { useStore } from "../state/store";
import { connectLedger, disconnectLedger } from "../ws";
import { connectCollab, loadPresenceMode, setPresenceVisible, type Collab } from "../collab";
import { TopBar, Avatar } from "../components/TopBar";
import { navigate } from "../App";
import { ConversationPane } from "../components/ConversationPane";
import { Canvas } from "../components/Canvas";
import { SidePane } from "../components/SidePane";
import { ExportPreview } from "../components/ExportPreview";
import { ThreadPanel } from "../components/ThreadPanel";
import { SessionMenu } from "../components/SessionMenu";
import { ReplayBar } from "../components/ReplayBar";
import { Presentation } from "../components/Presentation";
import { completeness } from "@tandem/shared";

export function Session({ sessionId }: { sessionId: string }) {
  const me = useStore((s) => s.me)!;
  const meta = useStore((s) => s.meta);
  const setMeta = useStore((s) => s.setMeta);
  const reset = useStore((s) => s.reset);
  const state = useStore((s) => s.state);
  const presence = useStore((s) => s.presence);
  const connected = useStore((s) => s.connected);
  const gone = useStore((s) => s.gone);
  const requestTab = useStore((s) => s.requestTab);
  const replay = useStore((s) => s.replay);
  const setReplay = useStore((s) => s.setReplay);
  const presenceMode = useStore((s) => s.presenceMode);
  const setPresenceMode = useStore((s) => s.setPresenceMode);
  useEffect(() => {
    setPresenceMode(sessionId, loadPresenceMode(sessionId));
  }, [sessionId, setPresenceMode]);
  function cyclePresence() {
    const order: ("all" | "hide-me" | "hide-others")[] = ["all", "hide-me", "hide-others"];
    const next = order[(order.indexOf(presenceMode) + 1) % order.length]!;
    setPresenceMode(sessionId, next);
    setPresenceVisible(next !== "hide-me");
  }
  const [err, setErr] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteRole, setInviteRole] = useState<"editor" | "reviewer" | "viewer">("editor");
  const [exporting, setExporting] = useState(false);
  const [presenting, setPresenting] = useState(false);
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

  // Tell the server how far I have read, so the digest can say what changed since; throttled, and only while visible.
  const lastSeq = state.lastSeq;
  useEffect(() => {
    if (!meta || !lastSeq || document.visibilityState !== "visible") return;
    const t = setTimeout(() => void api("POST", `/api/v1/sessions/${sessionId}/seen`, { seq: lastSeq }).catch(() => undefined), 1500);
    return () => clearTimeout(t);
  }, [lastSeq, meta, sessionId]);

  // Connect Yjs once we know our participant colour.
  // In the demo, a reader is a viewer who never joined the ledger; give them a presence identity anyway.
  const myParticipant = state.participants[me.user!.id] ?? (meta?.demo && state.lastSeq > 0 ? { userId: me.user!.id, name: me.user!.displayName || me.user!.handle, color: "#7C8893", role: "viewer" as const, avatarUrl: me.user!.avatarUrl ?? undefined } : undefined);
  // "?replay=1" opens the demo at its first event.
  const replayAtOpen = useRef(new URLSearchParams(location.search).get("replay") === "1");
  useEffect(() => {
    if (replayAtOpen.current && state.lastSeq > 0 && meta) {
      replayAtOpen.current = false;
      setReplay(1);
    }
  }, [state.lastSeq, meta, setReplay]);
  useEffect(() => {
    if (!meta || !myParticipant || collabRef.current) return;
    const c = connectCollab(sessionId, meta.collabToken, { userId: me.user!.id, name: myParticipant.name, color: myParticipant.color, avatarUrl: me.user!.avatarUrl });
    collabRef.current = c;
    setCollab(c);
  }, [meta, myParticipant, sessionId, me.user]);

  if (gone) {
    return (
      <>
        <TopBar />
        <div className="page">
          <p>This session was deleted by its owner.</p>
          <button onClick={() => navigate("/")}>Back to your sessions</button>
        </div>
      </>
    );
  }
  if (err) return <div className="page err">{err}</div>;
  if (!meta) return <div className="page muted">Loading session…</div>;
  const isOwner = meta.me.role === "owner";
  const archived = state.status === "archived";
  const demo = meta.demo;
  const readOnly = archived || demo;
  const checklist = completeness(state);

  async function invite() {
    const r = await api<{ url: string }>("POST", `/api/v1/sessions/${sessionId}/invites`, { role: inviteRole });
    setInviteUrl(r.url);
    try {
      await navigator.clipboard.writeText(r.url);
    } catch {
      /* clipboard may be blocked */
    }
  }

  return (
    <div className={`session${archived ? " archived" : ""}${demo ? " demo" : ""}${replay ? " replaying" : ""}`}>
      <TopBar>
        <span style={{ fontWeight: 600 }}>{meta.demo ? meta.title : state.title || meta.title}</span>
        {!demo && <SessionMenu sessionId={sessionId} title={state.title || meta.title} status={archived ? "archived" : "active"} isOwner={isOwner} onDeleted={() => navigate("/")} />}
        {archived && <span className="chip" title="Read only until the owner reopens it">archived</span>}
        {demo && <span className="chip" style={{ color: "var(--accent)" }} title="The built-in demo: read only for everyone">demo</span>}
        {checklist && (
          <button className="icon" onClick={() => requestTab("checklist")} title={`${checklist.template.name}: ${checklist.done} of ${checklist.total} checklist items done. Missing: ${checklist.items.filter((i) => !i.done).map((i) => i.title).join(", ") || "nothing"}`}>
            {checklist.template.name} · {checklist.done}/{checklist.total}
          </button>
        )}
        <button className={"icon" + (replay ? " primary" : "")} onClick={() => setReplay(replay ? null : Math.max(1, state.lastSeq - 1))} title="Scrub through the session's history: every card, decision and message as it was at that moment">{replay ? "replaying" : "replay"}</button>
        <span className="mono">{meta.provider} · {meta.pinnedModel} · {meta.payerMode} · {state.policy}</span>
        <span className="mono" style={{ color: connected ? "var(--ok)" : "var(--warn)" }}>{connected ? "live" : "reconnecting"}</span>
        <div className="presence" title={`${presence.length} present${presence.filter((p) => p.hidden).length ? `, ${presence.filter((p) => p.hidden).length} with cursor hidden` : ""}`}>
          {presence.map((p) => <span key={p.userId} className={p.hidden ? "hidden-presence" : ""} title={p.hidden ? `${p.name} (cursor hidden)` : p.name}><Avatar name={p.name} color={p.color} src={p.avatarUrl} /></span>)}
        </div>
        <button className="icon" onClick={cyclePresence} title={presenceMode === "all" ? "Cursors: you see others and they see you. Click to hide yours." : presenceMode === "hide-me" ? "Your cursor and selection are hidden from everyone; you still see theirs. Click to hide theirs too." : "You see no cursors and yours is shown. Click to show all."}>
          {presenceMode === "all" ? "cursors: all" : presenceMode === "hide-me" ? "cursors: hide me" : "cursors: hide others"}
        </button>
        <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as typeof inviteRole)} style={{ width: "auto" }} title="Editors change the canvas. Reviewers comment, vote, sign off and propose, but nothing they do lands without approval. Viewers only read.">
          <option value="editor">as editor</option>
          <option value="reviewer">as reviewer</option>
          <option value="viewer">as viewer</option>
        </select>
        {!demo && <button onClick={invite} disabled={readOnly}>Invite</button>}
        {inviteUrl && <span className="mono" style={{ userSelect: "all" }}>{inviteUrl}</span>}
        {state.forkedFrom && (
          <a className="mono" href={`/s/${state.forkedFrom.sessionId}`} onClick={(e) => { e.preventDefault(); navigate(`/s/${state.forkedFrom!.sessionId}`); }} title="This session was forked from another one">forked from {state.forkedFrom.title}</a>
        )}
        <button className="primary" disabled={readOnly} title="Ask the AI to assemble a design document from the canvas and decision registry" onClick={() => api("POST", `/api/v1/sessions/${sessionId}/compile`).catch((e) => setErr((e as Error).message))}>Compile design doc</button>
        {!demo && <button title="Start a new session from the current canvas and agreed decisions; this one stays intact" onClick={() => api<{ id: string }>("POST", `/api/v1/sessions/${sessionId}/fork`, {}).then((r) => navigate(`/s/${r.id}`)).catch((e) => setErr((e as Error).message))}>Fork as v2</button>}
        <button onClick={() => setExporting(true)} title="Preview the Markdown export, then copy or download it">Export .md</button>
        <button onClick={() => setPresenting(true)} disabled={!collab} title="Walk through the cards one per screen, in an order you set, with the decision log as the closing screen">Present</button>
      </TopBar>
      <ReplayBar />
      {demo && !replay && (
        <div className="archived-banner">
          This is the built-in demo: a complete session, read only for everyone. <a href="#" onClick={(e) => { e.preventDefault(); setReplay(1); }}>Replay it from the first event</a> to see how two people and the AI built it, or start a session of your own from the home page.
        </div>
      )}
      {archived && !replay && (
        <div className="archived-banner">
          This session is archived: everything stays readable and exportable, nothing can change.{isOwner ? " Reopen it from the session menu next to the title." : " The owner can reopen it."}
        </div>
      )}
      {exporting && <ExportPreview sessionId={sessionId} title={state.title || meta.title} onClose={() => setExporting(false)} />}
      {presenting && collab && <Presentation sessionId={sessionId} collab={collab} onClose={() => setPresenting(false)} />}
      <ThreadPanel sessionId={sessionId} />
      <ConversationPane sessionId={sessionId} />
      <div className="canvas-wrap">{collab ? <Canvas sessionId={sessionId} collab={collab} /> : <div className="page muted">Connecting canvas…</div>}</div>
      <SidePane sessionId={sessionId} />
    </div>
  );
}
