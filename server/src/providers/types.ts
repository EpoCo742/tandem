import type { z } from "zod";
import type { ToolResult, Usage } from "@tandem/shared";
import type { McpServerForTurn } from "../mcp.js";

export interface ToolBinding {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  handler: (input: unknown) => Promise<ToolResult>;
}

export interface ContextAttachment {
  path: string; // local file the provider may hand to the model (images, large documents)
  displayName: string;
  mime: string;
  artifactId: string;
}

export interface RenderedContext {
  system: string; // frozen protocol
  prompt: string; // brief + decisions + artifact index + transcript + current batch
  attachments: ContextAttachment[]; // files referenced by the current batch
}

export interface ExternalGate {
  /** Ask before an outbound call; resolves to the decision. Reads resolve at once. */
  ask(server: McpServerForTurn, toolName: string, args: unknown, readOnly: boolean): Promise<{ callId: string; decision: "approved" | "denied" }>;
  /** Record what happened after an approved call ran. */
  done(callId: string, ok: boolean, summary: string): void;
}

export interface TurnRequest {
  sessionId: string;
  turnId: string;
  model: string;
  token: string;
  context: RenderedContext;
  tools: ToolBinding[];
  /** The speaker's own MCP servers, tested and healthy. Empty when they have none. */
  mcpServers: McpServerForTurn[];
  external: ExternalGate;
  signal: AbortSignal;
  timeoutMs: number;
  onDelta: (text: string) => void;
  onToolProgress: (tool: string, status: "start" | "done" | "error", artifactId?: string) => void;
}

export interface TurnResult {
  text: string;
  toolCallsCount: number;
  usage: Usage;
  modelUsed: string;
}

export interface SummaryMessage {
  eventId: string;
  seq: number;
  kind: "user" | "ai" | "clarification" | "system";
  speaker: string;
  text: string;
}

export interface SummaryRequest {
  sessionId: string;
  model: string;
  token: string;
  title: string;
  previousBrief: string;
  messages: SummaryMessage[]; // the messages being folded, oldest first
  decisions: { label: string; statement: string; status: string; by: string }[];
  timeoutMs: number;
}

export interface ProviderAdapter {
  id: string;
  validate(token: string): Promise<{ ok: boolean; models: string[]; error?: string }>;
  runTurn(req: TurnRequest): Promise<TurnResult>;
  /** Fold older messages into a running brief that keeps speaker attribution and event ids. */
  summarize?(req: SummaryRequest): Promise<string>;
}
