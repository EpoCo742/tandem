import { CopilotClient, approveAll, defineTool } from "@github/copilot-sdk";
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

export const copilotProvider: ProviderAdapter = {
  id: "copilot",

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
      const session = await client.createSession({
        model: req.model,
        streaming: true,
        systemMessage: { mode: "replace", content: req.context.system },
        tools,
        availableTools: req.tools.map((t) => t.name),
        onPermissionRequest: approveAll,
        skipCustomInstructions: true,
        enableSkills: false,
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
      const offDone = session.on("tool.execution_complete", (e) => req.onToolProgress(toolNames.get(e.data.toolCallId) ?? "tool", e.data.success ? "done" : "error"));
      const onAbort = () => void session.abort().catch(() => undefined);
      req.signal.addEventListener("abort", onAbort, { once: true });
      try {
        const final = await session.sendAndWait({ prompt: req.context.prompt }, req.timeoutMs);
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
