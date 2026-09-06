import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../api";
import { navigate } from "../App";
import { TopBar } from "../components/TopBar";
import { Mermaid } from "../components/Mermaid";
import { useStore } from "../state/store";

// Diagrams enlarge on click; the enlarged copy renders the same source at full width.
function ZoomableDiagram({ source }: { source: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="pub-diagram" onClick={() => setOpen(true)} title="Click to enlarge">
        <Mermaid source={source} />
      </div>
      {open && createPortal(
        <div className="modal-bg" onClick={() => setOpen(false)}>
          <div className="modal wide diagram-full" onClick={(e) => e.stopPropagation()}>
            <div className="row"><span className="grow" /><button onClick={() => setOpen(false)}>close</button></div>
            <Mermaid source={source} />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const textOf = (children: React.ReactNode): string => (Array.isArray(children) ? children.map(textOf).join("") : typeof children === "string" || typeof children === "number" ? String(children) : children && typeof children === "object" && "props" in children ? textOf((children as { props: { children?: React.ReactNode } }).props.children) : "");

const mdComponents: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  code({ className, children }) {
    const text = String(children).replace(/\n$/, "");
    if (className === "language-mermaid") return <ZoomableDiagram source={text} />;
    return <code className={className}>{children}</code>;
  },
  h1: ({ children }) => <h1 id={slug(textOf(children))}>{children}</h1>,
  h2: ({ children }) => <h2 id={slug(textOf(children))}>{children}</h2>,
  h3: ({ children }) => <h3 id={slug(textOf(children))}>{children}</h3>,
};
const withoutComments = (md: string) => md.replace(/<!--[\s\S]*?-->\n?/g, "");

interface Approval { decisionLabel: string; signers: string[]; signerNames: string[] }
interface VersionRow { no: number; docVersionNo: number; publishedAt: string; publishedBy: string; note: string | null; approval: Approval | null }
interface PublishedDoc { slug: string; title: string; sessionTitle: string; versions: VersionRow[]; version: VersionRow & { markdown: string } }

// A published design document: one stable URL, every version kept, each one saying who signed
// it. No sign-in needed; anyone with the link can read it, print it and fetch the Markdown.
export function Published({ slug: pageSlug }: { slug: string }) {
  const me = useStore((s) => s.me);
  const [doc, setDoc] = useState<PublishedDoc | null>(null);
  const [err, setErr] = useState<{ status: number; message: string } | null>(null);
  const [v, setV] = useState<number | undefined>(undefined);
  const [toc, setToc] = useState<{ id: string; text: string; level: number }[]>([]);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setErr(null);
    api<PublishedDoc>("GET", `/api/v1/public/${pageSlug}${v ? `?v=${v}` : ""}`)
      .then(setDoc)
      .catch((e) => setErr({ status: /410/.test((e as Error).message) ? 410 : 404, message: (e as Error).message }));
  }, [pageSlug, v]);

  useEffect(() => {
    if (!doc) return;
    document.title = `${doc.title} · Tandem`;
    const hs = bodyRef.current?.querySelectorAll("h2, h3") ?? [];
    setToc([...hs].map((h) => ({ id: h.id, text: h.textContent ?? "", level: h.tagName === "H2" ? 2 : 3 })).filter((h) => h.id));
  }, [doc]);

  if (err) {
    return (
      <>
        <TopBar />
        <div className="page">
          <h2 style={{ fontSize: 22 }}>{err.status === 410 ? "No longer published" : "Not found"}</h2>
          <p className="muted">{err.status === 410 ? "The owner took this document down. Ask them for a fresh link if it comes back." : "There is no published document at this address."}</p>
        </div>
      </>
    );
  }
  if (!doc) return <div className="page muted">Loading…</div>;
  const a = doc.version.approval;
  const latest = doc.versions[doc.versions.length - 1]!;
  const isLatest = doc.version.no === latest.no;
  return (
    <>
      <TopBar>
        <span className="mono">published</span>
      </TopBar>
      <div className="pub-layout">
        <aside className="pub-side">
          <div className="mono" style={{ marginBottom: 6 }}>version</div>
          <select value={doc.version.no} onChange={(e) => setV(Number(e.target.value))} style={{ width: "100%" }}>
            {[...doc.versions].reverse().map((x) => (
              <option key={x.no} value={x.no}>{x.no} · doc v{x.docVersionNo} · {new Date(x.publishedAt).toLocaleDateString()}{x.approval ? " · approved" : ""}</option>
            ))}
          </select>
          <div className="mono" style={{ margin: "8px 0 14px", lineHeight: 1.5 }}>
            {a ? `approved · ${a.decisionLabel}` : "not signed off"}
            {a && <><br />signed off by {a.signerNames.join(", ")}</>}
            <br />published {new Date(doc.version.publishedAt).toLocaleDateString()} by {doc.version.publishedBy}
            {!isLatest && <><br /><a href="#" onClick={(e) => { e.preventDefault(); setV(undefined); }}>latest is version {latest.no}</a></>}
          </div>
          {toc.length > 0 && (
            <nav className="pub-toc">
              <div className="mono" style={{ marginBottom: 4 }}>contents</div>
              {toc.map((h) => <a key={h.id} href={`#${h.id}`} className={h.level === 3 ? "sub" : ""}>{h.text}</a>)}
            </nav>
          )}
          <div className="pub-actions">
            <a className="mono" href={`/p/${pageSlug}.md${isLatest ? "" : `?v=${doc.version.no}`}`} target="_blank" rel="noreferrer" title="The Markdown of this version">.md</a>
            <button className="icon" onClick={() => window.print()} title="Print, or save as PDF">print</button>
          </div>
        </aside>
        <div className="page published">
          <div className="pub-head">
            <div className="mono">{doc.sessionTitle}</div>
            <h1 style={{ fontSize: 30, marginTop: 4 }}>{doc.title}</h1>
            <div className="row" style={{ flexWrap: "wrap", gap: 8, marginTop: 10 }}>
              {a ? (
                <span className="chip status-approved" title={`Recorded as ${a.decisionLabel}`}>approved · {a.decisionLabel}</span>
              ) : (
                <span className="chip status-draft" title="This version was published without a completed review">not signed off</span>
              )}
              {a && <span className="muted" style={{ fontSize: 13 }}>signed off by {a.signerNames.join(", ")}</span>}
              <span className="mono">version {doc.version.no} of {latest.no}{doc.version.note ? ` · ${doc.version.note}` : ""}</span>
            </div>
          </div>
          <div className="md pub-body" ref={bodyRef}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{withoutComments(doc.version.markdown)}</ReactMarkdown>
          </div>
          <div className="pub-foot mono">
            Published from Tandem. Each version is a frozen copy; the session it came from may have moved on.
            {me?.user && <> · <a href="/library" onClick={(e) => { e.preventDefault(); navigate("/library"); }}>library</a></>}
          </div>
        </div>
      </div>
    </>
  );
}
