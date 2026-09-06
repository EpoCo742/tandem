import { useEffect, useState } from "react";
import { api, type CredentialView } from "../api";
import { navigate } from "../App";
import { TopBar } from "../components/TopBar";
import { useStore } from "../state/store";
import { SessionMenu } from "../components/SessionMenu";
import { TEMPLATES, TEMPLATE_IDS, type TemplateId } from "@tandem/shared";

interface SessionRow { id: string; title: string; status: "active" | "archived"; template: string | null; thumbnail: string | null; role: string; policy: string; payerMode: string; pinnedModel: string; provider: string; createdAt: string; updatedAt: string }
interface DigestSession {
  sessionId: string;
  title: string;
  lastSeenSeq: number;
  lastSeq: number;
  waiting: {
    decisionPoints: { artifactId: string; question: string; deadline: string | null; options: { id: string; title: string }[]; votes: number; voters: number }[];
    proposals: { id: string; title: string; op: string; proposer: string; autoApplyAt: string | null }[];
    externalCalls: { id: string; summary: string; onBehalfOf: string }[];
    signoffs: { artifactId: string; title: string; versionNo: number; requestedBy: string; signed: number; needed: number }[];
    revisits: { kind: "assumption" | "decision"; id: string; label: string; statement: string; revisitAt: string }[];
  };
  since: { messages: number; aiReplies: number; decisions: string[]; artifacts: string[]; mentions: { eventId: string; from: string; text: string }[] };
  lastActivityAt: string;
}

export function Home() {
  const me = useStore((s) => s.me);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [digest, setDigest] = useState<DigestSession[]>([]);
  const [creds, setCreds] = useState<{ credentials: CredentialView[]; providers: string[]; defaultProvider: string; defaultModel: string } | null>(null);
  const [title, setTitle] = useState("");
  const [provider, setProvider] = useState("");
  const [payerMode, setPayerMode] = useState<"sponsor" | "speaker">("sponsor");
  const [model, setModel] = useState("");
  const [template, setTemplate] = useState<TemplateId | "">("");
  const [err, setErr] = useState<string | null>(null);

  function reload() {
    api<SessionRow[]>("GET", "/api/v1/sessions").then(setSessions);
    api<{ sessions: DigestSession[] }>("GET", "/api/v1/digest").then((r) => setDigest(r.sessions)).catch(() => undefined);
  }
  const active = sessions.filter((s) => s.status !== "archived");
  const archived = sessions.filter((s) => s.status === "archived");

  useEffect(() => {
    reload();
    api<typeof creds>("GET", "/api/v1/credentials").then((c) => {
      setCreds(c);
      setProvider(c!.defaultProvider);
      setModel(c!.defaultModel);
    });
  }, []);

  const providerCred = creds?.credentials.find((c) => c.provider === provider && c.status === "active");
  const models = providerCred?.models ?? [];

  async function create() {
    setErr(null);
    try {
      const { id } = await api<{ id: string }>("POST", "/api/v1/sessions", { title: title || "Untitled session", provider, payerMode, pinnedModel: model || undefined, policy: "hybrid", ...(template ? { template } : {}) });
      navigate(`/s/${id}`);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <>
      <TopBar />
      <div className="page">
        <h2 style={{ fontSize: 26, marginBottom: 12 }}>New session</h2>
        <div className="card stack">
          <input placeholder="Title, e.g. Order platform v1" value={title} onChange={(e) => setTitle(e.target.value)} />
          <label>
            <div className="mono">kind of design</div>
            <select value={template} onChange={(e) => setTemplate(e.target.value as TemplateId | "")}>
              <option value="">blank (no checklist)</option>
              {TEMPLATE_IDS.map((id) => <option key={id} value={id}>{TEMPLATES[id].name}</option>)}
            </select>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              {template ? `${TEMPLATES[template].summary} Starts with ${TEMPLATES[template].seedConstraints.length} default constraints and a ${TEMPLATES[template].checklist.length}-item checklist the AI works toward.` : "A template seeds the constraints card and gives the session a checklist of what a whole design of that kind needs."}
            </div>
          </label>
          <div className="row">
            <label style={{ flex: 1 }}>
              <div className="mono">provider</div>
              <select value={provider} onChange={(e) => { setProvider(e.target.value); setModel(""); }}>
                {(creds?.providers ?? []).map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label style={{ flex: 1 }}>
              <div className="mono">who pays</div>
              <select value={payerMode} onChange={(e) => setPayerMode(e.target.value as "sponsor" | "speaker")}>
                <option value="sponsor">sponsor (my credential funds every turn)</option>
                <option value="speaker">speaker (each person's own credential)</option>
              </select>
            </label>
            <label style={{ flex: 1 }}>
              <div className="mono">model pin</div>
              {models.length ? (
                <select value={model} onChange={(e) => setModel(e.target.value)}>
                  <option value="">{creds?.defaultModel} (default)</option>
                  {models.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              ) : (
                <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={creds?.defaultModel} />
              )}
            </label>
          </div>
          {!providerCred && payerMode === "sponsor" && (
            <div className="consent">
              You have no active <b>{provider}</b> credential. Sponsor mode needs one on you. <a href="/settings" onClick={(e) => { e.preventDefault(); navigate("/settings"); }}>Connect one</a>.
              {me?.copilotOauthError && (
                <div style={{ marginTop: 6 }}>
                  Your GitHub sign-in was not accepted as a Copilot credential: <code>{me.copilotOauthError}</code>. The usual causes: the account has no Copilot seat, or the seat comes from an organisation that restricts third-party OAuth apps, in which case an organisation admin has to approve this app (GitHub → organisation settings → Third-party access), or you can paste a fine-grained token instead.
                </div>
              )}
            </div>
          )}
          <div className="row">
            <button className="primary" onClick={create}>Create session</button>
            {err && <span className="err">{err}</span>}
          </div>
        </div>

        <Digest sessions={digest} />
        <h2 style={{ fontSize: 22, margin: "22px 0 10px" }}>Your sessions</h2>
        <p className="muted" style={{ marginTop: 0 }}>Sessions you created or were invited to. Nobody else can see them.</p>
        {active.length === 0 && <p className="muted">None yet.</p>}
        {active.map((s) => <SessionListRow key={s.id} s={s} onChange={reload} />)}
        {archived.length > 0 && (
          <>
            <h3 style={{ fontSize: 16, margin: "22px 0 8px", color: "var(--ink-3)" }}>Archived</h3>
            <p className="muted" style={{ marginTop: 0 }}>Read only and out of the digest. The owner can reopen one from its menu.</p>
            {archived.map((s) => <SessionListRow key={s.id} s={s} onChange={reload} />)}
          </>
        )}
      </div>
    </>
  );
}

function SessionListRow({ s, onChange }: { s: SessionRow; onChange: () => void }) {
  return (
    <div className={`card row session-row${s.status === "archived" ? " archived" : ""}`} onClick={() => navigate(`/s/${s.id}`)}>
      <div className="thumb" aria-hidden="true">{s.thumbnail ? <img src={`data:image/svg+xml;utf8,${encodeURIComponent(s.thumbnail)}`} alt="" /> : <span className="mono">empty</span>}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{s.title}{s.status === "archived" && <span className="chip" style={{ marginLeft: 8 }}>archived</span>}</div>
        <div className="mono">{s.provider} · {s.pinnedModel} · {s.payerMode} · {s.policy}{s.template && TEMPLATES[s.template as TemplateId] ? ` · ${TEMPLATES[s.template as TemplateId].name}` : ""} · you are {s.role}</div>
      </div>
      <span className="mono" title={`created ${new Date(s.createdAt).toLocaleString()}`}>{new Date(s.updatedAt).toLocaleString()}</span>
      <SessionMenu sessionId={s.id} title={s.title} status={s.status} isOwner={s.role === "owner"} onChange={onChange} onDeleted={onChange} />
    </div>
  );
}

// What is waiting on you, then what changed while you were away. Built from each session's ledger
// and how far you had read it; a link takes you straight to the thing, not to the whole canvas.
function Digest({ sessions }: { sessions: DigestSession[] }) {
  const waiting = sessions.filter((s) => s.waiting.decisionPoints.length + s.waiting.proposals.length + s.waiting.externalCalls.length + s.waiting.signoffs.length + (s.waiting.revisits?.length ?? 0) > 0);
  const changed = sessions.filter((s) => s.since.messages + s.since.aiReplies + s.since.decisions.length + s.since.artifacts.length > 0);
  if (waiting.length === 0 && changed.length === 0) return null;
  const closes = (iso: string | null) => (iso ? ` · closes ${new Date(iso).toLocaleString()}` : "");
  return (
    <>
      {waiting.length > 0 && (
        <>
          <h2 style={{ fontSize: 22, margin: "22px 0 10px" }}>Waiting on you</h2>
          {waiting.map((s) => (
            <div key={s.sessionId} className="card stack" style={{ gap: 6 }}>
              <div style={{ fontWeight: 600 }}>{s.title}</div>
              {s.waiting.decisionPoints.map((d) => (
                <div key={d.artifactId} className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                  <span>Decision point: <b>{d.question}</b> <span className="mono">{d.votes} of {d.voters} voted{closes(d.deadline)}</span></span>
                  <button className="primary" onClick={() => navigate(`/s/${s.sessionId}/vote/${d.artifactId}`)}>Vote</button>
                </div>
              ))}
              {s.waiting.proposals.map((p) => (
                <div key={p.id} className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                  <span>Proposal from {p.proposer}: {p.op} <b>{p.title}</b>{p.autoApplyAt ? <span className="mono"> · applies by itself {new Date(p.autoApplyAt).toLocaleTimeString()}</span> : null}</span>
                  <button onClick={() => navigate(`/s/${s.sessionId}`)}>Review</button>
                </div>
              ))}
              {s.waiting.externalCalls.map((c) => (
                <div key={c.id} className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                  <span>Outbound write for {c.onBehalfOf} with your tool: <b>{c.summary}</b></span>
                  <button onClick={() => navigate(`/s/${s.sessionId}`)}>Decide</button>
                </div>
              ))}
              {s.waiting.signoffs.map((r) => (
                <div key={r.artifactId} className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                  <span>Sign-off requested by {r.requestedBy}: <b>{r.title}</b> v{r.versionNo} <span className="mono">{r.signed} of {r.needed} signed</span></span>
                  <button onClick={() => navigate(`/s/${s.sessionId}`)} title="Read the document in the session, then sign off on its card">Review</button>
                </div>
              ))}
              {(s.waiting.revisits ?? []).map((r) => (
                <div key={r.id} className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                  <span>{r.kind === "assumption" ? "Your assumption" : "Decision"} <b>{r.label}</b> is due a look ({r.revisitAt.slice(0, 10)}): {r.statement}</span>
                  <button onClick={() => navigate(`/s/${s.sessionId}`)} title={r.kind === "assumption" ? "Confirm or refute it in the Decisions tab" : "Reopen the question in the session"}>Revisit</button>
                </div>
              ))}
            </div>
          ))}
        </>
      )}
      {changed.length > 0 && (
        <>
          <h2 style={{ fontSize: 22, margin: "22px 0 10px" }}>Since you last looked</h2>
          {changed.map((s) => (
            <div key={s.sessionId} className="card" style={{ cursor: "pointer" }} onClick={() => navigate(`/s/${s.sessionId}`)}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span style={{ fontWeight: 600 }}>{s.title}</span>
                <span className="mono">{s.since.messages} message{s.since.messages === 1 ? "" : "s"} · {s.since.aiReplies} AI repl{s.since.aiReplies === 1 ? "y" : "ies"}</span>
              </div>
              {s.since.mentions.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  {s.since.mentions.map((m) => <div key={m.eventId} className="msg" style={{ padding: "4px 8px", marginTop: 4 }}><span className="mono">{m.from} mentioned you</span><div>{m.text}</div></div>)}
                </div>
              )}
              {s.since.decisions.length > 0 && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Decisions: {s.since.decisions.join("; ")}</div>}
              {s.since.artifacts.length > 0 && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>Cards changed: {s.since.artifacts.join(", ")}</div>}
            </div>
          ))}
        </>
      )}
    </>
  );
}
