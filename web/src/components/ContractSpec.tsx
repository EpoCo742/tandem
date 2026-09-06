import { useState } from "react";
import YAML from "yaml";

// A contract card as an API reference rather than a wall of YAML: OpenAPI endpoints grouped by tag
// (or by first path segment) with method, path and summary, each opening to its parameters, request
// body and responses; AsyncAPI channels with what is published and subscribed to. Anything that does
// not parse as one of those keeps the plain rendering.

export interface ApiParam { name: string; in: string; required: boolean; type: string; description?: string }
export interface ApiOp { id: string; method: string; path: string; summary?: string; description?: string; params: ApiParam[]; requestBody: string[]; responses: { code: string; description: string }[]; deprecated: boolean }
export type ContractSpecModel =
  | { kind: "openapi"; title?: string; version?: string; servers: string[]; groups: { name: string; ops: ApiOp[] }[]; schemas: string[]; count: number }
  | { kind: "asyncapi"; title?: string; version?: string; channels: { name: string; ops: { action: string; messages: string[]; summary?: string }[] }[]; count: number };

const METHODS = ["get", "post", "put", "patch", "delete", "options", "head", "trace"];

function parseDoc(body: string): unknown {
  const t = body.trim();
  if (!t) return null;
  if (t.startsWith("{")) return JSON.parse(t);
  return YAML.parse(t, { maxAliasCount: 200 });
}

const refName = (ref: unknown) => (typeof ref === "string" ? ref.split("/").pop() ?? ref : "");
const typeOf = (schema: unknown): string => {
  if (!schema || typeof schema !== "object") return "";
  const s = schema as Record<string, unknown>;
  if (typeof s.$ref === "string") return refName(s.$ref);
  if (s.type === "array") return `${typeOf(s.items) || "any"}[]`;
  if (typeof s.type === "string") return s.format ? `${s.type} (${s.format})` : s.type;
  if (Array.isArray(s.oneOf) || Array.isArray(s.anyOf)) return "one of";
  return "";
};

/** Parse the contract text; null when it is not an OpenAPI or AsyncAPI document. */
export function parseContract(body: string): ContractSpecModel | null {
  let doc: unknown;
  try {
    doc = parseDoc(body);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== "object") return null;
  const d = doc as Record<string, unknown>;
  const info = (d.info ?? {}) as Record<string, unknown>;
  if (d.paths && typeof d.paths === "object") {
    const ops: ApiOp[] = [];
    const tagOf = new Map<string, string[]>();
    for (const [path, item] of Object.entries(d.paths as Record<string, unknown>)) {
      if (!item || typeof item !== "object") continue;
      const pi = item as Record<string, unknown>;
      const shared = Array.isArray(pi.parameters) ? pi.parameters : [];
      for (const method of METHODS) {
        const op = pi[method];
        if (!op || typeof op !== "object") continue;
        const o = op as Record<string, unknown>;
        const params = [...shared, ...(Array.isArray(o.parameters) ? o.parameters : [])].map((p): ApiParam => {
          const q = (p ?? {}) as Record<string, unknown>;
          if (typeof q.$ref === "string") return { name: refName(q.$ref), in: "ref", required: false, type: "" };
          return { name: String(q.name ?? ""), in: String(q.in ?? ""), required: Boolean(q.required), type: typeOf(q.schema) || (typeof q.type === "string" ? q.type : ""), ...(typeof q.description === "string" ? { description: q.description } : {}) };
        });
        const rb = (o.requestBody ?? {}) as Record<string, unknown>;
        const requestBody = rb.content && typeof rb.content === "object" ? Object.entries(rb.content as Record<string, unknown>).map(([ct, v]) => `${ct}${typeOf((v as Record<string, unknown>)?.schema) ? ` · ${typeOf((v as Record<string, unknown>).schema)}` : ""}`) : typeof rb.$ref === "string" ? [refName(rb.$ref)] : [];
        const responses = o.responses && typeof o.responses === "object" ? Object.entries(o.responses as Record<string, unknown>).map(([code, r]) => ({ code, description: String((r as Record<string, unknown>)?.description ?? refName((r as Record<string, unknown>)?.$ref) ?? "") })) : [];
        const id = `${method} ${path}`;
        ops.push({ id, method: method.toUpperCase(), path, ...(typeof o.summary === "string" ? { summary: o.summary } : {}), ...(typeof o.description === "string" ? { description: o.description } : {}), params, requestBody, responses, deprecated: Boolean(o.deprecated) });
        const tags = Array.isArray(o.tags) && o.tags.length ? o.tags.map(String) : [path.split("/").filter(Boolean)[0] ?? "/"];
        tagOf.set(id, tags);
      }
    }
    if (ops.length === 0) return null;
    const order: string[] = [];
    const byTag = new Map<string, ApiOp[]>();
    for (const op of ops) {
      const tag = tagOf.get(op.id)![0]!;
      if (!byTag.has(tag)) {
        byTag.set(tag, []);
        order.push(tag);
      }
      byTag.get(tag)!.push(op);
    }
    const components = (d.components ?? {}) as Record<string, unknown>;
    const schemas = Object.keys((components.schemas ?? d.definitions ?? {}) as Record<string, unknown>);
    const servers = Array.isArray(d.servers) ? d.servers.map((s) => String((s as Record<string, unknown>)?.url ?? "")).filter(Boolean) : typeof d.host === "string" ? [`${Array.isArray(d.schemes) ? String(d.schemes[0]) : "https"}://${d.host}${typeof d.basePath === "string" ? d.basePath : ""}`] : [];
    return { kind: "openapi", ...(typeof info.title === "string" ? { title: info.title } : {}), ...(info.version !== undefined ? { version: String(info.version) } : {}), servers, groups: order.map((name) => ({ name, ops: byTag.get(name)! })), schemas, count: ops.length };
  }
  if (d.channels && typeof d.channels === "object") {
    const channels: { name: string; ops: { action: string; messages: string[]; summary?: string }[] }[] = [];
    const msgNames = (m: unknown): string[] => {
      if (!m || typeof m !== "object") return [];
      const mm = m as Record<string, unknown>;
      if (typeof mm.$ref === "string") return [refName(mm.$ref)];
      if (Array.isArray(mm.oneOf)) return mm.oneOf.flatMap(msgNames);
      if (typeof mm.name === "string") return [mm.name];
      if (typeof mm.title === "string") return [mm.title];
      return Object.entries(mm).flatMap(([k, v]) => (v && typeof v === "object" && ("payload" in (v as object) || "$ref" in (v as object)) ? [k] : []));
    };
    for (const [name, ch] of Object.entries(d.channels as Record<string, unknown>)) {
      const c = (ch ?? {}) as Record<string, unknown>;
      const ops: { action: string; messages: string[]; summary?: string }[] = [];
      for (const action of ["publish", "subscribe"]) {
        const o = c[action];
        if (o && typeof o === "object") {
          const oo = o as Record<string, unknown>;
          ops.push({ action, messages: msgNames(oo.message), ...(typeof oo.summary === "string" ? { summary: oo.summary } : {}) });
        }
      }
      if (ops.length === 0 && c.messages && typeof c.messages === "object") ops.push({ action: "messages", messages: msgNames(c.messages) });
      channels.push({ name, ops });
    }
    if (d.operations && typeof d.operations === "object") {
      for (const [, op] of Object.entries(d.operations as Record<string, unknown>)) {
        const o = (op ?? {}) as Record<string, unknown>;
        const chName = refName((o.channel as Record<string, unknown>)?.$ref);
        const ch = channels.find((x) => x.name === chName);
        if (ch && typeof o.action === "string") ch.ops.unshift({ action: o.action, messages: Array.isArray(o.messages) ? o.messages.flatMap(msgNames) : [], ...(typeof o.summary === "string" ? { summary: o.summary } : {}) });
      }
    }
    if (channels.length === 0) return null;
    return { kind: "asyncapi", ...(typeof info.title === "string" ? { title: info.title } : {}), ...(info.version !== undefined ? { version: String(info.version) } : {}), channels, count: channels.length };
  }
  return null;
}

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
