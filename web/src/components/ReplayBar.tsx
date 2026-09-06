import { useEffect, useMemo } from "react";
import { useStore } from "../state/store";

// A time slider over the session. The ledger is complete and the reducer is pure, so any
// moment is a fold of the events up to a sequence number: the canvas, the registry, the
// constraints and the lane show what they were then. Read only until "back to now".
export function ReplayBar() {
  const replay = useStore((s) => s.replay);
  const state = useStore((s) => s.state);
  const setReplay = useStore((s) => s.setReplay);
  const live = replay?.live ?? state;
  const max = live.lastSeq;
  const seq = replay?.seq ?? max;
  const at = useMemo(() => {
    const ev = Object.values(live.eventsById).find((e) => e.seq === seq);
    return ev ? { when: new Date(ev.createdAt), type: ev.type } : null;
  }, [live, seq]);
  const marks = useMemo(() => Object.values(live.eventsById).filter((e) => e.type === "commit.created" || e.type === "decision.recorded").map((e) => e.seq), [live]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!replay) return;
      if (e.key === "Escape") setReplay(null);
      if (e.key === "ArrowLeft") setReplay(Math.max(1, seq - 1));
      if (e.key === "ArrowRight") setReplay(Math.min(max, seq + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [replay, seq, max, setReplay]);

  if (!replay) return null;
  return (
    <div className="replay-bar">
      <span className="mono">replay</span>
      <button className="icon" onClick={() => setReplay(Math.max(1, seq - 1))} title="One event back (←)">◀</button>
      <input type="range" min={1} max={max} value={seq} onChange={(e) => setReplay(Number(e.target.value))} list="replay-marks" style={{ flex: 1 }} />
      <datalist id="replay-marks">{marks.map((m) => <option key={m} value={m} />)}</datalist>
      <button className="icon" onClick={() => setReplay(Math.min(max, seq + 1))} title="One event forward (→)">▶</button>
      <span className="mono" style={{ minWidth: 260 }}>
        event {seq} of {max}{at ? ` · ${at.when.toLocaleString()} · ${at.type}` : ""}
      </span>
      <span className="muted" style={{ fontSize: 12 }}>read only while replaying</span>
      <button className="primary" style={{ fontSize: 12 }} onClick={() => setReplay(null)} title="Leave replay (Esc)">back to now</button>
    </div>
  );
}
