import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { db, now, schema } from "./db/index.js";
import { seal, unseal } from "./crypto.js";

// Per-user MCP servers. A person registers their own servers with their own credentials;
// the whole transport config is sealed like an AI token. The tools a server offers are
// discovered by connecting to it (a "test"), stored for display and for the prompt, and
// the same connection code runs tools for the offline provider. The Copilot runtime
// connects to the servers itself during a turn; see providers/copilot.ts.

export type McpConfig =
  | { transport: "stdio"; command: string; args: string[]; env: Record<string, string>; cwd?: string }
  | { transport: "http"; url: string; headers: Record<string, string> };

export interface McpToolInfo {
  name: string;
  description: string;
  readOnly: boolean;
}

/** A write that runs without asking: this tool, when every listed argument matches. */
export interface AllowRule {
  tool: string;
  target: Record<string, string>; // empty means any target
  createdAt: string;
}

export interface McpServerView {
  id: string;
  name: string;
  transport: string;
  summary: string;
  tools: McpToolInfo[];
  allow: AllowRule[];
  status: string;
  lastError: string | null;
  testedAt: string | null;
  createdAt: string;
}

export interface McpServerForTurn {
  id: string;
  name: string;
  ownerUserId: string;
  config: McpConfig;
  tools: McpToolInfo[];
  allow: AllowRule[];
}

function parseAllow(raw: string | null): AllowRule[] {
  try {
    return raw ? (JSON.parse(raw) as AllowRule[]) : [];
  } catch {
    return [];
  }
}

/** Does a stored rule cover this call? Every argument named by the rule must match exactly. */
export function ruleAllows(rules: AllowRule[], tool: string, target: Record<string, string>): AllowRule | null {
  return rules.find((r) => r.tool === tool && Object.entries(r.target).every(([k, v]) => target[k] === v)) ?? null;
}

export function addAllowRule(userId: string, serverName: string, rule: Omit<AllowRule, "createdAt">): AllowRule[] {
  const row = db.select().from(schema.mcpServers).where(and(eq(schema.mcpServers.userId, userId), eq(schema.mcpServers.name, serverName))).get();
  if (!row) throw new Error("server not found");
  const rules = parseAllow(row.allow).filter((r) => !(r.tool === rule.tool && JSON.stringify(r.target) === JSON.stringify(rule.target)));
  rules.push({ ...rule, createdAt: now() });
  db.update(schema.mcpServers).set({ allow: JSON.stringify(rules) }).where(eq(schema.mcpServers.id, row.id)).run();
  return rules;
}

export function removeAllowRule(userId: string, serverId: string, index: number) {
  const row = db.select().from(schema.mcpServers).where(and(eq(schema.mcpServers.id, serverId), eq(schema.mcpServers.userId, userId))).get();
  if (!row) throw new Error("server not found");
  const rules = parseAllow(row.allow);
  rules.splice(index, 1);
  db.update(schema.mcpServers).set({ allow: JSON.stringify(rules) }).where(eq(schema.mcpServers.id, row.id)).run();
}

const CONNECT_TIMEOUT_MS = 20_000;
const CALL_TIMEOUT_MS = 60_000;

function summarize(config: McpConfig): string {
  if (config.transport === "stdio") return `${config.command} ${config.args.join(" ")}`.trim();
  try {
    return new URL(config.url).host;
  } catch {
    return config.url;
  }
}

export function normalizeConfig(input: unknown): McpConfig {
  const c = (input ?? {}) as Record<string, unknown>;
  // VS Code writes "type": "http" | "sse" | "stdio"; treat it as our transport when ours is absent.
  const kind = c.transport ?? (c.type === "http" || c.type === "sse" || (typeof c.url === "string" && !c.command) ? "http" : "stdio");
  if (kind === "http") {
    const url = String(c.url ?? "").trim();
    if (!/^https?:\/\//.test(url)) throw new Error("http transport needs a URL starting with http:// or https://");
    return { transport: "http", url, headers: stringMap(c.headers) };
  }
  const command = String(c.command ?? "").trim();
  if (!command) throw new Error("stdio transport needs a command");
  const args = Array.isArray(c.args) ? c.args.map(String) : typeof c.args === "string" ? splitArgs(c.args) : [];
  return { transport: "stdio", command, args, env: stringMap(c.env), cwd: c.cwd ? String(c.cwd) : undefined };
}

/**
 * Parse a pasted config the way editors write it: a whole mcp.json ({ "servers": {...} } for VS Code,
 * { "mcpServers": {...} } for Claude Desktop and Cursor) or a single server object. Fields such as
 * "gallery" and "version" are ignored. Editor input variables like ${input:token} are refused,
 * because nothing here can prompt for them.
 */
export function parsePastedConfig(text: string, fallbackName = "server"): { name: string; config: McpConfig }[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`not valid JSON: ${(e as Error).message}`);
  }
  if (/\$\{input:[^}]+\}/.test(text)) throw new Error("the JSON contains ${input:…} placeholders; replace them with the real values before pasting");
  const obj = (raw ?? {}) as Record<string, unknown>;
  const map = (obj.servers ?? obj.mcpServers) as Record<string, unknown> | undefined;
  const entries = map && typeof map === "object" ? Object.entries(map) : [[fallbackName, obj] as [string, unknown]];
  if (!entries.length) throw new Error("no servers found in the JSON");
  return entries.map(([name, cfg]) => ({ name, config: normalizeConfig(cfg) }));
}

function stringMap(v: unknown): Record<string, string> {
  if (!v) return {};
  if (typeof v === "string") {
    const out: Record<string, string> = {};
    for (const line of v.split(/\r?\n/)) {
      const i = line.indexOf("=");
      if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    return out;
  }
  if (typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, String(x)]));
  return {};
}

function splitArgs(s: string): string[] {
  return (s.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((a) => a.replace(/^["']|["']$/g, ""));
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function connect(config: McpConfig): Promise<Client> {
  const client = new Client({ name: "tandem", version: "0.1.0" });
  if (config.transport === "stdio") {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: { ...(process.env as Record<string, string>), ...config.env },
      cwd: config.cwd,
      stderr: "ignore",
    });
    await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, "connecting to the MCP server");
    return client;
  }
  try {
    const transport = new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers } });
    await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, "connecting to the MCP server");
    return client;
  } catch (first) {
    // Older servers speak SSE only.
    const fallback = new Client({ name: "tandem", version: "0.1.0" });
    const transport = new SSEClientTransport(new URL(config.url), { requestInit: { headers: config.headers } });
    try {
      await withTimeout(fallback.connect(transport), CONNECT_TIMEOUT_MS, "connecting to the MCP server");
      return fallback;
    } catch {
      throw first;
    }
  }
}

/** Connect, list tools, disconnect. Throws with a readable message when the server cannot be reached. */
export async function probeMcpServer(config: McpConfig): Promise<McpToolInfo[]> {
  const client = await connect(config);
  try {
    const res = await withTimeout(client.listTools(), CONNECT_TIMEOUT_MS, "listing tools");
    return res.tools.map((t) => ({
      name: t.name,
      description: (t.description ?? t.title ?? "").slice(0, 400),
      readOnly: Boolean(t.annotations?.readOnlyHint),
    }));
  } finally {
    await client.close().catch(() => undefined);
  }
}

/** Run one tool and return its text output. Used by the offline provider; Copilot runs tools itself. */
export async function callMcpTool(config: McpConfig, tool: string, args: Record<string, unknown>): Promise<{ ok: boolean; text: string }> {
  const client = await connect(config);
  try {
    const res = (await withTimeout(client.callTool({ name: tool, arguments: args }), CALL_TIMEOUT_MS, `running ${tool}`)) as {
      isError?: boolean;
      content?: { type: string; text?: string }[];
    };
    const text = (res.content ?? []).map((c) => (c.type === "text" ? c.text ?? "" : `[${c.type}]`)).join("\n").trim();
    return { ok: !res.isError, text: text || (res.isError ? "tool reported an error" : "done") };
  } finally {
    await client.close().catch(() => undefined);
  }
}

function view(row: typeof schema.mcpServers.$inferSelect): McpServerView {
  return {
    id: row.id,
    name: row.name,
    transport: row.transport,
    summary: row.summary,
    tools: row.tools ? (JSON.parse(row.tools) as McpToolInfo[]) : [],
    allow: parseAllow(row.allow),
    status: row.status,
    lastError: row.lastError,
    testedAt: row.testedAt,
    createdAt: row.createdAt,
  };
}

export function listMcpServers(userId: string): McpServerView[] {
  return db.select().from(schema.mcpServers).where(eq(schema.mcpServers.userId, userId)).all().map(view);
}

export function registerMcpServer(userId: string, name: string, config: McpConfig): McpServerView {
  const clean = name.trim().replace(/[^\w.-]+/g, "-").slice(0, 40);
  if (!clean) throw new Error("name required");
  const existing = db.select().from(schema.mcpServers).where(and(eq(schema.mcpServers.userId, userId), eq(schema.mcpServers.name, clean))).get();
  if (existing) db.delete(schema.mcpServers).where(eq(schema.mcpServers.id, existing.id)).run();
  const sealed = seal(JSON.stringify(config));
  const id = ulid();
  db.insert(schema.mcpServers)
    .values({ id, userId, name: clean, transport: config.transport, ciphertext: sealed.ciphertext, iv: sealed.iv, tag: sealed.tag, summary: summarize(config), tools: null, allow: existing?.allow ?? null, status: "untested", lastError: null, createdAt: now(), testedAt: null })
    .run();
  return view(db.select().from(schema.mcpServers).where(eq(schema.mcpServers.id, id)).get()!);
}

export function deleteMcpServer(userId: string, id: string) {
  db.delete(schema.mcpServers).where(and(eq(schema.mcpServers.id, id), eq(schema.mcpServers.userId, userId))).run();
}

export function loadMcpServer(userId: string, id: string): McpServerForTurn | null {
  const row = db.select().from(schema.mcpServers).where(and(eq(schema.mcpServers.id, id), eq(schema.mcpServers.userId, userId))).get();
  if (!row) return null;
  return { id: row.id, name: row.name, ownerUserId: row.userId, config: JSON.parse(unseal(row.ciphertext, row.iv, row.tag)) as McpConfig, tools: row.tools ? (JSON.parse(row.tools) as McpToolInfo[]) : [], allow: parseAllow(row.allow) };
}

/** Test a registered server: connect, list tools, remember the outcome. */
export async function testMcpServer(userId: string, id: string): Promise<McpServerView> {
  const s = loadMcpServer(userId, id);
  if (!s) throw new Error("server not found");
  try {
    const tools = await probeMcpServer(s.config);
    db.update(schema.mcpServers).set({ tools: JSON.stringify(tools), status: "ok", lastError: null, testedAt: now() }).where(eq(schema.mcpServers.id, id)).run();
  } catch (e) {
    db.update(schema.mcpServers).set({ status: "error", lastError: (e as Error).message.slice(0, 500), testedAt: now() }).where(eq(schema.mcpServers.id, id)).run();
  }
  return view(db.select().from(schema.mcpServers).where(eq(schema.mcpServers.id, id)).get()!);
}

/** The servers a turn may use: the speaker's own, tested and healthy. */
export function serversForUser(userId: string): McpServerForTurn[] {
  return db
    .select()
    .from(schema.mcpServers)
    .where(and(eq(schema.mcpServers.userId, userId), eq(schema.mcpServers.status, "ok")))
    .all()
    .map((row) => ({ id: row.id, name: row.name, ownerUserId: row.userId, config: JSON.parse(unseal(row.ciphertext, row.iv, row.tag)) as McpConfig, tools: row.tools ? (JSON.parse(row.tools) as McpToolInfo[]) : [], allow: parseAllow(row.allow) }));
}
