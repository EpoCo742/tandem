import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { useStore, type PresenceUser } from "./state/store";

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
  current = provider;
  const onAwareness = () => {
    const states = provider.awareness?.getStates() ?? new Map();
    const seen = new Map<string, PresenceUser>();
    const editing: Record<string, PresenceUser[]> = {};
    for (const s of states.values()) {
      const u = (s as { user?: PresenceUser; editing?: string | null }).user;
      if (!u) continue;
      seen.set(u.userId, u);
      const e = (s as { editing?: string | null }).editing;
      if (e && u.userId !== me.userId) editing[e] = [...(editing[e] ?? []), u];
    }
    useStore.getState().setPresence([...seen.values()]);
    useStore.getState().setEditing(editing);
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
