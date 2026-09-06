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
  kind: z.enum(["context", "container", "component", "sequence", "deployment"]),
  environment: z.string().optional().describe("Deployment view: which environment to draw (default the first)"),
  direction: z.enum(["TB", "LR"]).optional().describe("Flowchart direction; leave unset to let the shape of the model decide"),
  focus: z.string().optional().describe("Component id: the subject of a component view, or the starting component of a sequence view"),
  depth: z.number().int().min(1).max(6).optional().describe("Sequence view: hops to follow from the start (default 3)"),
  note: z.string().optional().describe("Caption under the diagram"),
  sections: z.array(sectionSchema),
});

export const codeContentSchema = z.object({
  language: z.string(),
  source: z.string(),
  sections: z.array(sectionSchema),
});

export const contractContentSchema = z.object({
  format: z.enum(["openapi", "asyncapi", "json_schema", "graphql", "proto", "markdown", "other"]),
  body: z.string().describe("The contract text: an OpenAPI or AsyncAPI fragment, a schema, or plain Markdown"),
  attachedTo: z.object({ relationshipId: z.string().optional(), componentId: z.string().optional() }).optional().describe("The relationship it governs (from the model's relationship ids) or the component that exposes it"),
  version: z.string().optional().describe("The contract's own version label"),
  sections: z.array(sectionSchema),
});

export const createArtifactInput = z.object({
  type: z.enum(["mermaid", "markdown", "data_model", "code", "design_doc", "view", "contract"]).describe("design_doc is a Markdown document assembled from the canvas; use markdownContent for it. view is a diagram generated from the architecture model; use viewContent. contract is an API or event contract attached to a relationship or component; prefer upsert_contract"),
  title: z.string(),
  content: z.union([mermaidContentSchema, markdownContentSchema, dataModelContentSchema, codeContentSchema, viewContentSchema, contractContentSchema]),
  rationale: z.string().describe("One sentence on why this artifact exists"),
  summary: z.string().describe("One line describing the artifact for the index"),
});

export const updateArtifactInput = z.object({
  artifactId: z.string(),
  baseVersionNo: z.number().int().describe("The version you read; the update is rejected as stale if it moved"),
  content: z.union([mermaidContentSchema, markdownContentSchema, dataModelContentSchema, codeContentSchema, viewContentSchema, contractContentSchema]),
  rationale: z.string(),
  summary: z.string(),
});

export const upsertContractInput = z.object({
  title: z.string().describe("e.g. 'Payment gateway API', 'OrderPlaced event'"),
  format: z.enum(["openapi", "asyncapi", "json_schema", "graphql", "proto", "markdown", "other"]),
  body: z.string().optional().describe("The contract document itself, verbatim (the OpenAPI/AsyncAPI YAML or JSON, the schema, the SDL). Never a summary or a Markdown description of it. Omit when sourceArtifactId is given."),
  sourceArtifactId: z.string().optional().describe("The uploaded source card that holds the document; its text becomes the body unchanged. Use this whenever the contract came from a file."),
  attachedTo: z.object({ relationshipId: z.string().optional(), componentId: z.string().optional() }).describe("Exactly one of: the relationship id the contract governs, or the component id that exposes it"),
  version: z.string().optional(),
  derivedFrom: z.array(z.string()),
  rationale: z.string(),
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
    .array(z.object({ id: z.string(), name: z.string().optional(), kind: z.enum(["system", "team", "zone", "other"]).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe("Hex tint used in every view; omit to keep the palette colour"), region: z.string().optional().describe("Where it runs: EU, US, UK, DE, ... Residency constraints check flows against it"), trust: z.enum(["public", "internal", "restricted"]).optional().describe("public = internet-facing; security constraints check sensitive flows against it") }))
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
        dataClasses: z.array(z.enum(["pii", "payment", "health", "credentials", "confidential", "internal", "public"])).optional().describe("What the flow carries. Residency and security constraints are checked against this on every change, so classify whenever people say what data moves"),
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
  revisitAt: z.string().optional().describe("ISO date (YYYY-MM-DD) by which the decision should be looked at again, when people say so"),
});

export const recordAssumptionInput = z.object({
  statement: z.string().describe("What is believed true but not decided, e.g. 'the payment gateway is idempotent'"),
  ownerUserId: z.string().describe("The participant who stated it; they revisit it"),
  revisitAt: z.string().optional().describe("ISO date (YYYY-MM-DD) by which it should be checked, when stated"),
  evidence: z.array(z.string()).describe("Ledger event ids of the messages that stated it"),
  about: z.array(z.string()).optional().describe("Architecture model component ids it concerns"),
});

export const resolveAssumptionInput = z.object({
  assumptionId: z.string(),
  outcome: z.enum(["confirmed", "refuted", "decided"]),
  decisionId: z.string().optional().describe("When outcome is decided: the decision that replaced it"),
  note: z.string().optional().describe("One line on what settled it"),
  evidence: z.array(z.string()).optional().describe("Ledger event ids of the messages that settled it"),
});

export const resolveQuestionInput = z.object({
  questionId: z.string().describe("The question's id (or its Q-nn label) from the Open questions section"),
  answer: z.string().describe("The answer as the person gave it, one or two sentences"),
  evidence: z.array(z.string()).optional().describe("Ledger event ids of the messages that answered it"),
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

export const upsertDeploymentInput = z.object({
  environment: z.string().optional().describe("production, staging, ...; default production"),
  nodes: z
    .array(z.object({ id: z.string(), name: z.string().optional(), kind: z.enum(["region", "zone", "cluster", "vm", "managed", "device", "other"]).optional(), parent: z.string().optional().describe("Node id this one sits in (a cluster in a region)"), region: z.string().optional().describe("EU, US, UK, ...; children inherit it"), trust: z.enum(["public", "internal", "restricted"]).optional(), technology: z.string().optional().describe("AKS, EC2, RDS Postgres, ...") }))
    .optional()
    .describe("Nodes to add or update"),
  placements: z.array(z.object({ componentId: z.string(), nodeId: z.string() })).optional().describe("Which node each component runs on in this environment"),
  derivedFrom: z.array(z.string()),
  rationale: z.string(),
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
  upsert_contract: upsertContractInput,
  upsert_deployment: upsertDeploymentInput,
  record_assumption: recordAssumptionInput,
  resolve_assumption: resolveAssumptionInput,
  resolve_question: resolveQuestionInput,
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
  ask_clarification: "Ask the people a specific question you cannot act without, or one the group should settle later. It is recorded as Q-nn in the Questions register, where people answer it; never repeat an open question in a later reply.",
  resolve_question: "Mark an open question from the Open questions section as answered when someone's message answers it; pass the answer as they gave it.",
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
  upsert_deployment:
    "Record where components run: environments, nodes (regions, zones, clusters, machines, managed services, nested by parent) and the placement of each component per environment. Use when people say 'X runs on Y', 'the database is RDS in eu-west-1', 'the gateway is internet-facing'. Placement drives the residency and security checks; the deployment view draws it. Create a view of kind deployment the first time.",
  record_assumption:
    "Record something a participant believes true but has not decided ('we assume the gateway is idempotent', 'presumably the data is under 10 GB'). Owned by whoever said it, with a revisit date when they gave one. Contradicted later, it is settled with resolve_assumption; decided later, it becomes a decision.",
  resolve_assumption:
    "Settle an open assumption: confirmed (it held), refuted (it did not; say what showed it), or decided (a decision replaced it; pass the decision id). Use when a message contradicts or confirms an assumption in the registry.",
  upsert_contract:
    "Record an API or event contract as a card attached to the relationship it governs or the component that exposes it. The body is the document itself, verbatim: pass sourceArtifactId for an uploaded file (the server copies its text; do not retype or summarise it), or the full OpenAPI/AsyncAPI/schema text as written. A body that is prose or Markdown about the API is wrong. The result names the consumers and the format detected from the content.",
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
  | { status: "asked"; questionId: string; label: string }
  | { status: "question_resolved"; questionId: string; label: string }
  | { status: "content"; artifactId: string; versionNo: number; content: unknown }
  | { status: "pinned"; artifactId: string; pinned: boolean }
  | { status: "model_updated"; artifactId: string; versionNo: number; components: number; relationships: number; unknown?: string[]; impact?: Record<string, string[]> }
  | { status: "adrs"; files: { filename: string; markdown: string; label: string }[] }
  | { status: "constraints_updated"; artifactId: string; versionNo: number; constraints: { id: string; statement: string }[] }
  | { status: "alternatives_proposed"; artifactId: string; candidates: { id: string; title: string }[] }
  | { status: "as_is_set"; artifactId: string; versionNo: number; components: number; relationships: number; modelReplaced: boolean; diffViewArtifactId: string }
  | { status: "library_results"; hits: LibraryHit[]; searched: { sessions: number; publicSessions: number } }
  | { status: "contract_recorded"; artifactId: string; versionNo: number; consumers: string[]; format: string; bodyFrom?: string }
  | { status: "assumption_recorded"; assumptionId: string; label: string }
  | { status: "assumption_resolved"; assumptionId: string; label: string; outcome: string }
  | { status: "error"; message: string };
