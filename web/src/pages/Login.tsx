import { useState } from "react";
import { api, type Me } from "../api";
import { useStore } from "../state/store";

export function Login() {
  const me = useStore((s) => s.me)!;
  const setMe = useStore((s) => s.setMe);
  const [handle, setHandle] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function devLogin() {
    setErr(null);
    try {
      await api("POST", "/auth/dev", { handle, name: handle });
      setMe(await api<Me>("GET", "/auth/me"));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 520 }}>
      <h1 style={{ fontSize: 40, marginBottom: 8 }}>Tandem</h1>
      <p className="muted" style={{ marginTop: 0 }}>Shared AI sessions for people who design systems together.</p>
      <div className="card stack">
        {me.githubConfigured && (
          <a href="/auth/github"><button className="primary">Sign in with GitHub</button></a>
        )}
        {!me.githubConfigured && <p className="muted" style={{ margin: 0 }}>GitHub OAuth is not configured on this server (set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET).</p>}
        {me.devAuth && (
          <>
            <hr style={{ border: 0, borderTop: "1px solid var(--line)", width: "100%" }} />
            <div className="mono">Dev login (TANDEM_DEV_AUTH=1)</div>
            <div className="row">
              <input placeholder="handle, e.g. alice" value={handle} onChange={(e) => setHandle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && devLogin()} />
              <button onClick={devLogin} disabled={!handle.trim()}>Enter</button>
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>Open a second browser (or a private window) and log in with another handle to be the second participant.</p>
          </>
        )}
        {err && <div className="err">{err}</div>}
      </div>
    </div>
  );
}
