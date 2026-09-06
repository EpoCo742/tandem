import { useEffect, useState } from "react";
import { api, type CredentialView, type McpServerView } from "../api";
import { TopBar } from "../components/TopBar";
import { NotificationRules } from "../components/NotificationRules";

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
        <McpServers />
      </div>
    </>
  );
}

// Per-user MCP servers: your own tools with your own credentials. The AI can use them on
// turns you direct; writes wait for your approval in the session's Proposals tab.
function McpServers() {
  const [servers, setServers] = useState<McpServerView[]>([]);
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"stdio" | "http">("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [env, setEnv] = useState("");
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"form" | "json">("json");
  const [json, setJson] = useState("");
  const [imported, setImported] = useState<string | null>(null);

  const load = () => api<{ servers: McpServerView[] }>("GET", "/api/v1/mcp-servers").then((r) => setServers(r.servers));

  async function importJson() {
    setBusy("import");
    setErr(null);
    setImported(null);
    try {
      const r = await api<{ results: { name: string; status: string; tools: { name: string }[]; lastError?: string | null }[] }>("POST", "/api/v1/mcp-servers/import", { json, name: name || undefined });
      setImported(r.results.map((x) => `${x.name}: ${x.status === "ok" ? `${x.tools.length} tools` : x.lastError ?? x.status}`).join(" · "));
      if (r.results.every((x) => x.status === "ok")) setJson("");
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  useEffect(() => { load(); }, []);

  async function add() {
    setBusy("add");
    setErr(null);
    try {
      const config = transport === "stdio" ? { transport, command, args, env } : { transport, url, headers };
      await api("POST", "/api/v1/mcp-servers", { name, config });
      setName(""); setCommand(""); setArgs(""); setEnv(""); setUrl(""); setHeaders("");
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function test(id: string) {
    setBusy(id);
    try {
      await api("POST", `/api/v1/mcp-servers/${id}/test`);
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <h2 style={{ fontSize: 22, margin: "28px 0 8px" }}>External tools (MCP servers)</h2>
      <p className="muted">
        Your own MCP servers with your own credentials, for example Atlassian or GitHub. On turns you direct, the AI can use them: reads run at once, writes wait for your approval in the session's Proposals tab. Configuration is encrypted at rest and never sent back to the browser.
      </p>
      <div className="card stack">
        <div className="tabs" style={{ padding: 0, borderBottom: "1px solid var(--line)" }}>
          <button className={mode === "json" ? "active" : ""} onClick={() => setMode("json")}>Paste JSON</button>
          <button className={mode === "form" ? "active" : ""} onClick={() => setMode("form")}>Fill in fields</button>
        </div>
        {mode === "json" ? (
          <>
            <div className="muted" style={{ fontSize: 12 }}>
              Paste the server entry from your editor's <code>mcp.json</code>, or the whole file. VS Code's <code>{"{ \"servers\": { … } }"}</code>, Claude Desktop's and Cursor's <code>{"{ \"mcpServers\": { … } }"}</code>, and a single server object all work; <code>type</code>, <code>url</code>, <code>headers</code>, <code>command</code>, <code>args</code> and <code>env</code> are used, <code>gallery</code> and <code>version</code> are ignored. Replace any <code>{"${input:…}"}</code> placeholders with real values first.
            </div>
            <textarea value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} style={{ minHeight: 140, fontFamily: "var(--mono)", fontSize: 12 }} placeholder={'{\n  "servers": {\n    "atlassian": {\n      "type": "http",\n      "url": "https://mcp.atlassian.com/v1/mcp",\n      "headers": { "X-Atlassian-Token": "…" }\n    }\n  }\n}'} />
            <div className="row">
              <label style={{ width: 220 }}>
                <div className="mono">name (only if the JSON is a single server without one)</div>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="atlassian" />
              </label>
              <button className="primary" onClick={importJson} disabled={busy !== null || !json.trim()} style={{ alignSelf: "flex-end" }}>{busy === "import" ? "Connecting…" : "Import and test"}</button>
              {imported && <span className="mono" style={{ alignSelf: "flex-end" }}>{imported}</span>}
              {err && <span className="err" style={{ alignSelf: "flex-end" }}>{err}</span>}
            </div>
          </>
        ) : (
        <>
        <div className="row">
          <label style={{ width: 180 }}>
            <div className="mono">name</div>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="atlassian" />
          </label>
          <label style={{ width: 140 }}>
            <div className="mono">transport</div>
            <select value={transport} onChange={(e) => setTransport(e.target.value as "stdio" | "http")}>
              <option value="stdio">stdio (local command)</option>
              <option value="http">http (remote URL)</option>
            </select>
          </label>
          {transport === "stdio" ? (
            <>
              <label style={{ width: 160 }}>
                <div className="mono">command</div>
                <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" />
              </label>
              <label style={{ flex: 1 }}>
                <div className="mono">arguments</div>
                <input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="-y mcp-remote https://mcp.atlassian.com/v1/sse" />
              </label>
            </>
          ) : (
            <label style={{ flex: 1 }}>
              <div className="mono">url</div>
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.githubcopilot.com/mcp/" />
            </label>
          )}
        </div>
        <label>
          <div className="mono">{transport === "stdio" ? "environment (one KEY=value per line; tokens go here)" : "headers (one Name: value per line, e.g. Authorization: Bearer …)"}</div>
          <textarea value={transport === "stdio" ? env : headers} onChange={(e) => (transport === "stdio" ? setEnv(e.target.value) : setHeaders(e.target.value.replace(/^([^:=\n]+):\s*/gm, "$1=")))} style={{ minHeight: 48, fontFamily: "var(--mono)", fontSize: 12 }} placeholder={transport === "stdio" ? "ATLASSIAN_API_TOKEN=…" : "Authorization=Bearer …"} />
        </label>
        <div className="row">
          <button className="primary" onClick={add} disabled={busy !== null || !name.trim() || (transport === "stdio" ? !command.trim() : !url.trim())}>{busy === "add" ? "Connecting…" : "Add and test"}</button>
          {err && <span className="err">{err}</span>}
        </div>
        </>
        )}
      </div>
      {servers.map((s) => (
        <div key={s.id} className="card row" style={{ alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <div><b>{s.name}</b> · <span className="mono">{s.transport} · {s.summary}</span> · <span className="chip" style={{ color: s.status === "ok" ? "var(--ok)" : s.status === "error" ? "var(--warn)" : "var(--ink-3)" }}>{s.status}</span></div>
            {s.status === "error" && s.lastError && <div className="err" style={{ fontSize: 12 }}>{s.lastError}</div>}
            {s.tools.length > 0 && (
              <div className="mono" style={{ marginTop: 4 }}>
                {s.tools.map((t) => <span key={t.name} title={t.description} style={{ marginRight: 10 }}>{t.name}{t.readOnly ? "" : " ✎"}</span>)}
              </div>
            )}
            {s.tools.length > 0 && <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>✎ marks tools that change something and will ask for your approval.</div>}
            {s.allow.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <div className="mono">runs without asking:</div>
                {s.allow.map((r, i) => (
                  <div key={i} className="row" style={{ fontSize: 12, gap: 6 }}>
                    <span><b>{r.tool}</b> for {Object.entries(r.target).length ? Object.entries(r.target).map(([k, v]) => `${k} ${v}`).join(", ") : "any target"}</span>
                    <button style={{ padding: "0 6px", fontSize: 10.5 }} onClick={() => api("DELETE", `/api/v1/mcp-servers/${s.id}/allow/${i}`).then(load)}>ask again</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => test(s.id)} disabled={busy !== null}>{busy === s.id ? "Testing…" : "Test"}</button>
          <button className="danger" onClick={() => api("DELETE", `/api/v1/mcp-servers/${s.id}`).then(load)}>Remove</button>
        </div>
      ))}
      <NotificationRules servers={servers} />
    </>
  );
}
