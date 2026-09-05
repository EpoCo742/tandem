import { useEffect, useState } from "react";
import { api, type CredentialView } from "../api";
import { navigate } from "../App";
import { TopBar } from "../components/TopBar";
import { useStore } from "../state/store";

interface SessionRow { id: string; title: string; policy: string; payerMode: string; pinnedModel: string; provider: string; createdAt: string }

export function Home() {
  const me = useStore((s) => s.me);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [creds, setCreds] = useState<{ credentials: CredentialView[]; providers: string[]; defaultProvider: string; defaultModel: string } | null>(null);
  const [title, setTitle] = useState("");
  const [provider, setProvider] = useState("");
  const [payerMode, setPayerMode] = useState<"sponsor" | "speaker">("sponsor");
  const [model, setModel] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<SessionRow[]>("GET", "/api/v1/sessions").then(setSessions);
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
      const { id } = await api<{ id: string }>("POST", "/api/v1/sessions", { title: title || "Untitled session", provider, payerMode, pinnedModel: model || undefined, policy: "hybrid" });
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

        <h2 style={{ fontSize: 22, margin: "22px 0 10px" }}>Your sessions</h2>
        {sessions.length === 0 && <p className="muted">None yet.</p>}
        {sessions.map((s) => (
          <div key={s.id} className="card row" style={{ cursor: "pointer" }} onClick={() => navigate(`/s/${s.id}`)}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{s.title}</div>
              <div className="mono">{s.provider} · {s.pinnedModel} · {s.payerMode} · {s.policy}</div>
            </div>
            <span className="mono">{new Date(s.createdAt).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </>
  );
}
