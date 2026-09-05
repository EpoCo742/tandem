import { useState } from "react";
import { participantName, type Artifact } from "@tandem/shared";
import { api } from "../api";
import { useStore } from "../state/store";

// The design document's status and the people who stand behind it. Draft: anyone can ask for a
// review and name who has to sign. In review: named reviewers sign; the last signature approves
// and records a decision. Approved: any change to the canvas moves it back to draft with a note.
export function ReviewPanel({ artifact: a, sessionId }: { artifact: Artifact; sessionId: string }) {
  const state = useStore((s) => s.state);
  const me = useStore((s) => s.me)!;
  const myId = me.user!.id;
  const review = state.reviews[a.id];
  const status = review?.status ?? "draft";
  const people = Object.values(state.participants).filter((p) => p.role !== "viewer");
  const [picked, setPicked] = useState<string[]>(() => people.filter((p) => p.userId !== myId).map((p) => p.userId));
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const canAct = state.participants[myId]?.role !== "viewer";

  async function run(path: string, body?: unknown) {
    setBusy(true);
    setErr(null);
    try {
      await api("POST", `/api/v1/sessions/${sessionId}/review/${a.id}/${path}`, body);
      setChoosing(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const signed = review ? Object.keys(review.signoffs).length : 0;
  const needed = review?.reviewers.length ?? 0;
  const decision = review?.decisionId ? state.decisions[review.decisionId] : undefined;

  return (
    <div className="review">
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <span className={"chip status-" + status} title={status === "approved" ? `Approved at v${review?.approvedVersionNo}` : status === "in_review" ? `${signed} of ${needed} signed` : "Not yet reviewed"}>
          {status === "in_review" ? `in review · ${signed} of ${needed} signed` : status === "approved" ? `approved v${review?.approvedVersionNo}${decision ? ` · ${decision.label}` : ""}` : "draft"}
        </span>
        {status === "approved" && review && (
          <span className="muted" style={{ fontSize: 12 }}>signed off by {review.reviewers.map((u) => participantName(state, u)).join(", ")}</span>
        )}
        {status === "in_review" && review && (
          <span className="muted" style={{ fontSize: 12 }}>
            {review.reviewers.map((u) => (
              <span key={u} style={{ marginRight: 8, color: review.signoffs[u] ? "var(--ok)" : undefined }}>{review.signoffs[u] ? "✓" : "○"} {participantName(state, u)}</span>
            ))}
          </span>
        )}
        <span className="grow" />
        {canAct && status !== "in_review" && !choosing && (
          <button style={{ fontSize: 11 }} onClick={() => setChoosing(true)} title="Name who has to sign off; the last signature approves the document and records a decision">Request review</button>
        )}
        {canAct && status === "in_review" && review && review.reviewers.includes(myId) && !review.signoffs[myId] && (
          <button className="primary" style={{ fontSize: 11 }} disabled={busy} onClick={() => run("sign")} title={`Sign off v${a.current.versionNo} as written`}>Sign off</button>
        )}
        {canAct && status === "in_review" && review && (review.requestedBy === myId || state.participants[myId]?.role === "owner") && (
          <button style={{ fontSize: 11 }} disabled={busy} onClick={() => run("withdraw", { reason: "withdrawn by " + participantName(state, myId) })} title="Take the document out of review; signatures so far are dropped">Withdraw</button>
        )}
      </div>
      {choosing && (
        <div className="stack" style={{ marginTop: 6, gap: 4 }}>
          <div className="mono" style={{ fontSize: 11 }}>who has to sign v{a.current.versionNo}</div>
          {people.map((p) => (
            <label key={p.userId} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
              <input type="checkbox" checked={picked.includes(p.userId)} onChange={(e) => setPicked(e.target.checked ? [...picked, p.userId] : picked.filter((u) => u !== p.userId))} />
              <span style={{ color: p.color }}>{p.name}</span>
              <span className="mono muted">{p.role}</span>
            </label>
          ))}
          <div className="row">
            <button className="primary" style={{ fontSize: 11 }} disabled={busy || picked.length === 0} onClick={() => run("request", { reviewers: picked })}>Send for review</button>
            <button style={{ fontSize: 11 }} onClick={() => setChoosing(false)}>cancel</button>
          </div>
        </div>
      )}
      {review && review.changedSince.length > 0 && status === "draft" && (
        <div className="consent" style={{ marginTop: 6, fontSize: 12 }}>
          Back to draft after v{review.approvedVersionNo ?? review.requestedVersionNo} was {review.history.length ? "approved" : "sent for review"}:{" "}
          {review.changedSince.map((c) => `${c.title} changed (v${c.versionNo}, ${c.byUserId ? participantName(state, c.byUserId) : "system"})`).join("; ")}.
        </div>
      )}
      {review && review.history.length > 0 && status !== "approved" && (
        <div className="muted" style={{ marginTop: 4, fontSize: 11 }}>
          previously approved: {review.history.map((h) => `v${h.versionNo} by ${h.signers.map((u) => participantName(state, u)).join(", ")}`).join("; ")}
        </div>
      )}
      {err && <div className="err" style={{ fontSize: 12, marginTop: 4 }}>{err}</div>}
    </div>
  );
}
