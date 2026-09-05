import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../api";
import { Mermaid } from "./Mermaid";

const mdComponents: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  code({ className, children }) {
    const text = String(children).replace(/\n$/, "");
    if (className === "language-mermaid") return <Mermaid source={text} />;
    return <code className={className}>{children}</code>;
  },
};

// Provenance travels in HTML comments; real Markdown renderers hide them, this one would print them.
const withoutComments = (md: string) => md.replace(/<!--[\s\S]*?-->\n?/g, "");

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

  // Print through a hidden frame so no popup blocker gets in the way; the browser's print
  // dialog offers "Save as PDF". Diagrams are already rendered SVG in the preview DOM.
  function print() {
    const body = document.querySelector(".modal.wide .modal-body");
    if (!body) return;
    const frame = document.createElement("iframe");
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";
    document.body.appendChild(frame);
    const doc = frame.contentDocument!;
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/</g, "&lt;")}</title><style>
      body { font-family: "IBM Plex Sans", "Segoe UI", Roboto, sans-serif; font-size: 12pt; line-height: 1.45; color: #1a2128; margin: 24mm 18mm; }
      h1 { font-size: 22pt; margin: 0 0 8pt; } h2 { font-size: 16pt; margin: 18pt 0 6pt; page-break-after: avoid; } h3 { font-size: 13pt; margin: 14pt 0 4pt; page-break-after: avoid; }
      pre { background: #f5f7f9; padding: 8pt; font-size: 9.5pt; white-space: pre-wrap; word-break: break-word; }
      code { font-family: "IBM Plex Mono", Consolas, monospace; font-size: 10pt; }
      table { border-collapse: collapse; margin: 6pt 0; page-break-inside: avoid; } td, th { border: 1px solid #d3dae0; padding: 3pt 6pt; text-align: left; font-size: 10.5pt; }
      .mermaid-box { page-break-inside: avoid; margin: 8pt 0; } svg { max-width: 100%; height: auto; }
      em { color: #4a5561; }
      @page { size: A4; margin: 0; }
    </style></head><body>${raw ? `<pre>${body.textContent!.replace(/</g, "&lt;")}</pre>` : body.innerHTML}</body></html>`);
    doc.close();
    const win = frame.contentWindow!;
    const go = () => {
      win.focus();
      win.print();
      setTimeout(() => frame.remove(), 1000);
    };
    // Give fonts and SVG a moment to lay out.
    setTimeout(go, 400);
  }

  // Minimal ZIP writer (no compression): enough for a handful of Markdown files.
  function zip(files: { name: string; data: Uint8Array }[]): Blob {
    const enc = new TextEncoder();
    const table = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    const crc = (d: Uint8Array) => { let c = 0xffffffff; for (const b of d) c = table[(c ^ b) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const parts: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;
    const le = (n: number, bytes: number) => { const a = new Uint8Array(bytes); for (let i = 0; i < bytes; i++) a[i] = (n >>> (8 * i)) & 0xff; return a; };
    const cat = (...xs: Uint8Array[]) => { const out = new Uint8Array(xs.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of xs) { out.set(x, p); p += x.length; } return out; };
    for (const f of files) {
      const name = enc.encode(f.name);
      const c = crc(f.data);
      const local = cat(le(0x04034b50, 4), le(20, 2), le(0x0800, 2), le(0, 2), le(0, 2), le(0x21, 2), le(c, 4), le(f.data.length, 4), le(f.data.length, 4), le(name.length, 2), le(0, 2), name, f.data);
      central.push(cat(le(0x02014b50, 4), le(20, 2), le(20, 2), le(0x0800, 2), le(0, 2), le(0, 2), le(0x21, 2), le(c, 4), le(f.data.length, 4), le(f.data.length, 4), le(name.length, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 4), le(offset, 4), name));
      parts.push(local);
      offset += local.length;
    }
    const cd = cat(...central);
    const end = cat(le(0x06054b50, 4), le(0, 2), le(0, 2), le(files.length, 2), le(files.length, 2), le(cd.length, 4), le(offset, 4), le(0, 2));
    return new Blob([cat(...parts), cd, end], { type: "application/zip" });
  }

  async function downloadAdrs() {
    const r = await api<{ files: { filename: string; markdown: string }[] }>("GET", `/api/v1/sessions/${sessionId}/adrs`);
    if (!r.files.length) { setErr("No decisions recorded yet, so there are no records to download."); return; }
    const enc = new TextEncoder();
    const blob = zip(r.files.map((f) => ({ name: `docs/adr/${f.filename}`, data: enc.encode(f.markdown) })));
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url;
    el.download = `${title.replace(/[^\w-]+/g, "-") || "session"}-adrs.zip`;
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
          <button onClick={() => setRaw((r) => !r)} title="The raw file keeps provenance as HTML comments; the rendered view hides them, as GitHub does">{raw ? "rendered" : "raw markdown"}</button>
          <button onClick={copy} disabled={md === null}>{copied ? "copied" : "copy"}</button>
          <button onClick={print} disabled={md === null} title="Print, or save as PDF from the print dialog">print / PDF</button>
          <button className="primary" onClick={download} disabled={md === null}>download .md</button>
          <button onClick={downloadAdrs} disabled={md === null} title="One Markdown file per decision, laid out as docs/adr/NNNN-title.md">download ADRs (.zip)</button>
          <button onClick={onClose}>close</button>
        </div>
        {err && <div className="err">{err}</div>}
        <div className={"modal-body" + (raw ? "" : " md-doc")}>
          {md === null && !err && <div className="muted">Building the export…</div>}
          {md !== null && (raw ? <pre className="raw">{md}</pre> : <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{withoutComments(md)}</ReactMarkdown>)}
        </div>
      </div>
    </div>
  );
}
