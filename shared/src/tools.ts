import { z } from "zod";

// Canvas tools the AI can call. Schemas are shared by every provider adapter
// and by the executor's validation.

const sectionSchema = z.object({
  id: z.string().describe("Stable short id for the section, e.g. 'overview', 'svc-a'"),
  heading: z.string().optional(),
  derivedFrom: z.array(z.string()).describe("Ledger event ids of the messages that motivated this section"),
});

export const mermaidContentSchema = z.object({
  source: z.string().describe("Valid Mermaid source. One concern per diagram."),
  kind: z.enum(["flowchart", "sequence", "class", "er", "state", "c4", "other"]),
  sections: z.array(sectionSchema),
});

export const markdownContentSchema = z.object({
  markdown: z.string(),
  sections: z.array(sectionSchema),
});

export const dataModelContentSchema = z.object({
  entities: z.array(
    z.object({
      name: z.string(),
      fields: z.array(
        z.object({
          name: z.string(),
          type: z.string(),
          pk: z.boolean().optional(),
          fk: z.string().optional(),
          nullable: z.boolean().optional(),
        }),
      ),
      derivedFrom: z.array(z.string()),
    }),
  ),
  relations: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      cardinality: z.enum(["1-1", "1-n", "n-n"]),
      label: z.string().optional(),
      derivedFrom: z.array(z.string()),
    }),
  ),
  sections: z.array(sectionSchema),
});

export const codeContentSchema = z.object({
  language: z.string(),
  source: z.string(),
  sections: z.array(sectionSchema),
});

export const createArtifactInput = z.object({
  type: z.enum(["mermaid", "markdown", "data_model", "code", "design_doc"]).describe("design_doc is a Markdown document assembled from the canvas; use markdownContent for it"),
  title: z.string(),
  content: z.union([mermaidContentSchema, markdownContentSchema, dataModelContentSchema, codeContentSchema]),
  rationale: z.string().describe("One sentence on why this artifact exists"),
  summary: z.string().describe("One line describing the artifact for the index"),
});

export const updateArtifactInput = z.object({
  artifactId: z.string(),
  baseVersionNo: z.number().int().describe("The version you read; the update is rejected as stale if it moved"),
  content: z.union([mermaidContentSchema, markdownContentSchema, dataModelContentSchema, codeContentSchema]),
  rationale: z.string(),
  summary: z.string(),
});

export const deleteArtifactInput = z.object({
  artifactId: z.string(),
  rationale: z.string(),
});

export const recordDecisionInput = z.object({
  statement: z.string().describe("A single settled statement, e.g. 'Kafka is the event bus between A and B'"),
  status: z.enum(["proposed", "agreed"]),
  agreedBy: z.array(z.string()).describe("User ids of participants who stated or accepted it. 'agreed' requires every listed user to have authored evidence"),
  supersedes: z.string().nullable().describe("Decision id this replaces, or null"),
  evidence: z.array(z.string()).describe("Ledger event ids of the messages that establish it"),
});

export const createDecisionPointInput = z.object({
  question: z.string(),
  context: z.string().describe("Neutral statement of the disagreement and what it affects"),
  options: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        tradeoffs: z.string(),
        canvasImpact: z.string(),
        proposedBy: z.string().optional(),
      }),
    )
    .min(2),
  blocksArtifactIds: z.array(z.string()).describe("Artifacts that must not change until this is resolved"),
  directiveEventIds: z.array(z.string()),
  contradictsDecisionId: z.string().nullable(),
});

export const askClarificationInput = z.object({
  question: z.string(),
  addressedTo: z.array(z.string()).describe("User ids"),
});

export const readArtifactInput = z.object({
  artifactId: z.string(),
  versionNo: z.number().int().optional(),
});

export const pinArtifactInput = z.object({
  artifactId: z.string(),
  pinned: z.boolean(),
});

export const toolSchemas = {
  create_artifact: createArtifactInput,
  update_artifact: updateArtifactInput,
  delete_artifact: deleteArtifactInput,
  record_decision: recordDecisionInput,
  create_decision_point: createDecisionPointInput,
  ask_clarification: askClarificationInput,
  read_artifact: readArtifactInput,
  pin_artifact: pinArtifactInput,
} as const;

export type ToolName = keyof typeof toolSchemas;
export type ToolInput<N extends ToolName> = z.infer<(typeof toolSchemas)[N]>;

export const toolDescriptions: Record<ToolName, string> = {
  create_artifact:
    "Create a new artifact card on the shared canvas (Mermaid diagram, Markdown note, data model, or code). Prefer update_artifact when a card on the same concern already exists.",
  update_artifact:
    "Replace the content of an existing artifact. Pass the version number you read. If someone else owns the artifact the change may become a proposal awaiting their approval; the result tells you which.",
  delete_artifact: "Remove an artifact from the canvas (soft delete, restorable). Always requires approval.",
  record_decision:
    "Record a settled statement in the decision registry. Use status 'agreed' only when every listed participant stated or accepted it in the transcript; otherwise 'proposed'.",
  create_decision_point:
    "Raise a decision point when a directive contradicts an agreed decision or two participants disagree. Do not apply the contested change; list at least two options with trade-offs.",
  ask_clarification: "Ask one or more participants a specific question before acting.",
  read_artifact: "Read the full content of an artifact that is not included in the index.",
  pin_artifact: "Pin or unpin an artifact so its full content is always in context.",
};

export type ToolResult =
  | { status: "applied"; artifactId: string; versionNo: number; title: string }
  | { status: "pending_approval"; proposalId: string; artifactId: string; approvers: string[] }
  | { status: "stale"; artifactId: string; currentVersionNo: number; message: string }
  | { status: "blocked_by_decision_point"; artifactId: string; decisionPointArtifactId: string }
  | { status: "recorded"; decisionId: string; label: string }
  | { status: "asked" }
  | { status: "content"; artifactId: string; versionNo: number; content: unknown }
  | { status: "pinned"; artifactId: string; pinned: boolean }
  | { status: "error"; message: string };
