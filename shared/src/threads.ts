import type { MessageAnchor } from "./events.js";
import type { ArchModelContent } from "./model.js";
import type { ChatMessage, SessionState } from "./reducer.js";

// Threads are human-only conversations anchored to a card, or to one component of the
// architecture model as shown on a card. A thread is a side-channel note with an anchor
// and the notes that reply to it. Nothing in a thread reaches the AI until a message is
// promoted; the promotion carries the anchor so "this" means something to the model.

export interface Thread {
  root: ChatMessage;
  replies: ChatMessage[];
  anchor: MessageAnchor;
  resolved: boolean;
}

const isNote = (m: ChatMessage) => m.kind === "user" && m.mode === "note";

/** Follow replyTo links up to the message that started the thread. */
export function threadRootOf(state: SessionState, eventId: string): ChatMessage | undefined {
  let m = state.messages.find((x) => x.eventId === eventId);
  const seen = new Set<string>();
  while (m && m.replyTo && !seen.has(m.eventId)) {
    seen.add(m.eventId);
    m = state.messages.find((x) => x.eventId === m!.replyTo);
  }
  return m;
}

export function threads(state: SessionState): Thread[] {
  const roots = state.messages.filter((m) => isNote(m) && m.anchor && !m.replyTo);
  const byRoot = new Map<string, ChatMessage[]>();
  for (const m of state.messages) {
    if (!isNote(m) || !m.replyTo) continue;
    const root = threadRootOf(state, m.eventId);
    if (!root) continue;
    byRoot.set(root.eventId, [...(byRoot.get(root.eventId) ?? []), m]);
  }
  return roots.map((root) => ({ root, replies: byRoot.get(root.eventId) ?? [], anchor: root.anchor!, resolved: Boolean(root.resolved) }));
}

export function threadsFor(state: SessionState, artifactId: string): Thread[] {
  return threads(state).filter((t) => t.anchor.artifactId === artifactId);
}

/** "System architecture › Postgres", or just the card title for a whole-card anchor. */
export function describeAnchor(state: SessionState, anchor: MessageAnchor): string {
  const title = state.artifacts[anchor.artifactId]?.title ?? anchor.artifactId;
  if (!anchor.componentId) return title;
  const model = Object.values(state.artifacts).find((a) => a.type === "arch_model" && !a.deleted)?.current.content as ArchModelContent | undefined;
  const name = model?.components.find((c) => c.id === anchor.componentId)?.name ?? anchor.componentId;
  return `${title} › ${name}`;
}
