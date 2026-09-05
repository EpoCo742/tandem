import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { contentText, type Artifact } from "@tandem/shared";
import { api } from "../api";
import { setEditingArtifact } from "../collab";

// Direct human edit. Goes through the same governance path as AI changes:
// your own artifact applies at once; someone else's becomes a proposal for them.

export function ArtifactEditor({ artifact: a, sessionId, onClose }: { artifact: Artifact; sessionId: string; onClose: () => void }) {
  const [text, setText] = useState(contentText(a.type, a.current.content));
  const [title, setTitle] = useState(a.title);
  const [rationale, setRationale] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Announce the open editor to the other participants for as long as it is open.
  useEffect(() => {
    setEditingArtifact(a.id);
    return () => setEditingArtifact(null);
  }, [a.id]);

  async function save() {
    setBusy(true);
    setResult(null);
    const base = a.current.content as Record<string, unknown>;
    let content: unknown;
    if (a.type === "mermaid") content = { ...base, source: text };
    else if (a.type === "code") content = { ...base, source: text };
    else if (a.type === "data_model") {
      try {
        content = { ...base, ...JSON.parse(text) };
      } catch (e) {
        setResult("Invalid JSON: " + (e as Error).message);
        setBusy(false);
        return;
      }
    } else content = { ...base, markdown: text };
    try {
      const r = await api<{ status: string; versionNo?: number; approvers?: string[]; message?: string }>("POST", `/api/v1/sessions/${sessionId}/artifacts/${a.id}/versions`, { content, title, rationale: rationale || "Direct edit" });
      if (r.status === "applied") { setResult(`Applied as v${r.versionNo}.`); setTimeout(onClose, 600); }
      else if (r.status === "pending_approval") { setResult("Sent as a proposal; the artifact's owner must approve it (auto-applies after the timeout)."); setTimeout(onClose, 1500); }
      else if (r.status === "stale") setResult(r.message ?? "Stale");
      else setResult(r.status);
    } catch (e) {
      setResult((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="modal-bg nodrag nowheel" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>Edit {a.type} · v{a.current.versionNo}</h3>
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        <input placeholder="Why? (one line, shown to the other participants and the AI)" value={rationale} onChange={(e) => setRationale(e.target.value)} />
        <div className="row">
          <button className="primary" onClick={save} disabled={busy}>Save version</button>
          <button onClick={onClose}>Cancel</button>
          {result && <span className="muted">{result}</span>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
