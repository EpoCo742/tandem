import { threadRootOf, threads, type ChatMessage, type SessionState } from "@tandem/shared";

// What promotion did to a note. A promoted message carries the rest of its thread to the AI
// as background, so everything written before the promotion has been seen; only messages
// added afterwards can still be promoted.
export type PromotionState = "promoted" | "sent" | "none";

export function promotionStates(state: SessionState): (m: ChatMessage) => PromotionState {
  const promotedFrom = new Map<string, number>(); // note event id -> seq of the promotion
  for (const m of state.messages) {
    if (m.mode !== "promoted") continue;
    const from = state.eventsById[m.eventId]?.causedBy[0];
    if (from) promotedFrom.set(from, m.seq);
  }
  const all = threads(state);
  const sentThrough = new Map<string, number>(); // thread root id -> latest promotion seq in that thread
  for (const t of all) {
    const seqs = [t.root, ...t.replies].map((m) => promotedFrom.get(m.eventId) ?? 0);
    const latest = Math.max(0, ...seqs);
    if (latest) sentThrough.set(t.root.eventId, latest);
  }
  return (m) => {
    if (promotedFrom.has(m.eventId)) return "promoted";
    const root = m.anchor || m.replyTo ? threadRootOf(state, m.eventId) : undefined;
    const through = root ? sentThrough.get(root.eventId) : undefined;
    return through && m.seq < through ? "sent" : "none";
  };
}
