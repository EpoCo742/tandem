import type { AnyLedgerEvent, ClientMessage, WireMessage } from "@tandem/shared";
import { useStore } from "./state/store";

// Ledger socket: subscribe from the last seq we have, replay, then live.

let socket: WebSocket | null = null;
let currentSession: string | null = null;
let retry = 0;
// Events that arrive during a replay are held and applied together when the server says the
// replay is done, so a long session lands in one render instead of scrolling past event by event.
let pending: AnyLedgerEvent[] | null = null;

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
    pending = [];
    if (fromSeq === 0) useStore.getState().setLoading(true);
    send({ t: "subscribe", sessionId: currentSession!, fromSeq });
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data) as WireMessage;
    const s = useStore.getState();
    if (m.t === "event") {
      if (pending) pending.push(m.event);
      else s.applyEvent(m.event);
    } else if (m.t === "replay_done") {
      const batch = pending ?? [];
      pending = null;
      s.applyEvents(batch);
      s.setLoading(false);
    } else if (m.t === "ephemeral") s.applyEphemeral(m.event);
    else if (m.t === "error") {
      console.warn("ledger:", m.message);
      pending = null;
      s.setLoading(false);
    }
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
