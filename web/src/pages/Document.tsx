import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../api";
import { navigate } from "../App";
import { TopBar } from "../components/TopBar";
import { mdComponents, withoutComments } from "./Published";

interface DocResponse {
  sessionId: string;
  sessionTitle: string;
  demo: boolean;
  artifact: { id: string; title: string; type: string; versionNo: number; authorName: string; createdAt: string; markdown: string };
  versions: { versionNo: number; authorName: string; createdAt: string }[];
  review: { status: "draft" | "in_review" | "approved"; approvedVersionNo?: number; signerNames: string[]; decisionLabel?: string } | null;
  published: { slug: string } | null;
}

// A design document as a page inside the app, for anyone who can open the session: contents,
// versions, status, print. The published page is the same thing for people outside.
export function Document({ sessionId, artifactId }: { sessionId: string; artifactId: string }) {
  const [doc, setDoc] = useState<DocResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [v, setV] = useState<number | undefined>(undefined);
  const [toc, setToc] = useState<{ id: string; text: string; level: number }[]>([]);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<DocResponse>("GET", `/api/v1/sessions/${sessionId}/artifacts/${artifactId}${v ? `?v=${v}` : ""}`).then(setDoc).catch((e) => setErr((e as Error).message));
  }, [sessionId, artifactId, v]);

  useEffect(() => {
    if (!doc) return;
    document.title = `${doc.artifact.title} · ${doc.sessionTitle}`;
    const hs = bodyRef.current?.querySelectorAll("h2, h3") ?? [];
    setToc([...hs].map((h) => ({ id: h.id, text: h.textContent ?? "", level: h.tagName === "H2" ? 2 : 3 })).filter((h) => h.id));
  }, [doc]);

  if (err) return <><TopBar /><div className="page err">{err}</div></>;
  if (!doc) return <div className="page muted">Loading…</div>;
  const latest = doc.versions[doc.versions.length - 1]!;
  const isLatest = doc.artifact.versionNo === latest.versionNo;
  const r = doc.review;
  const approvedHere = r?.status === "approved" && r.approvedVersionNo === doc.artifact.versionNo;
  return (
    <>
      <TopBar>
        <a className="mono" href={`/s/${sessionId}`} onClick={(e) => { e.preventDefault(); navigate(`/s/${sessionId}`); }} title="Back to the session">{doc.sessionTitle}</a>
        {doc.demo && <span className="chip" style={{ color: "var(--accent)" }}>demo</span>}
      </TopBar>
      <div className="pub-layout">
        <aside className="pub-side">
          <div className="mono" style={{ marginBottom: 6 }}>version</div>
          <select value={doc.artifact.versionNo} onChange={(e) => setV(Number(e.target.value))} style={{ width: "100%" }}>
            {[...doc.versions].reverse().map((x) => (
              <option key={x.versionNo} value={x.versionNo}>v{x.versionNo} · {x.authorName} · {new Date(x.createdAt).toLocaleDateString()}{r?.status === "approved" && r.approvedVersionNo === x.versionNo ? " · approved" : ""}</option>
            ))}
          </select>
          <div className="mono" style={{ margin: "8px 0 14px", lineHeight: 1.5 }}>
            {approvedHere ? `approved${r?.decisionLabel ? ` · ${r.decisionLabel}` : ""}` : r?.status === "in_review" ? "in review" : "draft"}
            {approvedHere && r && r.signerNames.length > 0 && <><br />signed off by {r.signerNames.join(", ")}</>}
            <br />by {doc.artifact.authorName}, {new Date(doc.artifact.createdAt).toLocaleDateString()}
            {!isLatest && <><br /><a href="#" onClick={(e) => { e.preventDefault(); setV(undefined); }}>latest is v{latest.versionNo}</a></>}
          </div>
          {toc.length > 0 && (
            <nav className="pub-toc">
              <div className="mono" style={{ marginBottom: 4 }}>contents</div>
              {toc.map((h) => <a key={h.id} href={`#${h.id}`} className={h.level === 3 ? "sub" : ""}>{h.text}</a>)}
            </nav>
          )}
          <div className="pub-actions">
            <button className="icon" onClick={() => window.print()} title="Print, or save as PDF">print</button>
            <button className="icon" onClick={() => navigate(`/s/${sessionId}`)} title="Open the session this document belongs to">session</button>
            {doc.published && <a className="mono" href={`/p/${doc.published.slug}`} onClick={(e) => { e.preventDefault(); navigate(`/p/${doc.published!.slug}`); }} title="The public page of this document">public page</a>}
          </div>
        </aside>
        <div className="page published">
          <div className="pub-head">
            <div className="mono">{doc.sessionTitle}</div>
            <h1 style={{ fontSize: 30, marginTop: 4 }}>{doc.artifact.title}</h1>
          </div>
          <div className="md pub-body" ref={bodyRef}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{withoutComments(doc.artifact.markdown)}</ReactMarkdown>
          </div>
          <div className="pub-foot mono">
            {doc.demo ? "From the built-in demo session. Open it to see how the document was assembled." : "The document as it stands in the session; the session may have moved on since this version."}
          </div>
        </div>
      </div>
    </>
  );
}
