import type { ArtifactType } from "./events.js";
import type { AlternativesContent, ConstraintCategory, ConstraintKind, ConstraintsContent } from "./artifacts.js";
import type { ArchModelContent, ComponentKind } from "./model.js";
import { liveArtifacts, type SessionState } from "./reducer.js";

// Session templates: what kind of design this is, the constraints it starts with, and the
// checklist a whole design of that kind needs. The checklist is derived from the ledger state,
// never stored, so it is always right; the AI sees it in every turn and steers toward the gaps,
// and people see it in the side pane.

export type TemplateId = "new_service" | "integration" | "data_migration" | "platform_change";

export interface SeedConstraint {
  statement: string;
  kind: ConstraintKind;
  category: ConstraintCategory;
  value?: string;
}

export type ChecklistCheck =
  | { kind: "artifact"; types: ArtifactType[]; titleMatch?: string; contentMatch?: string; typesAny?: ArtifactType[] } // typesAny: these types count on their own, whatever the title
  | { kind: "model"; minComponents: number; requireKind?: ComponentKind }
  | { kind: "constraints"; min: number; category?: ConstraintCategory }
  | { kind: "decisions"; min: number; agreed?: boolean }
  | { kind: "review"; status: "approved" }
  | { kind: "as_is" }
  | { kind: "alternatives_chosen" };

export interface ChecklistItem {
  id: string;
  title: string;
  hint: string; // what to ask for, in the words a person would use
  check: ChecklistCheck;
}

export interface SessionTemplate {
  id: TemplateId;
  name: string;
  summary: string;
  seedConstraints: SeedConstraint[];
  checklist: ChecklistItem[];
  guidance: string; // one paragraph for the AI about what a whole design of this kind covers
  starters: string[]; // first prompts an empty canvas suggests, in the order the checklist wants them
}

/** What an empty blank session suggests. */
export const BLANK_STARTERS = [
  "Service A publishes an OrderPlaced event to Kafka; Service B subscribes and writes to Postgres.",
  "No customer data must leave the EU.",
  "Draft the data model from what we have said so far.",
];

const common = {
  model: (min = 2): ChecklistItem => ({ id: "model", title: "Architecture model", hint: `Describe the systems involved; the model needs at least ${min} components`, check: { kind: "model", minComponents: min } }),
  view: (): ChecklistItem => ({ id: "view", title: "System architecture view", hint: "A container view of the model (the AI draws it when the model exists)", check: { kind: "artifact", types: ["view"] } }),
  constraints: (min = 1, category?: ConstraintCategory): ChecklistItem => ({ id: category ? `constraints-${category}` : "constraints", title: category ? `${category.replace("_", " ")} constraint` : "Constraints", hint: category ? `State the ${category.replace("_", " ")} limit the design must respect` : "State the non-functional targets and hard limits", check: { kind: "constraints", min, ...(category ? { category } : {}) } }),
  decisions: (min: number): ChecklistItem => ({ id: "decisions", title: `${min} agreed decisions`, hint: "Settle the open questions; the AI records what the group agrees", check: { kind: "decisions", min, agreed: true } }),
  doc: (): ChecklistItem => ({ id: "doc", title: "Design document compiled", hint: "Compile design doc from the top bar once the canvas holds the design", check: { kind: "artifact", types: ["design_doc"] } }),
  approved: (): ChecklistItem => ({ id: "approved", title: "Design document signed off", hint: "Request review on the document; the named reviewers sign", check: { kind: "review", status: "approved" } }),
  asIs: (): ChecklistItem => ({ id: "as_is", title: "As-is baseline", hint: "Ask for the current architecture of the repository (needs a read-only repo tool) or attach a deployment file", check: { kind: "as_is" } }),
  card: (id: string, title: string, hint: string, titleMatch: string, types: ArtifactType[] = ["markdown", "mermaid"], contentMatch?: string): ChecklistItem => ({ id, title, hint, check: { kind: "artifact", types, titleMatch, ...(contentMatch ? { contentMatch } : {}) } }),
};

export const TEMPLATES: Record<TemplateId, SessionTemplate> = {
  new_service: {
    id: "new_service",
    name: "New service",
    summary: "A service that does not exist yet: its place in the landscape, its data, its API, how it is run.",
    seedConstraints: [
      { statement: "Every call into the service is authenticated and authorised", kind: "must", category: "security" },
      { statement: "The service exposes health and readiness endpoints and emits structured logs and metrics", kind: "must", category: "platform" },
    ],
    checklist: [
      common.model(3),
      common.view(),
      { id: "datamodel", title: "Data model", hint: "Ask the AI to draft the data model from what has been said", check: { kind: "artifact", types: ["data_model"] } },
      { id: "api", title: "API contract", hint: "Describe the endpoints or events the service exposes; the AI records a contract card, or add one by hand", check: { kind: "artifact", types: ["markdown", "mermaid"], titleMatch: "api|contract|interface|endpoint", typesAny: ["contract"] } },
      common.constraints(1),
      { id: "deployment", title: "Deployment view", hint: "Say where the service runs (cluster, machine, managed service, region, environment)", check: { kind: "artifact", types: ["view"], contentMatch: '"kind":"deployment"' } },
      common.card("ops", "Runbook and observability", "How the service is deployed, watched and recovered (title it runbook, operations or observability)", "runbook|operat|observab|monitor|deploy"),
      common.decisions(2),
      common.doc(),
      common.approved(),
    ],
    starters: ["The new service is called Billing; it is called by Checkout and writes invoices to Postgres.", "p95 latency for invoice creation must stay under 300 ms.", "Draft the data model and an API contract card for Billing."],
    guidance: "A new service is whole when its place among existing systems is modelled, its data and API are written down, its operational shape (deployment, health, logs, metrics, recovery) is described, and the constraints it must meet are recorded before the decisions that depend on them.",
  },
  integration: {
    id: "integration",
    name: "Integration between systems",
    summary: "Two or more existing systems that must exchange data or events: the contract, the failure modes, the sequence.",
    seedConstraints: [
      { statement: "Every message or call across the integration is idempotent or safely retried", kind: "must", category: "availability" },
      { statement: "Contract changes are backward compatible for at least one release", kind: "must", category: "compliance" },
    ],
    checklist: [
      common.asIs(),
      { id: "model", title: "Model with an external system", hint: "Model both sides; at least one component is an external system", check: { kind: "model", minComponents: 2, requireKind: "external" } },
      common.view(),
      { id: "sequence", title: "Sequence diagram", hint: "Ask for a sequence diagram of the main exchange, or pick 'sequence from' on the Architecture model card", check: { kind: "artifact", types: ["mermaid", "view"], contentMatch: 'sequenceDiagram|"kind":"sequence"' } },
      { id: "contract", title: "Contract or schema", hint: "Describe the payloads, events or API shapes exchanged; the AI records a contract card attached to the relationship", check: { kind: "artifact", types: ["markdown", "mermaid"], titleMatch: "contract|schema|payload|event|message", typesAny: ["contract"] } },
      common.card("failure", "Failure handling", "What happens on timeout, duplicate, out-of-order or partial failure (title it failure, retry or resilience)", "failure|retry|resilien|idempot|timeout|error"),
      common.constraints(1),
      common.decisions(2),
      common.doc(),
      common.approved(),
    ],
    starters: ["Draw the current architecture of repository <name>.", "Orders calls the external Payment gateway over REST; the gateway sends payment data back as webhooks.", "Draw a sequence diagram for Orders."],
    guidance: "An integration is whole when the existing systems on both sides are modelled as they are, the contract between them is written down, the main sequence is drawn, and every failure mode (timeouts, duplicates, ordering, partial failure) has a stated handling before the decisions are recorded.",
  },
  data_migration: {
    id: "data_migration",
    name: "Data migration",
    summary: "Moving data between stores or shapes: the mapping, the cutover, the way back.",
    seedConstraints: [
      { statement: "No data is lost or silently altered; every migrated record is reconciled against the source", kind: "must", category: "compliance" },
      { statement: "The migration can be rolled back to the source of truth until cutover is declared complete", kind: "must", category: "availability" },
    ],
    checklist: [
      common.asIs(),
      { id: "datamodel", title: "Target data model", hint: "Ask the AI to draft the target data model", check: { kind: "artifact", types: ["data_model"] } },
      common.card("mapping", "Field mapping", "Source to target mapping and transformations (title it mapping or transform)", "mapping|transform|conversion"),
      common.card("cutover", "Cutover plan", "The steps, order and checks of the cutover (title it cutover, migration plan or runbook)", "cutover|migration plan|runbook|phase"),
      common.card("rollback", "Rollback", "How to go back at each phase (title it rollback)", "rollback|revert|fallback"),
      common.constraints(1, "data_residency"),
      common.decisions(2),
      common.doc(),
      common.approved(),
    ],
    starters: ["The source is the legacy Orders database in Oracle; the target is Postgres in the EU.", "Draft the target data model: orders, order lines, customers.", "Write the cutover plan as phases with a rollback at each."],
    guidance: "A data migration is whole when the source is captured as-is, the target model and the field mapping are written down, the cutover has ordered steps with checks, every phase has a rollback, and the data residency and reconciliation constraints are recorded before decisions are taken.",
  },
  platform_change: {
    id: "platform_change",
    name: "Platform change",
    summary: "Replacing or re-shaping a platform component (a bus, a database, a runtime): the options, the choice, the rollout.",
    seedConstraints: [
      { statement: "The change is rolled out incrementally with a measured rollback point at each step", kind: "must", category: "availability" },
      { statement: "Total run cost after the change stays within the current budget unless a decision says otherwise", kind: "target", category: "budget" },
    ],
    checklist: [
      common.asIs(),
      common.model(3),
      common.view(),
      { id: "alternatives", title: "Alternatives compared", hint: "Ask the AI to explore alternatives; the card puts two or three candidates side by side", check: { kind: "artifact", types: ["alternatives"] } },
      { id: "chosen", title: "Alternative chosen by vote", hint: "Press Decide on the alternatives card and vote; the winner becomes the model", check: { kind: "alternatives_chosen" } },
      common.constraints(1, "budget"),
      { id: "deployment", title: "Deployment view", hint: "Say where the platform components run, per environment", check: { kind: "artifact", types: ["view"], contentMatch: '"kind":"deployment"' } },
      common.card("rollout", "Rollout plan", "Phases, rollback points and what is measured at each (title it rollout, migration or phases)", "rollout|migration|phase|cutover"),
      common.decisions(2),
      common.doc(),
      common.approved(),
    ],
    starters: ["Draw the current architecture of repository <name>.", "Total run cost must stay under the current budget.", "Explore alternatives for the message bus."],
    guidance: "A platform change is whole when the current platform is captured as-is, at least two alternatives are compared on the same constraints and one is chosen by the group, the target model and view reflect the choice, and the rollout has phases with rollback points and a budget constraint on record.",
  },
};

export const TEMPLATE_IDS = Object.keys(TEMPLATES) as TemplateId[];
export const isTemplateId = (x: unknown): x is TemplateId => typeof x === "string" && x in TEMPLATES;

export interface ChecklistStatus {
  template: SessionTemplate;
  items: { id: string; title: string; hint: string; done: boolean; detail: string }[];
  done: number;
  total: number;
}

function matches(re: string | undefined, text: string): boolean {
  return !re || new RegExp(re, "i").test(text);
}

function evaluate(state: SessionState, check: ChecklistCheck): { done: boolean; detail: string } {
  const live = liveArtifacts(state);
  switch (check.kind) {
    case "artifact": {
      const hits = live.filter((a) => (check.typesAny?.includes(a.type) ?? false) || (check.types.includes(a.type) && matches(check.titleMatch, a.title) && matches(check.contentMatch, JSON.stringify(a.current.content))));
      return { done: hits.length > 0, detail: hits.length ? hits.map((a) => a.title).join(", ") : "" };
    }
    case "model": {
      const m = live.find((a) => a.type === "arch_model")?.current.content as ArchModelContent | undefined;
      const n = m?.components.length ?? 0;
      const kindOk = !check.requireKind || Boolean(m?.components.some((c) => c.kind === check.requireKind));
      return { done: n >= check.minComponents && kindOk, detail: n ? `${n} component${n === 1 ? "" : "s"}${check.requireKind && !kindOk ? `, none of kind ${check.requireKind}` : ""}` : "" };
    }
    case "constraints": {
      const k = live.find((a) => a.type === "constraints")?.current.content as ConstraintsContent | undefined;
      const list = (k?.constraints ?? []).filter((c) => !check.category || c.category === check.category);
      return { done: list.length >= check.min, detail: list.length ? list.map((c) => c.id).join(", ") : "" };
    }
    case "decisions": {
      const ds = Object.values(state.decisions).filter((d) => (check.agreed ? d.status === "agreed" : d.status !== "superseded"));
      return { done: ds.length >= check.min, detail: ds.length ? `${ds.length} so far` : "" };
    }
    case "review": {
      const r = Object.values(state.reviews).find((x) => x.status === "approved");
      return { done: Boolean(r), detail: r ? `v${r.approvedVersionNo}` : "" };
    }
    case "as_is": {
      const m = live.find((a) => a.type === "arch_model")?.current.content as ArchModelContent | undefined;
      return { done: Boolean(m?.asIs), detail: m?.asIs ? m.asIs.source : "" };
    }
    case "alternatives_chosen": {
      const alt = live.map((a) => a.current.content as AlternativesContent).find((c) => c && Array.isArray((c as AlternativesContent).candidates) && (c as AlternativesContent).chosen);
      return { done: Boolean(alt), detail: alt ? alt.candidates.find((c) => c.id === alt.chosen)?.title ?? "" : "" };
    }
  }
}

/** The design checklist for a templated session, evaluated against the current state; null for sessions without a template. */
export function completeness(state: SessionState): ChecklistStatus | null {
  if (!state.template || !isTemplateId(state.template)) return null;
  const template = TEMPLATES[state.template];
  const items = template.checklist.map((item) => ({ id: item.id, title: item.title, hint: item.hint, ...evaluate(state, item.check) }));
  return { template, items, done: items.filter((i) => i.done).length, total: items.length };
}

/** A compact rendering for prompts and digests: "5 of 9; missing: …". */
export function checklistText(status: ChecklistStatus): string[] {
  return status.items.map((i) => `- [${i.done ? "x" : " "}] ${i.title}${i.done && i.detail ? ` (${i.detail})` : !i.done ? `: ${i.hint}` : ""}`);
}
