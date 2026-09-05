import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import { Hocuspocus } from "@hocuspocus/server";
import { eq } from "drizzle-orm";
import * as Y from "yjs";
import { db, now, schema } from "./db/index.js";
import { verifyCollabToken } from "./crypto.js";

// Embedded Hocuspocus: canvas layout + presence, persisted to SQLite. Document names:
//   session:{id}:layout   -> Y.Map "nodes" (artifactId -> {x, y, w, h})

export const hocuspocus = new Hocuspocus({
  quiet: true,
  debounce: 1500,
  maxDebounce: 5000,
  async onAuthenticate({ token, documentName }) {
    const auth = verifyCollabToken(token);
    if (!auth) throw new Error("invalid collab token");
    if (!documentName.startsWith(`session:${auth.sessionId}:`)) throw new Error("token does not cover this document");
    return { userId: auth.userId, sessionId: auth.sessionId };
  },
  async onLoadDocument({ document, documentName }) {
    const row = db.select().from(schema.yjsDocuments).where(eq(schema.yjsDocuments.name, documentName)).get();
    if (row) Y.applyUpdate(document, new Uint8Array(row.state));
    return document;
  },
  async onStoreDocument({ document, documentName }) {
    const state = Buffer.from(Y.encodeStateAsUpdate(document));
    db.insert(schema.yjsDocuments)
      .values({ name: documentName, state, updatedAt: now() })
      .onConflictDoUpdate({ target: schema.yjsDocuments.name, set: { state, updatedAt: now() } })
      .run();
  },
});

function toFetchRequest(req: IncomingMessage): Request {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers.set(k, v);
    else if (Array.isArray(v)) headers.set(k, v.join(", "));
  }
  const host = req.headers.host ?? "localhost";
  return new Request(`http://${host}${req.url ?? "/collab"}`, { headers });
}

export async function registerCollabSocket(app: FastifyInstance) {
  app.get("/collab", { websocket: true }, (socket: WebSocket, req) => {
    // Hocuspocus 4 does not subscribe to the socket itself: the integration must feed it every
    // frame and tell it when the socket closes. Without this the client never authenticates,
    // the server times the connection out, and layout changes never leave the browser.
    const conn = hocuspocus.handleConnection(socket as never, toFetchRequest(req.raw));
    socket.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
      const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
      conn.handleMessage(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    });
    socket.on("close", (code: number, reason: Buffer) => conn.handleClose({ code, reason: reason.toString() } as never));
    socket.on("error", () => conn.handleClose(undefined));
  });
}
