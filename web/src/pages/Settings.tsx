import { useEffect, useState } from "react";
import { api, type CredentialView } from "../api";
import { TopBar } from "../components/TopBar";

export function Settings() {
  const [data, setData] = useState<{ credentials: CredentialView[]; providers: string[]; defaultProvider: string } | null>(null);
  const [provider, setProvider] = useState("copilot");
  const [token, setToken] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () => api<typeof data>("GET", "/api/v1/credentials").then(setData);
  useEffect(() => { load(); }, []);

  async function add() {
    setBusy(true);
    setErr(null);
    try {
      await api("POST", "/api/v1/credentials", { provider, token, label: label || undefined });
      setToken("");
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar />
      <div className="page">
        <h2 style={{ fontSize: 26, marginBottom: 12 }}>AI credentials</h2>
        <p className="muted">Turns you fund run on these. Tokens are encrypted at rest and never sent to the browser.</p>
        <div className="card stack">
          <div className="row">
            <label style={{ width: 160 }}>
              <div className="mono">provider</div>
              <select value={provider} onChange={(e) => setProvider(e.target.value)}>
                {(data?.providers ?? ["copilot", "fake"]).map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label style={{ flex: 1 }}>
              <div className="mono">{provider === "copilot" ? "GitHub token (gho_, ghu_ or github_pat_) with an active Copilot seat" : provider === "fake" ? "no token needed" : "token"}</div>
              <input type="password" value={token} onChange={(e) => setToken(e.target.value)} disabled={provider === "fake"} placeholder={provider === "fake" ? "offline scripted architect" : "paste token"} />
            </label>
            <label style={{ width: 160 }}>
              <div className="mono">label</div>
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="optional" />
            </label>
            <button className="primary" onClick={add} disabled={busy || (provider !== "fake" && !token)} style={{ alignSelf: "flex-end" }}>{busy ? "Validating…" : "Connect"}</button>
          </div>
          {provider === "copilot" && (
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              Validation starts the bundled Copilot runtime with your token and lists the models your plan allows. The first run can take 10-20 seconds.
              For a fine-grained token: resource owner must be your personal account (not an organization), account permission <b>Copilot Requests: Read</b>, no repository access needed. Classic <code>ghp_</code> tokens are not accepted by Copilot.
            </p>
          )}
          {err && <div className="err">{err}</div>}
        </div>
        {(data?.credentials ?? []).map((c) => (
          <div key={c.id} className="card row">
            <div style={{ flex: 1 }}>
              <div><b>{c.provider}</b> · {c.label} · <span className="mono">…{c.fingerprint}</span></div>
              <div className="mono">{c.models.length ? `models: ${c.models.join(", ")}` : "no model list"}</div>
            </div>
            <button className="danger" onClick={() => api("DELETE", `/api/v1/credentials/${c.id}`).then(load)}>Revoke</button>
          </div>
        ))}
      </div>
    </>
  );
}
