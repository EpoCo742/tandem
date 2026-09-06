import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { useStore, type Cursor, type PresenceMode, type PresenceUser } from "./state/store";

// Yjs layout document: Y.Map "nodes" (artifactId -> {x, y, w?, h?}). Awareness carries presence.

export interface Layout {
  x: number;
  y: number;
  w?: number;
  h?: number;
}

export interface Collab {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  nodes: Y.Map<Layout>;
  destroy: () => void;
}

let current: HocuspocusProvider | null = null;

/** Tell the others which card I have open in the editor (null when closed). Soft indicator, not a lock. */
export function setEditingArtifact(artifactId: string | null) {
  current?.setAwarenessField("editing", artifactId);
}

/** My pointer on the canvas, in flow coordinates (null when off the canvas). */
export function setCursor(pos: { x: number; y: number } | null) {
  current?.setAwarenessField("cursor", pos);
}

/** The card I have selected, so others see it outlined in my colour. */
export function setSelectedArtifact(artifactId: string | null) {
  current?.setAwarenessField("selected", artifactId);
}

/** Whether my cursor and selection are broadcast at all. Hidden people still count as present. */
export function setPresenceVisible(visible: boolean) {
  current?.setAwarenessField("visible", visible);
}

export function loadPresenceMode(sessionId: string): PresenceMode {
  try {
    const v = localStorage.getItem(`tandem.presence.${sessionId}`);
    if (v === "hide-me" || v === "hide-others" || v === "all") return v;
  } catch {
    /* storage may be blocked */
  }
  return "all";
}

export function connectCollab(sessionId: string, token: string, me: PresenceUser): Collab {
  const doc = new Y.Doc();
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const provider = new HocuspocusProvider({
    url: `${proto}://${location.host}/collab`,
    name: `session:${sessionId}:layout`,
    document: doc,
    token,
  });
  const nodes = doc.getMap<Layout>("nodes");
  provider.setAwarenessField("user", me);
  provider.setAwarenessField("visible", loadPresenceMode(sessionId) !== "hide-me");
  current = provider;
  const onAwareness = () => {
    const states = provider.awareness?.getStates() ?? new Map();
    const seen = new Map<string, PresenceUser>();
    const editing: Record<string, PresenceUser[]> = {};
    const selections: Record<string, PresenceUser[]> = {};
    const cursors: Cursor[] = [];
    for (const s of states.values()) {
      const st = s as { user?: PresenceUser; editing?: string | null; cursor?: { x: number; y: number } | null; selected?: string | null; visible?: boolean };
      const u = st.user;
      if (!u) continue;
      const hidden = st.visible === false;
      seen.set(u.userId, { ...u, hidden });
      if (u.userId === me.userId) continue;
      if (st.editing) editing[st.editing] = [...(editing[st.editing] ?? []), u];
      if (hidden) continue; // someone who hides themselves is shown to nobody
      if (st.selected) selections[st.selected] = [...(selections[st.selected] ?? []), u];
      if (st.cursor) cursors.push({ user: u, x: st.cursor.x, y: st.cursor.y });
    }
    const store = useStore.getState();
    store.setPresence([...seen.values()]);
    store.setEditing(editing);
    store.setSelections(selections);
    store.setCursors(cursors);
  };
  provider.awareness?.on("change", onAwareness);
  onAwareness();
  return {
    doc,
    provider,
    nodes,
    destroy: () => {
      if (current === provider) current = null;
      provider.awareness?.off("change", onAwareness);
      provider.destroy();
      doc.destroy();
    },
  };
}
