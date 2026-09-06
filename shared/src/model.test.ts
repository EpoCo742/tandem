import { describe, expect, it } from "vitest";
import { emptyModel, modelToMermaid, upsertComponents, upsertRelationships, diffModels, compareMermaid } from "./model.js";

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

describe("view rendering", () => {
  it("styles every kind, lays nodes out by layer, and picks the direction from the shape", () => {
    let m = upsertComponents(emptyModel(), [
      { id: "db", name: "Postgres", kind: "database" },
      { id: "api", name: "Orders API", kind: "service" },
      { id: "web", name: "Web app", kind: "ui" },
      { id: "cust", name: "Customer", kind: "person" },
    ], []);
    m = upsertRelationships(m, [{ from: "cust", to: "web", kind: "uses" }, { from: "web", to: "api", kind: "calls" }, { from: "api", to: "db", kind: "writes", dataClasses: ["pii"] }], []).model;
    const src = modelToMermaid(m, { kind: "container" });
    expect(src.startsWith("flowchart TB")).toBe(true); // four layers
    expect(src).toContain("classDef svc");
    expect(src).toContain(':::person');
    expect(src).toContain(':::db');
    expect(src.indexOf("n_cust")).toBeLessThan(src.indexOf("n_web"));
    expect(src.indexOf("n_web")).toBeLessThan(src.indexOf("n_api"));
    expect(src.indexOf("n_api")).toBeLessThan(src.indexOf("n_db"));
    expect(src).toContain('|"writes [PII]"|');
    expect(modelToMermaid(m, { kind: "container", direction: "LR" }).startsWith("flowchart LR")).toBe(true);
    const two = upsertComponents(emptyModel(), [{ id: "a", name: "A", kind: "service" }, { id: "b", name: "B", kind: "service" }], []);
    expect(modelToMermaid(two, { kind: "container" }).startsWith("flowchart LR")).toBe(true); // a short chain
  });
});

describe("diffModels", () => {
  it("reports added, removed, changed and unchanged components and relationships between two moments", () => {
    const before = { components: [{ id: "a", name: "A", kind: "service" as const, derivedFrom: [] }, { id: "b", name: "B", kind: "service" as const, derivedFrom: [] }], relationships: [{ id: "a-calls-b", from: "a", to: "b", kind: "calls" as const, derivedFrom: [] }], boundaries: [] };
    const after = { components: [{ id: "a", name: "A", kind: "service" as const, technology: "Go", derivedFrom: [] }, { id: "c", name: "C", kind: "queue" as const, derivedFrom: [] }], relationships: [{ id: "a-publishes-c", from: "a", to: "c", kind: "publishes" as const, derivedFrom: [] }], boundaries: [] };
    const d = diffModels(before, after);
    expect(d.added.map((c) => c.id)).toEqual(["c"]);
    expect(d.removed.map((c) => c.id)).toEqual(["b"]);
    expect(d.changed.map((x) => x.after.id)).toEqual(["a"]);
    expect(d.same).toEqual([]);
    expect(d.addedRels.map((r) => r.id)).toEqual(["a-publishes-c"]);
    expect(d.removedRels.map((r) => r.id)).toEqual(["a-calls-b"]);
    const mmd = compareMermaid(before, after);
    expect(mmd).toContain(":::added");
    expect(mmd).toContain(":::removed");
    expect(mmd).toContain("==>");
  });
});
