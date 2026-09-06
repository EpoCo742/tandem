import YAML from "yaml";

// What a contract body is when it is a real document: OpenAPI endpoints grouped by tag (or by
// first path segment) with parameters, request body and responses; AsyncAPI channels with what is
// published and subscribed to. The web renders this as an API reference; the server uses it to
// tell a verbatim document from a summary and to set the contract's format from its content.

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
