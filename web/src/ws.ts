import type { ClientMessage, WireMessage } from "@tandem/shared";
import { useStore } from "./state/store";

// Ledger socket: subscribe from the last seq we have, replay, then live.

let socket: WebSocket | null = null;
let currentSession: string | null = null;
let retry = 0;

export function connectLedger(sessionId: string) {
  currentSession = sessionId;
  open();
}

export function disconnectLedger() {
  currentSession = null;
  socket?.close();
  socket = null;
}

function open() {
  if (!currentSession) return;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  socket = ws;
  ws.onopen = () => {
    retry = 0;
    useStore.getState().setConnected(true);
    const fromSeq = useStore.getState().state.lastSeq;
    send({ t: "subscribe", sessionId: currentSession!, fromSeq });
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data) as WireMessage;
    const s = useStore.getState();
    if (m.t === "event") s.applyEvent(m.event);
    else if (m.t === "ephemeral") s.applyEphemeral(m.event);
    else if (m.t === "error") console.warn("ledger:", m.message);
  };
  ws.onclose = () => {
    useStore.getState().setConnected(false);
    if (currentSession && socket === ws) {
      const delay = Math.min(8000, 500 * 2 ** retry++);
      setTimeout(open, delay);
    }
  };
}

export function send(msg: ClientMessage) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

let typingTimer: number | null = null;
export function signalTyping(lane: "ai" | "side") {
  if (!currentSession) return;
  send({ t: "typing", sessionId: currentSession, lane, active: true });
  if (typingTimer) window.clearTimeout(typingTimer);
  typingTimer = window.setTimeout(() => send({ t: "typing", sessionId: currentSession!, lane, active: false }), 1500);
}
