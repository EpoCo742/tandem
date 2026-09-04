import type { z } from "zod";
import type { ToolResult, Usage } from "@tandem/shared";

export interface ToolBinding {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  handler: (input: unknown) => Promise<ToolResult>;
}

export interface RenderedContext {
  system: string; // frozen protocol
  prompt: string; // brief + decisions + artifact index + transcript + current batch
}

export interface TurnRequest {
  sessionId: string;
  turnId: string;
  model: string;
  token: string;
  context: RenderedContext;
  tools: ToolBinding[];
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

export interface ProviderAdapter {
  id: string;
  validate(token: string): Promise<{ ok: boolean; models: string[]; error?: string }>;
  runTurn(req: TurnRequest): Promise<TurnResult>;
}
