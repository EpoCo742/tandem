import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { and, eq } from "drizzle-orm";
import type { ClientMessage, WireMessage } from "@tandem/shared";
import { userFromRequest } from "./auth.js";
import { bus } from "./bus.js";
import { isDemoSession } from "./demo.js";
import { listEvents } from "./ledger.js";
import { db, schema } from "./db/index.js";
import { brokerFor } from "./turn/broker.js";

// /ws: ledger fan-out. Client subscribes from a seq, gets a replay, then live events.

export async function registerLedgerSocket(app: FastifyInstance) {
  app.get("/ws", { websocket: true }, (socket: WebSocket, req) => {
    const user = userFromRequest(req);
    if (!user) {
      socket.send(JSON.stringify({ t: "error", message: "not authenticated" } satisfies WireMessage));
      socket.close();
      return;
    }
    const unsubscribers = new Map<string, () => void>();
    const send = (m: WireMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(m));
    };

    socket.on("message", (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.t === "subscribe") {
        const p = db.select().from(schema.participants).where(and(eq(schema.participants.sessionId, msg.sessionId), eq(schema.participants.userId, user.id))).get();
        if (!p && !isDemoSession(msg.sessionId)) return send({ t: "error", message: "not a participant" });
        unsubscribers.get(msg.sessionId)?.();
        const replay = listEvents(msg.sessionId, msg.fromSeq);
        for (const event of replay) send({ t: "event", event });
        send({ t: "replay_done", seq: replay[replay.length - 1]?.seq ?? msg.fromSeq });
        const off = bus.subscribe(msg.sessionId, (m) => {
          if (m.kind === "event") send({ t: "event", event: m.event });
          else send({ t: "ephemeral", event: m.event });
        });
        unsubscribers.set(msg.sessionId, off);
        brokerFor(msg.sessionId); // ensure broker exists so turn.state is published
      } else if (msg.t === "typing") {
        bus.publish(msg.sessionId, { kind: "ephemeral", event: { kind: "typing", sessionId: msg.sessionId, userId: user.id, lane: msg.lane, active: msg.active } });
        if (msg.lane === "ai" && msg.active) brokerFor(msg.sessionId).extendWindow();
      }
    });

    socket.on("close", () => {
      for (const off of unsubscribers.values()) off();
      unsubscribers.clear();
    });
  });
}
