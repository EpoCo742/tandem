import { useEffect, useRef, useState } from "react";
import { api } from "../api";

// One small menu for the things an owner does to a session as a whole: rename it, close it
// (archive: read only, out of everyone's digest) or reopen it, and delete it outright. Non-owners
// see the menu too, with an explanation of who can act, so nobody wonders where the buttons went.
// Everything confirms inline; no browser dialogs.
export function SessionMenu({ sessionId, title, status, isOwner, onChange, onDeleted }: { sessionId: string; title: string; status: "active" | "archived"; isOwner: boolean; onChange?: () => void; onDeleted?: () => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"menu" | "rename" | "delete">("menu");
  const [draft, setDraft] = useState(title);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function close() {
    setOpen(false);
    setMode("menu");
    setErr(null);
  }

  async function run(fn: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      close();
      after?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const rename = () => run(() => api("PATCH", `/api/v1/sessions/${sessionId}`, { title: draft.trim() }), onChange);
  const archive = (archived: boolean) => run(() => api("POST", `/api/v1/sessions/${sessionId}/archive`, { archived }), onChange);
  const remove = () => run(() => api("DELETE", `/api/v1/sessions/${sessionId}`), onDeleted);

  return (
    <div className="session-menu" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button className="icon" title="Session: rename, archive, delete" aria-label="Session menu" aria-expanded={open} onClick={() => { setDraft(title); setMode("menu"); setOpen((o) => !o); }}>⋯</button>
      {open && (
        <div className="pop" role="menu">
          {!isOwner && <div className="muted" style={{ padding: "4px 8px", fontSize: 12.5 }}>Only the session owner can rename, archive or delete it.</div>}
          {isOwner && mode === "menu" && (
            <>
              <button role="menuitem" onClick={() => setMode("rename")}>Rename…</button>
              {status === "archived" ? (
                <button role="menuitem" disabled={busy} onClick={() => archive(false)} title="Back to normal: people can post, vote and change cards again">Reopen</button>
              ) : (
                <button role="menuitem" disabled={busy} onClick={() => archive(true)} title="Read only for everyone and out of the digest; nothing is lost">Archive</button>
              )}
              <button role="menuitem" className="danger" onClick={() => setMode("delete")}>Delete…</button>
            </>
          )}
          {isOwner && mode === "rename" && (
            <div className="confirm">
              <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) void rename(); }} placeholder="Session title" maxLength={120} />
              <div className="row">
                <button className="primary" disabled={busy || !draft.trim() || draft.trim() === title} onClick={rename}>Save</button>
                <button onClick={() => setMode("menu")}>Cancel</button>
              </div>
            </div>
          )}
          {isOwner && mode === "delete" && (
            <div className="confirm">
              <div>Delete <b>{title}</b> for everyone? The conversation, cards, decisions, uploads and history all go, and cannot be recovered. Forks made from it are kept.</div>
              <div className="row">
                <button className="danger" disabled={busy} onClick={remove}>Delete session</button>
                <button onClick={() => setMode("menu")}>Keep it</button>
              </div>
            </div>
          )}
          {err && <div className="err" style={{ padding: "2px 8px", fontSize: 12.5 }}>{err}</div>}
        </div>
      )}
    </div>
  );
}
