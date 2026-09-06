import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../api";
import { navigate } from "../App";
import { TopBar } from "../components/TopBar";
import { Mermaid } from "../components/Mermaid";
import { useStore } from "../state/store";

const mdComponents: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  code({ className, children }) {
    const text = String(children).replace(/\n$/, "");
    if (className === "language-mermaid") return <Mermaid source={text} />;
    return <code className={className}>{children}</code>;
  },
};
const withoutComments = (md: string) => md.replace(/<!--[\s\S]*?-->\n?/g, "");

interface Approval { decisionLabel: string; signers: string[]; signerNames: string[] }
interface VersionRow { no: number; docVersionNo: number; publishedAt: string; publishedBy: string; note: string | null; approval: Approval | null }
interface PublishedDoc { slug: string; title: string; sessionTitle: string; versions: VersionRow[]; version: VersionRow & { markdown: string } }

// A published design document: one stable URL, every version kept, each one saying who signed
// it. No sign-in needed; anyone with the link can read it and fetch the Markdown.
export function Published({ slug }: { slug: string }) {
  const me = useStore((s) => s.me);
  const [doc, setDoc] = useState<PublishedDoc | null>(null);
  const [err, setErr] = useState<{ status: number; message: string } | null>(null);
  const [v, setV] = useState<number | undefined>(undefined);

  useEffect(() => {
    setErr(null);
    api<PublishedDoc>("GET", `/api/v1/public/${slug}${v ? `?v=${v}` : ""}`)
      .then(setDoc)
      .catch((e) => setErr({ status: /410/.test((e as Error).message) ? 410 : 404, message: (e as Error).message }));
  }, [slug, v]);

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
            <span className="grow" />
            <label className="row" style={{ gap: 6, fontSize: 13 }}>
              <span className="mono">version</span>
              <select value={doc.version.no} onChange={(e) => setV(Number(e.target.value))} style={{ width: "auto" }}>
                {[...doc.versions].reverse().map((x) => (
                  <option key={x.no} value={x.no}>{x.no} · doc v{x.docVersionNo} · {new Date(x.publishedAt).toLocaleDateString()}{x.approval ? " · approved" : ""}</option>
                ))}
              </select>
            </label>
            <a className="mono" href={`/p/${slug}.md${isLatest ? "" : `?v=${doc.version.no}`}`} target="_blank" rel="noreferrer" title="The Markdown of this version">.md</a>
          </div>
          <div className="mono" style={{ marginTop: 8 }}>
            version {doc.version.no} of {latest.no} · published {new Date(doc.version.publishedAt).toLocaleString()} by {doc.version.publishedBy}
            {doc.version.note ? ` · ${doc.version.note}` : ""}
            {!isLatest && <> · <a href="#" onClick={(e) => { e.preventDefault(); setV(undefined); }}>latest is version {latest.no}</a></>}
          </div>
        </div>
        <div className="md pub-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{withoutComments(doc.version.markdown)}</ReactMarkdown>
        </div>
        <div className="pub-foot mono">
          Published from Tandem. Each version is a frozen copy; the session it came from may have moved on.
          {me?.user && <> · <a href="/library" onClick={(e) => { e.preventDefault(); navigate("/library"); }}>library</a></>}
        </div>
      </div>
    </>
  );
}
