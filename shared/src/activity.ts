// What the AI is doing, in words a person would use. Every tool call the executor runs gets a
// short present-tense label from its name and input, and the lane shows the current one with a
// moving indicator and the finished ones beneath it, so a long turn is never a blank wait. No
// model tokens are spent on this; it is derived from the call itself.

const cut = (s: string | undefined, n = 48): string => {
  const t = (s ?? "").trim().replace(/\s+/g, " ");
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);

/** Labels the lane shows for phases rather than tools; kept out of the finished list. */
export const PHASE_LABELS = new Set(["Thinking", "Writing the reply", "Starting the Copilot runtime", "Collecting messages"]);

/**
 * A label for a tool call about to run. `titleOf` resolves an artifact id to its current title
 * so "Updating System architecture" can be said instead of "Updating 01M1…".
 */
export function describeToolCall(name: string, input: unknown, titleOf: (artifactId: string) => string | undefined): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const title = str(i.title);
  const byId = (id: unknown) => (typeof id === "string" ? titleOf(id) : undefined);
  switch (name) {
    case "create_artifact": {
      const type = str(i.type);
      const content = (i.content ?? {}) as Record<string, unknown>;
      if (type === "view") {
        const kind = str(content.kind);
        return title ? `Drawing ${cut(title)}` : kind ? `Drawing the ${kind} view` : "Drawing a view";
      }
      if (type === "mermaid") return `Drawing ${cut(title) || "a diagram"}`;
      if (type === "data_model") return "Building the data model";
      if (type === "design_doc") return "Writing the design document";
      if (type === "contract") return `Recording the contract ${cut(title)}`.trim();
      return `Writing ${cut(title) || "a card"}`;
    }
    case "update_artifact": return `Updating ${cut(byId(i.artifactId)) || "a card"}`;
    case "delete_artifact": return `Proposing to remove ${cut(byId(i.artifactId)) || "a card"}`;
    case "read_artifact": return `Reading ${cut(byId(i.artifactId)) || "a card"}`;
    case "pin_artifact": return `${i.pinned === false ? "Unpinning" : "Pinning"} ${cut(byId(i.artifactId)) || "a card"}`;
    case "record_decision": {
      const s = cut(str(i.statement), 56);
      return s ? `Recording a decision: ${s}` : "Recording a decision";
    }
    case "create_decision_point": return "Raising a decision point";
    case "ask_clarification": return "Asking a question";
    case "resolve_question": {
      const q = str(i.questionId);
      return q && /^Q-\d+$/i.test(q) ? `Closing ${q.toUpperCase()}` : "Closing a question";
    }
    case "record_assumption": return "Recording an assumption";
    case "resolve_assumption": return "Settling an assumption";
    case "upsert_components": {
      const n = Array.isArray(i.components) ? i.components.length : 0;
      return n === 1 ? "Adding a component to the model" : n > 1 ? `Updating the model (${n} components)` : "Updating the architecture model";
    }
    case "upsert_relationships": return "Connecting components in the model";
    case "upsert_deployment": return "Recording where things run";
    case "remove_from_model": return "Removing from the model";
    case "set_as_is": return "Recording the as-is baseline";
    case "upsert_constraints": return "Recording constraints";
    case "remove_constraints": return "Dropping constraints";
    case "propose_alternatives": return "Laying out the alternatives";
    case "render_adr": return "Rendering decision records";
    case "upsert_contract": return `Recording the contract ${cut(title)}`.trim();
    case "library_search": {
      const q = cut(str(i.query), 32);
      return q ? `Searching the library for “${q}”` : "Searching the library";
    }
    default:
      return `Using ${name}`;
  }
}

/** A label for a call the runtime made to one of the person's own tool servers. */
export function describeExternalCall(rawName: string): string {
  // The runtime names them server-tool or server/tool or server:tool.
  const m = rawName.match(/^([A-Za-z0-9_.]+)[-/:](.+)$/);
  return m ? `Using ${m[1]}: ${m[2]}` : `Using ${rawName}`;
}
