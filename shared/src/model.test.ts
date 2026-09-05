import { describe, expect, it } from "vitest";
import { emptyModel, modelToMermaid, upsertComponents, upsertRelationships } from "./model.js";

// A real model once labelled an edge "submit transfer (via gateway)"; unquoted, Mermaid failed to
// parse it and the whole view rendered as an error, so the new route looked missing.
describe("modelToMermaid", () => {
  const base = upsertComponents(emptyModel(), [
    { name: "Crypto Web UI", kind: "ui" },
    { name: "JFK API Gateway", kind: "service" },
    { name: "Store", kind: "database", boundary: "crypto-web-api" },
  ], []);
  const model = upsertRelationships(base, [
    { from: "crypto-web-ui", to: "jfk-api-gateway", kind: "calls", label: 'submit transfer (via gateway) | "quoted" [x]' },
  ], []).model;

  it("quotes edge labels so parentheses, pipes and quotes survive", () => {
    const text = modelToMermaid(model, { kind: "container" });
    expect(text).toContain('n_crypto_web_ui -->|"submit transfer (via gateway) | #quot;quoted#quot; [x]"| n_jfk_api_gateway');
    expect(text).not.toMatch(/-->\|[^"]/);
  });

  it("quotes edge labels in the context view too", () => {
    const text = modelToMermaid(model, { kind: "context" });
    expect(text).toMatch(/-->\|"[^"]*"\| /);
  });
});
