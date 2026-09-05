import { CopilotClient, approveAll, defineTool, type MCPServerConfig, type PermissionHandler } from "@github/copilot-sdk";
import type { McpServerForTurn } from "../mcp.js";

function toCopilotMcp(servers: McpServerForTurn[]): Record<string, MCPServerConfig> {
  const out: Record<string, MCPServerConfig> = {};
  for (const s of servers) {
    out[s.name] = s.config.transport === "stdio"
      ? { type: "stdio", command: s.config.command, args: s.config.args, env: s.config.env, workingDirectory: s.config.cwd, tools: ["*"] }
      : { type: "http", url: s.config.url, headers: s.config.headers, tools: ["*"] };
  }
  return out;
}
import { Semaphore } from "async-mutex";
import { config } from "../config.js";
import type { ProviderAdapter, TurnRequest, TurnResult } from "./types.js";

// GitHub Copilot adapter. One throwaway Copilot session per Tandem turn, funded by
// the payer's GitHub token. Verified against @github/copilot-sdk 1.0.x typings.

const turnSlots = new Semaphore(config.maxConcurrentTurns);

function makeClient(token: string) {
  return new CopilotClient({
    gitHubToken: token,
    useLoggedInUser: false,
    baseDirectory: config.copilotHome,
    mode: "empty",
    logLevel: "warning",
  });
}

const SUMMARY_SYSTEM = `You maintain the running brief of a multi-person software design session. You will be given the previous brief and a stretch of messages that are about to leave the model's context window. Produce the new brief in Markdown, under 350 words, that a colleague could read to catch up.

Rules:
- Keep attribution. Every point names who said it in bold and cites the event id in square brackets, e.g. "- **Alice** [01H...]: prefers Kafka for OrderPlaced".
- Merge the previous brief with the new stretch; drop points that were superseded, keep points that still matter, never invent anything.
- Sections: "### Discussion so far", "### Decisions recorded in this stretch" (label, status, who), "### Open questions".
- Terse lines, no preamble, no closing remarks. Output only the brief.`;

export const copilotProvider: ProviderAdapter = {
  id: "copilot",

  async summarize(req) {
    const [, release] = await turnSlots.acquire();
    const client = makeClient(req.token);
    try {
      await client.start();
      const session = await client.createSession({
        model: req.model,
        streaming: false,
        systemMessage: { mode: "replace", content: SUMMARY_SYSTEM },
        tools: [],
        availableTools: [],
        onPermissionRequest: approveAll,
        skipCustomInstructions: true,
        enableSkills: false,
      });
      try {
        const lines = [`# Session: ${req.title}`, "", "## Previous brief", req.previousBrief || "(none yet)", "", "## Messages leaving the window (oldest first)"];
        for (const m of req.messages) lines.push(`[${m.speaker}] (event ${m.eventId}) ${m.text}`);
        if (req.decisions.length) {
          lines.push("", "## Decisions recorded in this stretch");
          for (const d of req.decisions) lines.push(`- ${d.label} [${d.status}]${d.by ? ` by ${d.by}` : ""}: ${d.statement}`);
        }
        lines.push("", "Write the new brief now.");
        const final = await session.sendAndWait({ prompt: lines.join("\n") }, req.timeoutMs);
        return final?.data.content ?? "";
      } finally {
        await session.disconnect().catch(() => undefined);
      }
    } finally {
      await client.stop().catch(() => undefined);
      release();
    }
  },

  async validate(token) {
    const client = makeClient(token);
    try {
      await client.start();
      const models = await client.listModels();
      return { ok: true, models: models.map((m) => m.id) };
    } catch (e) {
      return { ok: false, models: [], error: (e as Error).message };
    } finally {
      await client.stop().catch(() => undefined);
    }
  },

  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const [, release] = await turnSlots.acquire();
    const client = makeClient(req.token);
    let text = "";
    let toolCallsCount = 0;
    const usage: TurnResult["usage"] = { inputTokens: 0, outputTokens: 0, premiumRequests: 1, model: req.model };
    let modelUsed = req.model;
    try {
      await client.start();
      const tools = req.tools.map((b) =>
        defineTool(b.name, {
          description: b.description,
          parameters: b.schema as never,
          skipPermission: true,
          handler: async (args: unknown) => {
            toolCallsCount += 1;
            return b.handler(args);
          },
        }),
      );
      // MCP tool calls come through the permission handler with the tool's read-only annotation;
      // writes are proposed to the tool's owner and denied unless approved.
      const byName = new Map(req.mcpServers.map((s) => [s.name, s]));
      const gated: PermissionHandler = async (request) => {
        if (request.kind !== "mcp") return approveAll(request, { sessionId: req.sessionId });
        const server = byName.get(request.serverName);
        if (!server) return { kind: "reject", feedback: "that server is not registered for this person" };
        const { callId, decision } = await req.external.ask(server, request.toolName, request.args, request.readOnly);
        if (decision !== "approved") return { kind: "reject", feedback: "the tool's owner did not approve this call; tell the user and stop" };
        pendingCalls.set(`${request.serverName}:${request.toolName}`, callId);
        return { kind: "approve-once" };
      };
      const pendingCalls = new Map<string, string>();
      const session = await client.createSession({
        model: req.model,
        streaming: true,
        systemMessage: { mode: "replace", content: req.context.system },
        tools,
        availableTools: req.tools.map((t) => t.name),
        onPermissionRequest: gated,
        skipCustomInstructions: true,
        enableSkills: false,
        ...(req.mcpServers.length ? { mcpServers: toCopilotMcp(req.mcpServers) } : {}),
      });
      const offDelta = session.on("assistant.message_delta", (e) => {
        text += e.data.deltaContent;
        req.onDelta(e.data.deltaContent);
      });
      const offUsage = session.on("assistant.usage", (e) => {
        usage.inputTokens = (usage.inputTokens ?? 0) + (e.data.inputTokens ?? 0);
        usage.outputTokens = (usage.outputTokens ?? 0) + (e.data.outputTokens ?? 0);
        if (e.data.model) modelUsed = e.data.model;
      });
      const toolNames = new Map<string, string>();
      const offStart = session.on("tool.execution_start", (e) => {
        toolNames.set(e.data.toolCallId, e.data.toolName ?? "tool");
        req.onToolProgress(e.data.toolName ?? "tool", "start");
      });
      const offDone = session.on("tool.execution_complete", (e) => {
        const name = toolNames.get(e.data.toolCallId) ?? "tool";
        req.onToolProgress(name, e.data.success ? "done" : "error");
        // MCP tools are named server/tool or server:tool depending on the runtime; match on the tool part.
        for (const [key, callId] of pendingCalls) {
          const tool = key.split(":")[1]!;
          if (name.endsWith(tool)) {
            pendingCalls.delete(key);
            const result = (e.data as { result?: unknown }).result;
            req.external.done(callId, Boolean(e.data.success), typeof result === "string" ? result.slice(0, 500) : e.data.success ? "completed" : "failed");
          }
        }
      });
      const onAbort = () => void session.abort().catch(() => undefined);
      req.signal.addEventListener("abort", onAbort, { once: true });
      try {
        const attachments = req.context.attachments.map((a) => ({ type: "file" as const, path: a.path, displayName: a.displayName }));
        const final = await session.sendAndWait({ prompt: req.context.prompt, ...(attachments.length ? { attachments } : {}) }, req.timeoutMs);
        if (!text && final?.data.content) text = final.data.content;
      } finally {
        req.signal.removeEventListener("abort", onAbort);
        offDelta();
        offUsage();
        offStart();
        offDone();
        await session.disconnect().catch(() => undefined);
      }
      return { text, toolCallsCount, usage, modelUsed };
    } finally {
      await client.stop().catch(() => undefined);
      release();
    }
  },
};
