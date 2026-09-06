import { useEffect, useState } from "react";
import { api, type McpServerView } from "../api";

interface Rule { id: string; serverName: string; toolName: string; target: Record<string, string>; events: string[]; enabled: boolean; lastSentAt: string | null; lastError: string | null }
const EVENTS: { id: string; label: string }[] = [
  { id: "decision_point", label: "a decision point is raised" },
  { id: "proposal", label: "a proposal waits on me" },
  { id: "signoff", label: "my sign-off is requested" },
  { id: "approved", label: "a design document is approved" },
  { id: "mention", label: "someone mentions me" },
  { id: "violation", label: "a data flow breaks a constraint" },
];

// Where to be told when something waits on you: one of your own MCP servers, a tool that
// sends (Slack, Teams, mail), a target (a channel), and which events. Setting the rule is the
// approval; every send is logged on it.
export function NotificationRules({ servers }: { servers: McpServerView[] }) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [serverId, setServerId] = useState("");
  const [tool, setTool] = useState("");
  const [target, setTarget] = useState('{"channel": "#architecture"}');
  const [events, setEvents] = useState<string[]>(["decision_point", "proposal", "signoff", "mention"]);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => api<{ rules: Rule[] }>("GET", "/api/v1/notifications").then((r) => setRules(r.rules)).catch(() => undefined);
  useEffect(() => { void load(); }, []);
  const server = servers.find((s) => s.id === serverId);
  const writeTools = (server?.tools ?? []).filter((t) => !t.readOnly);

  async function add() {
    setMsg(null);
    let parsed: Record<string, string>;
    try {
      parsed = JSON.parse(target || "{}") as Record<string, string>;
    } catch {
      setMsg("The target must be JSON, e.g. {\"channel\": \"#architecture\"}");
      return;
    }
    try {
      await api("POST", "/api/v1/notifications", { mcpServerId: serverId, toolName: tool, target: parsed, events });
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }
  async function test(id: string) {
    setMsg(null);
    try {
      const r = await api<{ ok: boolean; text: string }>("POST", `/api/v1/notifications/${id}/test`);
      setMsg(r.ok ? `Sent: ${r.text.slice(0, 120)}` : `Failed: ${r.text.slice(0, 200)}`);
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  return (
    <>
      <h2 style={{ fontSize: 22, margin: "28px 0 8px" }}>Notifications</h2>
      <p className="muted" style={{ marginTop: 0 }}>Be told through a tool of your own (Slack, Teams, mail) when something waits on you. Register the server under External tools first; the tool must send, not read. Setting a rule is the approval: sends are not gated again, and each one is logged here.</p>
      {rules.map((r) => (
        <div key={r.id} className="card" style={{ padding: 10 }}>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <b>{r.serverName}</b>
            <span className="mono">{r.toolName} {JSON.stringify(r.target)}</span>
            <span className="grow" />
            <button className="icon" onClick={() => test(r.id)} title="Send a test message through this rule">test</button>
            <button className="icon" onClick={() => api("POST", `/api/v1/notifications/${r.id}/enable`, { enabled: !r.enabled }).then(load)}>{r.enabled ? "pause" : "resume"}</button>
            <button className="icon danger" onClick={() => api("DELETE", `/api/v1/notifications/${r.id}`).then(load)}>remove</button>
          </div>
          <div className="mono" style={{ marginTop: 4 }}>
            on: {r.events.map((e) => EVENTS.find((x) => x.id === e)?.label ?? e).join("; ")}
            {r.lastSentAt ? ` · last sent ${new Date(r.lastSentAt).toLocaleString()}` : " · never sent"}
            {r.lastError ? <span style={{ color: "var(--warn)" }}> · last error: {r.lastError}</span> : null}
            {!r.enabled ? " · paused" : ""}
          </div>
        </div>
      ))}
      {servers.length === 0 ? (
        <p className="muted">No MCP servers registered yet.</p>
      ) : (
        <div className="card stack" style={{ padding: 10 }}>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <select value={serverId} onChange={(e) => { setServerId(e.target.value); setTool(""); }} style={{ width: "auto" }}>
              <option value="">choose a server</option>
              {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select value={tool} onChange={(e) => setTool(e.target.value)} style={{ width: "auto" }} disabled={!server}>
              <option value="">choose a tool that sends</option>
              {writeTools.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
            <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder='{"channel": "#architecture"}' style={{ flex: 1, minWidth: 220 }} title="Arguments for the tool besides the message text, as JSON" />
          </div>
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            {EVENTS.map((e) => (
              <label key={e.id} className="row" style={{ gap: 4, fontSize: 12.5 }}>
                <input type="checkbox" checked={events.includes(e.id)} onChange={(ev) => setEvents(ev.target.checked ? [...events, e.id] : events.filter((x) => x !== e.id))} />
                {e.label}
              </label>
            ))}
          </div>
          <div className="row">
            <button className="primary" disabled={!serverId || !tool || events.length === 0} onClick={add}>Add rule</button>
            {msg && <span className="mono">{msg}</span>}
          </div>
        </div>
      )}
      {servers.length > 0 && msg && rules.length === 0 && <div className="mono">{msg}</div>}
    </>
  );
}
