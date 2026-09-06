import { create } from "zustand";
import { emptyState, reduce, reduceUpTo, type AnyLedgerEvent, type EphemeralEvent, type MessageAnchor, type SessionState, type TurnStatus } from "@tandem/shared";
import type { Me, SessionMeta } from "../api";

export interface Cursor { user: PresenceUser; x: number; y: number }
export type PresenceMode = "all" | "hide-me" | "hide-others";

export interface PresenceUser {
  hidden?: boolean; // this person chose not to show their cursor and selection
  userId: string;
  name: string;
  color: string;
  avatarUrl?: string | null;
}

interface Store {
  me: Me | null;
  setMe: (me: Me | null) => void;
  meta: SessionMeta | null;
  setMeta: (m: SessionMeta | null) => void;
  state: SessionState;
  reset: (sessionId: string) => void;
  applyEvent: (ev: AnyLedgerEvent) => void;
  applyEphemeral: (ev: EphemeralEvent) => void;
  streaming: { turnId: string; text: string } | null;
  toolProgress: string | null;
  turn: { state: TurnStatus | "idle"; queued: number; turnId: string | null; payerUserId: string | null };
  typing: Record<string, "ai" | "side">;
  presence: PresenceUser[];
  setPresence: (p: PresenceUser[]) => void;
  editing: Record<string, PresenceUser[]>; // artifactId -> who has it open in the editor
  cursors: Cursor[]; // other people's pointers on the canvas, in flow coordinates
  setCursors: (c: Cursor[]) => void;
  selections: Record<string, PresenceUser[]>; // artifactId -> who has it selected
  setSelections: (s: Record<string, PresenceUser[]>) => void;
  presenceMode: PresenceMode; // see others and be seen; hide me; hide others
  composerDraft: string | null; // text another part of the UI wants in the AI composer (a starter prompt)
  setComposerDraft: (t: string | null) => void;
  setPresenceMode: (sessionId: string, m: PresenceMode) => void;
  setEditing: (e: Record<string, PresenceUser[]>) => void;
  highlight: string[];
  setHighlight: (ids: string[]) => void;
  connected: boolean;
  setConnected: (c: boolean) => void;
  gone: boolean; // the session was deleted while this tab had it open
  replay: { seq: number; live: SessionState } | null; // when set, `state` is the session folded to `seq` and `live` keeps receiving events
  setReplay: (seq: number | null) => void;
  seenAtOpen: number; // how far I had read when this tab opened the session; cards changed after that carry a mark
  acknowledged: Record<string, true>; // cards I have touched since opening, so their mark is gone
  acknowledge: (artifactId: string) => void;
  focusArtifactId: string | null;
  setFocusArtifact: (id: string | null) => void;
  focusComponentId: string | null; // architecture model component whose decisions the side pane shows
  setFocusComponent: (id: string | null) => void;
  requestedTab: string | null; // a tab another part of the UI wants the side pane to show
  requestTab: (tab: string | null) => void;
  threadTarget: MessageAnchor | null; // the card (and component) whose threads are open in the panel
  setThreadTarget: (t: MessageAnchor | null) => void;
}

export const useStore = create<Store>((set, get) => ({
  me: null,
  setMe: (me) => set({ me }),
  meta: null,
  setMeta: (meta) => set({ meta, ...(meta ? { seenAtOpen: meta.me.lastSeenSeq ?? 0, acknowledged: {} } : {}) }),
  seenAtOpen: 0,
  acknowledged: {},
  acknowledge: (artifactId) => { if (!get().acknowledged[artifactId]) set({ acknowledged: { ...get().acknowledged, [artifactId]: true } }); },
  state: emptyState(""),
  reset: (sessionId) => set({ state: emptyState(sessionId), gone: false, replay: null, streaming: null, toolProgress: null, turn: { state: "idle", queued: 0, turnId: null, payerUserId: null }, typing: {}, highlight: [] }),
  replay: null,
  setReplay: (seq) => {
    const cur = get();
    const live = cur.replay?.live ?? cur.state;
    if (seq === null) { set({ replay: null, state: live }); return; }
    const clamped = Math.max(1, Math.min(live.lastSeq, seq));
    set({ replay: { seq: clamped, live }, state: reduceUpTo(live.id, Object.values(live.eventsById), clamped), highlight: [] });
  },
  applyEvent: (ev) => {
    const replaying = get().replay;
    if (replaying) {
      // The past does not move; the present keeps up in the background.
      set({ replay: { ...replaying, live: reduce(replaying.live, ev) } });
      return;
    }
    const next = reduce(get().state, ev);
    const patch: Partial<Store> = { state: next };
    if (ev.type === "ai.message" || ev.type === "turn.failed" || ev.type === "turn.completed") {
      if (get().streaming?.turnId === ev.turnId || ev.type !== "ai.message") patch.streaming = null;
      patch.toolProgress = null;
    }
    set(patch);
  },
  applyEphemeral: (ev) => {
    if (ev.kind === "ai.delta") {
      const cur = get().streaming;
      set({ streaming: cur && cur.turnId === ev.turnId ? { turnId: ev.turnId, text: cur.text + ev.text } : { turnId: ev.turnId, text: ev.text } });
    } else if (ev.kind === "ai.tool_progress") {
      set({ toolProgress: ev.status === "start" ? `calling ${ev.tool}` : null });
    } else if (ev.kind === "turn.state") {
      set({ turn: { state: ev.state, queued: ev.queued, turnId: ev.turnId, payerUserId: ev.payerUserId } });
      if (ev.state === "idle") set({ streaming: null, toolProgress: null });
    } else if (ev.kind === "typing") {
      const typing = { ...get().typing };
      if (ev.active) typing[ev.userId] = ev.lane;
      else delete typing[ev.userId];
      set({ typing });
    } else if (ev.kind === "session.deleted") {
      set({ gone: true });
    }
  },
  gone: false,
  streaming: null,
  toolProgress: null,
  turn: { state: "idle", queued: 0, turnId: null, payerUserId: null },
  typing: {},
  presence: [],
  setPresence: (presence) => set({ presence }),
  editing: {},
  setEditing: (editing) => set({ editing }),
  cursors: [],
  setCursors: (cursors) => set({ cursors }),
  selections: {},
  setSelections: (selections) => set({ selections }),
  presenceMode: "all",
  composerDraft: null,
  setComposerDraft: (composerDraft) => set({ composerDraft }),
  setPresenceMode: (sessionId, presenceMode) => {
    try { localStorage.setItem(`tandem.presence.${sessionId}`, presenceMode); } catch { /* storage may be blocked */ }
    set({ presenceMode });
  },
  highlight: [],
  setHighlight: (highlight) => set({ highlight }),
  connected: false,
  setConnected: (connected) => set({ connected }),
  focusArtifactId: null,
  setFocusArtifact: (focusArtifactId) => set({ focusArtifactId }),
  focusComponentId: null,
  setFocusComponent: (focusComponentId) => set({ focusComponentId }),
  requestedTab: null,
  requestTab: (requestedTab) => set({ requestedTab }),
  threadTarget: null,
  setThreadTarget: (threadTarget) => set({ threadTarget }),
}));
