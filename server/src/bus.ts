import { EventEmitter } from "node:events";
import type { AnyLedgerEvent, EphemeralEvent } from "@tandem/shared";

// In-process fan-out. Production swaps this for Redis pub/sub behind the same two calls.

const emitter = new EventEmitter();
emitter.setMaxListeners(1000);

export type BusMessage = { kind: "event"; event: AnyLedgerEvent } | { kind: "ephemeral"; event: EphemeralEvent };

export const bus = {
  publish(sessionId: string, msg: BusMessage) {
    emitter.emit(`session:${sessionId}`, msg);
  },
  subscribe(sessionId: string, handler: (msg: BusMessage) => void): () => void {
    const key = `session:${sessionId}`;
    emitter.on(key, handler);
    return () => emitter.off(key, handler);
  },
};
