import { create } from "zustand";
import { emptyState, reduce, type AnyLedgerEvent, type EphemeralEvent, type SessionState, type TurnStatus } from "@tandem/shared";
import type { Me, SessionMeta } from "../api";

export interface PresenceUser {
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
  highlight: string[];
  setHighlight: (ids: string[]) => void;
  connected: boolean;
  setConnected: (c: boolean) => void;
  focusArtifactId: string | null;
  setFocusArtifact: (id: string | null) => void;
}

export const useStore = create<Store>((set, get) => ({
  me: null,
  setMe: (me) => set({ me }),
  meta: null,
  setMeta: (meta) => set({ meta }),
  state: emptyState(""),
  reset: (sessionId) => set({ state: emptyState(sessionId), streaming: null, toolProgress: null, turn: { state: "idle", queued: 0, turnId: null, payerUserId: null }, typing: {}, highlight: [] }),
  applyEvent: (ev) => {
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
    }
  },
  streaming: null,
  toolProgress: null,
  turn: { state: "idle", queued: 0, turnId: null, payerUserId: null },
  typing: {},
  presence: [],
  setPresence: (presence) => set({ presence }),
  highlight: [],
  setHighlight: (highlight) => set({ highlight }),
  connected: false,
  setConnected: (connected) => set({ connected }),
  focusArtifactId: null,
  setFocusArtifact: (focusArtifactId) => set({ focusArtifactId }),
}));
