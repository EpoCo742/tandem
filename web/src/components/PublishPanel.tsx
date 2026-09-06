import { useState } from "react";
import { participantName, type Artifact } from "@tandem/shared";
import { api } from "../api";
import { useStore } from "../state/store";

// Publishing gives the design document a public page with every version kept. The owner
// publishes; approvals publish a new version on their own once the document is out there.
export function PublishPanel({ artifact: a, sessionId }: { artifact: Artifact; sessionId: string }) {
  const state = useStore((s) => s.state);
  const meta = useStore((s) => s.meta);
  const me = useStore((s) => s.me)!;
  const myId = me.user!.id;
  const pub = state.publications[a.id];
  const isOwner = meta?.me.role === "owner";
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const last = pub?.versions[pub.versions.length - 1];
  const live = pub?.status === "live" && last;
  const url = pub ? `${location.origin}/p/${pub.slug}` : "";
  const behind = live && a.current.versionNo > last.docVersionNo;
  const review = state.reviews[a.id];
  const approvedNow = review?.status === "approved" && review.approvedVersionNo === a.current.versionNo;

  async function run(path: string, body?: unknown) {
    setBusy(true);
    setErr(null);
    try {
      await api("POST", `/api/v1/sessions/${sessionId}/publish/${a.id}${path}`, body);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked; the link is selectable */
    }
  }

  return (
    <div className="publish">
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        {live ? (
          <>
            <span className="chip status-approved" title={`Version ${last.publicationVersionNo} of the public page is document v${last.docVersionNo}${last.approved ? `, approved as ${last.approved.decisionLabel}` : ", not signed off"}`}>published · v{last.docVersionNo}{last.approved ? " · approved" : ""}</span>
            <a className="mono" href={url} target="_blank" rel="noreferrer" style={{ userSelect: "all" }}>{url.replace(/^https?:\/\//, "")}</a>
            <button className="icon" onClick={copy} title="Copy the public link">{copied ? "copied" : "copy"}</button>
            {behind && <span className="muted" style={{ fontSize: 12 }}>v{a.current.versionNo} is newer than the page</span>}
          </>
        ) : pub?.status === "revoked" ? (
          <span className="chip status-draft" title="The page is down; publishing again brings it back at the same address">unpublished</span>
        ) : (
          <span className="muted" style={{ fontSize: 12 }}>not published</span>
        )}
        <span className="grow" />
        {isOwner && (!live || behind) && (
          <button className={approvedNow || !live ? "primary" : ""} style={{ fontSize: 11 }} disabled={busy} onClick={() => run("")} title={live ? `Publish v${a.current.versionNo} as a new version of the public page` : approvedNow ? "Put the approved document on a public page" : "Publish now; the page will say it is not signed off"}>
            {live ? `Publish v${a.current.versionNo}` : pub ? "Publish again" : "Publish"}
          </button>
        )}
        {isOwner && live && (
          <button style={{ fontSize: 11 }} disabled={busy} onClick={() => run("/revoke")} title="Take the page down; every version stays here and publishing again restores the same link">Unpublish</button>
        )}
      </div>
      {live && pub.versions.length > 1 && (
        <div className="muted" style={{ marginTop: 4, fontSize: 11 }}>
          {pub.versions.length} versions on the page; latest by {last.byUserId ? participantName(state, last.byUserId) : "approval"} {new Date(last.at).toLocaleString()}
        </div>
      )}
      {err && <div className="err" style={{ fontSize: 12, marginTop: 4 }}>{err}</div>}
    </div>
  );
}
