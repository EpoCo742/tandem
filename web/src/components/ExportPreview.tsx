import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { api } from "../api";
import { Mermaid } from "./Mermaid";

const mdComponents: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  code({ className, children }) {
    const text = String(children).replace(/\n$/, "");
    if (className === "language-mermaid") return <Mermaid source={text} />;
    return <code className={className}>{children}</code>;
  },
};

// Preview of the Markdown export before it leaves the app: rendered or raw, copy, download.
export function ExportPreview({ sessionId, title, onClose }: { sessionId: string; title: string; onClose: () => void }) {
  const [md, setMd] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [raw, setRaw] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api<string>("GET", `/api/v1/sessions/${sessionId}/export`).then(setMd).catch((e) => setErr((e as Error).message));
  }, [sessionId]);

  function download() {
    if (md === null) return;
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url;
    el.download = `${title.replace(/[^\w-]+/g, "-") || "session"}.md`;
    el.click();
    URL.revokeObjectURL(url);
  }

  async function copy() {
    if (md === null) return;
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setErr("Clipboard is blocked in this browser; use download instead.");
    }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <b style={{ flex: 1 }}>Export preview: {title}</b>
          {md !== null && <span className="mono">{md.length.toLocaleString()} chars</span>}
          <button onClick={() => setRaw((r) => !r)}>{raw ? "rendered" : "raw markdown"}</button>
          <button onClick={copy} disabled={md === null}>{copied ? "copied" : "copy"}</button>
          <button className="primary" onClick={download} disabled={md === null}>download .md</button>
          <button onClick={onClose}>close</button>
        </div>
        {err && <div className="err">{err}</div>}
        <div className={"modal-body" + (raw ? "" : " md-doc")}>
          {md === null && !err && <div className="muted">Building the export…</div>}
          {md !== null && (raw ? <pre className="raw">{md}</pre> : <ReactMarkdown components={mdComponents}>{md}</ReactMarkdown>)}
        </div>
      </div>
    </div>
  );
}
