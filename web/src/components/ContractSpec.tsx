import { useState } from "react";
import { type ContractSpecModel } from "@tandem/shared";

// A contract card as an API reference rather than a wall of YAML. The parsing lives in shared.

const methodClass = (m: string) => ({ GET: "get", POST: "post", PUT: "put", PATCH: "patch", DELETE: "delete" } as Record<string, string>)[m] ?? "other";

export function ContractSpec({ spec }: { spec: ContractSpecModel }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="api">
      <div className="api-head">
        {spec.title && <b>{spec.title}</b>}
        {spec.version && <span className="chip" style={{ color: "var(--ink-3)" }}>v{spec.version}</span>}
        <span className="mono">{spec.kind === "openapi" ? `${spec.count} endpoint${spec.count === 1 ? "" : "s"}` : `${spec.count} channel${spec.count === 1 ? "" : "s"}`}</span>
        {spec.kind === "openapi" && spec.servers.map((s) => <span key={s} className="mono" title="Server">{s}</span>)}
      </div>
      {spec.kind === "openapi" &&
        spec.groups.map((g) => (
          <div key={g.name} className="api-group">
            {(spec.groups.length > 1 || g.name !== "/") && <div className="api-group-name">{g.name} · {g.ops.length}</div>}
            {g.ops.map((op) => (
              <div key={op.id}>
                <div className={"api-op" + (open === op.id ? " open" : "") + (op.deprecated ? " deprecated" : "")} onClick={() => setOpen(open === op.id ? null : op.id)} title={op.summary ?? op.path}>
                  <span className={"api-method " + methodClass(op.method)}>{op.method}</span>
                  <code className="api-path">{op.path}</code>
                  <span className="api-summary">{op.summary ?? op.description ?? ""}{op.deprecated ? " (deprecated)" : ""}</span>
                </div>
                {open === op.id && (
                  <div className="api-detail">
                    {op.description && op.summary && <p style={{ margin: "0 0 6px" }}>{op.description}</p>}
                    {op.params.length > 0 && (
                      <table>
                        <thead><tr><th>parameter</th><th>in</th><th>type</th><th></th></tr></thead>
                        <tbody>{op.params.map((p, i) => <tr key={i}><td className="code">{p.name}</td><td>{p.in}</td><td className="code">{p.type}</td><td>{p.required ? <span className="chip" style={{ color: "var(--warn)" }}>required</span> : null}{p.description ? <span className="muted"> {p.description}</span> : null}</td></tr>)}</tbody>
                      </table>
                    )}
                    {op.requestBody.length > 0 && <div><span className="mono">body</span> {op.requestBody.map((b) => <code key={b} className="code" style={{ marginRight: 8 }}>{b}</code>)}</div>}
                    {op.responses.length > 0 && (
                      <div style={{ marginTop: 4 }}>
                        <span className="mono">responses</span>
                        {op.responses.map((r) => <div key={r.code}><code className="code" style={{ color: r.code.startsWith("2") ? "var(--ok)" : r.code.startsWith("4") || r.code.startsWith("5") ? "var(--warn)" : undefined }}>{r.code}</code> {r.description}</div>)}
                      </div>
                    )}
                    {op.params.length === 0 && op.requestBody.length === 0 && op.responses.length === 0 && <span className="muted">No parameters, body or responses described.</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      {spec.kind === "openapi" && spec.schemas.length > 0 && (
        <div className="api-group">
          <div className="api-group-name">schemas · {spec.schemas.length}</div>
          <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>{spec.schemas.slice(0, 40).map((s) => <span key={s} className="chip" style={{ color: "var(--ink-2)" }}>{s}</span>)}{spec.schemas.length > 40 && <span className="muted">and {spec.schemas.length - 40} more</span>}</div>
        </div>
      )}
      {spec.kind === "asyncapi" &&
        spec.channels.map((ch) => (
          <div key={ch.name} className="api-group">
            <div className="api-op" style={{ cursor: "default" }}>
              <span className="api-method other">channel</span>
              <code className="api-path">{ch.name}</code>
              <span className="api-summary">{ch.ops.map((o) => `${o.action}${o.messages.length ? `: ${o.messages.join(", ")}` : ""}`).join(" · ")}</span>
            </div>
            {ch.ops.filter((o) => o.summary).map((o, i) => <div key={i} className="api-detail" style={{ paddingTop: 0 }}>{o.action}: {o.summary}</div>)}
          </div>
        ))}
    </div>
  );
}
