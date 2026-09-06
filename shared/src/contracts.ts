import type { Section } from "./artifacts.js";
import type { ArchModelContent } from "./model.js";
import { liveArtifacts, type Artifact, type SessionState } from "./reducer.js";

// Contracts as cards: an API or event contract attached to a relationship or a component. The
// model says who consumes it, so a change to the contract can be flagged on every consumer.

export type ContractFormat = "openapi" | "asyncapi" | "json_schema" | "graphql" | "proto" | "markdown" | "other";

export interface ContractContent {
  format: ContractFormat;
  body: string; // the contract text: an OpenAPI or AsyncAPI fragment, a schema, or plain Markdown
  attachedTo?: { relationshipId?: string; componentId?: string }; // the relationship it governs, or the component that exposes it
  version?: string; // the contract's own version label, e.g. "v2", "2024-05"
  sections: Section[];
}

export interface ContractStatus {
  artifact: Artifact;
  content: ContractContent;
  provider?: string; // component id that exposes it
  consumers: string[]; // component ids that depend on it
  changedAfterModel: boolean; // the contract moved after the model last changed: consumers may not have caught up
}

/** Every live contract with who provides and who consumes it, from the model's relationships. */
export function contractsOf(state: SessionState): ContractStatus[] {
  const live = liveArtifacts(state);
  const modelArt = live.find((a) => a.type === "arch_model");
  const model = modelArt?.current.content as ArchModelContent | undefined;
  const out: ContractStatus[] = [];
  for (const a of live) {
    if (a.type !== "contract") continue;
    const c = a.current.content as ContractContent;
    let provider: string | undefined;
    let consumers: string[] = [];
    if (model && c.attachedTo?.relationshipId) {
      const r = model.relationships.find((x) => x.id === c.attachedTo!.relationshipId);
      if (r) {
        // The side that is called, read or subscribed to provides the contract; the other side consumes it.
        const providerSide = r.kind === "publishes" || r.kind === "writes" ? r.from : r.to;
        provider = providerSide;
        consumers = [providerSide === r.from ? r.to : r.from];
      }
    } else if (model && c.attachedTo?.componentId) {
      provider = c.attachedTo.componentId;
      consumers = [...new Set(model.relationships.filter((r) => r.to === provider && r.kind !== "publishes" && r.kind !== "writes").map((r) => r.from).concat(model.relationships.filter((r) => r.from === provider && (r.kind === "publishes" || r.kind === "writes")).map((r) => r.to)))];
    }
    const changedAfterModel = Boolean(modelArt && a.current.versionNo > 1 && a.current.createdAt > modelArt.current.createdAt);
    out.push({ artifact: a, content: c, provider, consumers, changedAfterModel });
  }
  return out;
}

/** Contracts a component consumes, for chips on the model table. */
export function contractsConsumedBy(state: SessionState, componentId: string): ContractStatus[] {
  return contractsOf(state).filter((c) => c.consumers.includes(componentId));
}
