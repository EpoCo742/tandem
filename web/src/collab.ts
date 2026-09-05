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
  const onAwareness = () => {
    const states = provider.awareness?.getStates() ?? new Map();
    const seen = new Map<string, PresenceUser>();
    for (const s of states.values()) {
      const u = (s as { user?: PresenceUser }).user;
      if (u) seen.set(u.userId, u);
    }
    useStore.getState().setPresence([...seen.values()]);
  };
  provider.awareness?.on("change", onAwareness);
  onAwareness();
  return {
    doc,
    provider,
    nodes,
    destroy: () => {
      provider.awareness?.off("change", onAwareness);
      provider.destroy();
      doc.destroy();
    },
  };
}
