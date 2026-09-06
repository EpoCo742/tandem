import { z } from "zod";
import type { LibraryHit } from "./library.js";

/** Provenance for anything copied out of the library; pass a search hit's importRef through unchanged. */
export const importedFromInput = z
  .object({ sessionId: z.string(), sessionTitle: z.string(), kind: z.enum(["decision", "component", "constraint", "document"]), refId: z.string() })
  .describe("Where this was copied from: the importRef of a library_search hit, unchanged");

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
      ownedBy: z.string().optional().describe("Architecture model component id that owns this entity"),
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

export const viewContentSchema = z.object({
  kind: z.enum(["context", "container", "component"]),
  focus: z.string().optional().describe("Component id, for a component view"),
  note: z.string().optional().describe("Caption under the diagram"),
  sections: z.array(sectionSchema),
});

export const codeContentSchema = z.object({
  language: z.string(),
  source: z.string(),
  sections: z.array(sectionSchema),
});

export const createArtifactInput = z.object({
  type: z.enum(["mermaid", "markdown", "data_model", "code", "design_doc", "view"]).describe("design_doc is a Markdown document assembled from the canvas; use markdownContent for it. view is a diagram generated from the architecture model; use viewContent"),
  title: z.string(),
  content: z.union([mermaidContentSchema, markdownContentSchema, dataModelContentSchema, codeContentSchema, viewContentSchema]),
  rationale: z.string().describe("One sentence on why this artifact exists"),
  summary: z.string().describe("One line describing the artifact for the index"),
});

export const updateArtifactInput = z.object({
  artifactId: z.string(),
  baseVersionNo: z.number().int().describe("The version you read; the update is rejected as stale if it moved"),
  content: z.union([mermaidContentSchema, markdownContentSchema, dataModelContentSchema, codeContentSchema, viewContentSchema]),
  rationale: z.string(),
  summary: z.string(),
});

const componentKind = z.enum(["service", "database", "queue", "external", "ui", "person", "storage", "function", "other"]);
const relationshipKind = z.enum(["calls", "publishes", "subscribes", "reads", "writes", "uses", "depends_on"]);

export const upsertComponentsInput = z.object({
  components: z
    .array(
      z.object({
        id: z.string().optional().describe("Stable slug; omit to derive from the name. Pass an existing id to rename or re-describe a component"),
        name: z.string(),
        kind: componentKind,
        description: z.string().optional(),
        technology: z.string().optional().describe("e.g. 'Kafka', 'PostgreSQL 16', 'Node service'"),
        boundary: z.string().optional().describe("Boundary id (a system, team or trust zone); created if new"),
        importedFrom: importedFromInput.optional(),
      }),
    )
    .min(1),
  boundaries: z
    .array(z.object({ id: z.string(), name: z.string().optional(), kind: z.enum(["system", "team", "zone", "other"]).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe("Hex tint used in every view; omit to keep the palette colour") }))
    .optional()
    .describe("Boundaries to add or update (name, kind, colour); components reference them by id"),
  derivedFrom: z.array(z.string()).describe("Ledger event ids of the messages that motivated this"),
  rationale: z.string(),
});

export const upsertRelationshipsInput = z.object({
  relationships: z
    .array(
      z.object({
        from: z.string().describe("Component id"),
        to: z.string().describe("Component id"),
        kind: relationshipKind,
        label: z.string().optional().describe("e.g. 'OrderPlaced', 'REST', 'nightly batch'"),
      }),
    )
    .min(1),
  derivedFrom: z.array(z.string()),
  rationale: z.string(),
});

export const removeFromModelInput = z.object({
  componentIds: z.array(z.string()).optional(),
  relationshipIds: z.array(z.string()).optional(),
  rationale: z.string(),
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
  about: z.array(z.string()).optional().describe("Architecture model component ids this decision concerns"),
  context: z.string().optional().describe("ADR context: the situation and forces that called for a decision, two or three sentences"),
  options: z
    .array(z.object({ title: z.string(), tradeoffs: z.string().optional(), chosen: z.boolean().optional() }))
    .optional()
    .describe("ADR options considered, with the chosen one marked"),
  consequences: z.string().optional().describe("ADR consequences: what becomes easier or harder because of this decision"),
  importedFrom: importedFromInput.optional(),
});

const constraintKind = z.enum(["must", "must_not", "target"]);
const constraintCategory = z.enum(["latency", "availability", "data_residency", "security", "compliance", "budget", "platform", "capacity", "other"]);

export const upsertConstraintsInput = z.object({
  constraints: z
    .array(
      z.object({
        id: z.string().optional().describe("Existing constraint id (C-01) to update; omit to add"),
        statement: z.string().describe("One sentence, testable: 'No customer data leaves the EU'"),
        kind: constraintKind,
        category: constraintCategory,
        value: z.string().optional().describe("The measurable part, e.g. 'p95 < 200 ms'"),
        source: z.string().optional().describe("Event id of the message, or artifact id of the uploaded document, that established it"),
        exceptionTo: z.string().optional().describe("Id of the constraint this one relaxes (C-01). Use this instead of editing someone else's constraint; it is proposed to whoever set that constraint"),
        importedFrom: importedFromInput.optional(),
      }),
    )
    .min(1),
  derivedFrom: z.array(z.string()),
  rationale: z.string(),
});

export const setAsIsInput = z.object({
  source: z.string().describe("Where the as-is came from: 'repo:owner/name@ref' or 'upload:docker-compose.yml'"),
  components: z.array(
    z.object({
      id: z.string().optional(),
      name: z.string(),
      kind: componentKind,
      technology: z.string().optional(),
      description: z.string().optional(),
      boundary: z.string().optional(),
    }),
  ).min(1),
  relationships: z.array(z.object({ from: z.string(), to: z.string(), kind: relationshipKind, label: z.string().optional() })),
  notes: z.array(z.string()).optional().describe("What was read and what was inferred, for people to check"),
  replaceModel: z.boolean().optional().describe("Also make the model equal to the as-is (default: only when the model is still empty)"),
  derivedFrom: z.array(z.string()),
  rationale: z.string(),
});

export const proposeAlternativesInput = z.object({
  question: z.string().describe("What is being decided, as a question: 'How should orders reach fulfilment?'"),
  candidates: z
    .array(
      z.object({
        title: z.string().describe("Short name: 'Event-driven with Kafka'"),
        summary: z.string().describe("One or two sentences on the shape of this candidate"),
        components: z.array(
          z.object({
            id: z.string().optional().describe("Stable slug; reuse the current model's ids for components that carry over"),
            name: z.string(),
            kind: componentKind,
            technology: z.string().optional(),
            boundary: z.string().optional(),
          }),
        ).min(1),
        relationships: z.array(z.object({ from: z.string(), to: z.string(), kind: relationshipKind, label: z.string().optional() })),
        pros: z.array(z.string()),
        cons: z.array(z.string()),
        constraintsMet: z.array(z.string()).optional().describe("Constraint ids (C-01) this candidate satisfies"),
        constraintsAtRisk: z.array(z.string()).optional().describe("Constraint ids this candidate strains or breaks"),
      }),
    )
    .min(2)
    .max(3),
  derivedFrom: z.array(z.string()),
  rationale: z.string(),
});

export const removeConstraintsInput = z.object({
  constraintIds: z.array(z.string()).min(1),
  rationale: z.string(),
});

export const renderAdrInput = z.object({
  decisionId: z.string().optional().describe("One decision; omit for every decision in the registry"),
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
  violatesConstraintIds: z.array(z.string()).optional().describe("Constraint ids (C-01) the directive would break, when that is why the point is raised"),
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

export const librarySearchInput = z.object({
  query: z.string().describe("A few words: a technology, a concern, a component name. Empty returns the most recent entries"),
  kind: z.enum(["decision", "component", "constraint", "document"]).optional(),
  limit: z.number().int().min(1).max(20).optional(),
  excludeThisSession: z.boolean().optional().describe("Leave out this session's own entries (when looking for precedent elsewhere)"),
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
  upsert_components: upsertComponentsInput,
  upsert_relationships: upsertRelationshipsInput,
  remove_from_model: removeFromModelInput,
  render_adr: renderAdrInput,
  upsert_constraints: upsertConstraintsInput,
  remove_constraints: removeConstraintsInput,
  propose_alternatives: proposeAlternativesInput,
  set_as_is: setAsIsInput,
  library_search: librarySearchInput,
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
  upsert_components:
    "Add components to the session's architecture model, or update existing ones by id (rename, change kind, describe, move into a boundary). The model is the source of truth for structure; diagrams are views of it. Prefer this over drawing free Mermaid for system structure.",
  upsert_relationships: "Add or update relationships between components of the architecture model by component id. Both ends must exist; the result names any unknown ids.",
  remove_from_model: "Remove components (and their relationships) or specific relationships from the architecture model. The result lists what referred to each removed component (decisions, constraints, views, documents, threads); tell people what now points at nothing.",
  render_adr:
    "Render decisions as architecture decision record files (filename + Markdown), ready to write into a repository's docs/adr with an external tool. Omit decisionId to get all of them.",
  upsert_constraints:
    "Record non-functional targets and hard limits the design must respect (latency, data residency, budget, mandated platforms, compliance). Use when a person states one, or when an uploaded document contains one (cite it as the source). Every later change is checked against these. To relax someone else's constraint, add a new one with exceptionTo; amending a constraint another person set is proposed to that person and applies only when they approve.",
  set_as_is:
    "Record the architecture as it exists today (read from a repository's manifests or a deployment file) as the model's as-is baseline. When the model is still empty it becomes the model too; otherwise the model stays the target state and the 'As-is vs to-be' view shows the difference. Read only manifests (package.json, docker-compose, go.mod, pom.xml, terraform, k8s), never whole source trees.",
  propose_alternatives:
    "Put two or three candidate architectures side by side on one card, each a complete model of its own with what speaks for and against it and which constraints it meets or puts at risk. The architecture model is not changed; people choose with the card's Decide button, the majority's pick becomes the model and the decision is recorded automatically.",
  library_search:
    "Search the organisation library: decisions, model components, constraints and published design documents from the speaker's other sessions and from every session that published a document. Read only. Cite hits by session title and the people named; to copy one in, use record_decision, upsert_components or upsert_constraints with the hit's importRef as importedFrom.",
  remove_constraints: "Drop constraints that no longer apply. Removing a constraint someone else set is proposed to that person. Prefer an exception (upsert_constraints with exceptionTo) or a decision when people disagree.",
};

export type ToolResult =
  | { status: "applied"; artifactId: string; versionNo: number; title: string }
  | { status: "pending_approval"; proposalId: string; artifactId: string; approvers: string[] }
  | { status: "stale"; artifactId: string; currentVersionNo: number; message: string }
  | { status: "blocked_by_decision_point"; artifactId: string; decisionPointArtifactId: string }
  | { status: "invalid_content"; artifactId: string; message: string }
  | { status: "recorded"; decisionId: string; label: string }
  | { status: "asked" }
  | { status: "content"; artifactId: string; versionNo: number; content: unknown }
  | { status: "pinned"; artifactId: string; pinned: boolean }
  | { status: "model_updated"; artifactId: string; versionNo: number; components: number; relationships: number; unknown?: string[]; impact?: Record<string, string[]> }
  | { status: "adrs"; files: { filename: string; markdown: string; label: string }[] }
  | { status: "constraints_updated"; artifactId: string; versionNo: number; constraints: { id: string; statement: string }[] }
  | { status: "alternatives_proposed"; artifactId: string; candidates: { id: string; title: string }[] }
  | { status: "as_is_set"; artifactId: string; versionNo: number; components: number; relationships: number; modelReplaced: boolean; diffViewArtifactId: string }
  | { status: "library_results"; hits: LibraryHit[]; searched: { sessions: number; publicSessions: number } }
  | { status: "error"; message: string };
