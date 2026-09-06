import { describe, expect, it } from "vitest";
import { detectNotation, parseMermaidFlowchart, parsePlantUml, parseStructurizr, toStructurizrDsl } from "./notation.js";
import { emptyModel, upsertComponents, upsertRelationships } from "./model.js";

describe("notation import", () => {
  it("reads a Mermaid flowchart with shapes, labels, chains and subgraphs", () => {
    const p = parseMermaidFlowchart(`flowchart LR
  subgraph shop[Shop]
    api[Orders API] -->|OrderPlaced| kafka{{Kafka}}
    api --> db[(Postgres)]
  end
  kafka --> billing[Billing] --> db
  user((Customer)) -.-> api`);
    expect(p.components.map((c) => `${c.id}:${c.kind}`)).toEqual(["api:service", "kafka:queue", "db:database", "billing:service", "user:person"]);
    expect(p.boundaries).toEqual([{ id: "shop", name: "Shop", kind: "system" }]);
    expect(p.components.find((c) => c.id === "api")?.boundary).toBe("shop");
    expect(p.relationships).toContainEqual({ from: "api", to: "kafka", kind: "publishes", label: "OrderPlaced" });
    expect(p.relationships).toContainEqual({ from: "api", to: "db", kind: "uses" });
    expect(p.relationships).toContainEqual({ from: "billing", to: "db", kind: "uses" });
    expect(p.relationships).toContainEqual({ from: "user", to: "api", kind: "depends_on" });
    expect(detectNotation("flowchart LR\n a --> b")).toBe("mermaid");
  });

  it("reads Structurizr DSL: systems with containers become boundaries, others external, people people", () => {
    const p = parseStructurizr(`workspace "Shop" "x" {
  model {
    customer = person "Customer" "Buys things"
    shop = softwareSystem "Shop" "The shop" {
      web = container "Web App" "SPA" "React"
      api = container "Orders API" "Service" "Node"
      db = container "Orders DB" "Stores orders" "Postgres"
    }
    pay = softwareSystem "Payment Gateway" "Third party"
    customer -> web "Uses"
    web -> api "Calls" "JSON/HTTPS"
    api -> db "Reads and writes"
    api -> pay "Charges cards"
  }
  views { }
}`);
    expect(p.boundaries).toEqual([{ id: "shop", name: "Shop", kind: "system" }]);
    expect(p.components.map((c) => `${c.id}:${c.kind}:${c.boundary ?? "-"}`)).toEqual(["customer:person:-", "web:ui:shop", "api:service:shop", "db:database:shop", "pay:external:-"]);
    expect(p.components.find((c) => c.id === "db")?.technology).toBe("Postgres");
    expect(p.relationships).toContainEqual({ from: "web", to: "api", kind: "calls", label: "Calls" });
    expect(p.relationships).toContainEqual({ from: "api", to: "db", kind: "reads", label: "Reads and writes" });
    expect(detectNotation("workspace { model { a = softwareSystem \"A\" } }")).toBe("structurizr");
  });

  it("reads a PlantUML component diagram", () => {
    const p = parsePlantUml(`@startuml
package "Shop" {
  [Orders API] as api
  database "Postgres" as db
  queue "Kafka" as kafka
}
actor Customer
Customer --> api : browses
api --> db : writes
api ..> kafka : OrderPlaced
@enduml`);
    expect(p.boundaries).toEqual([{ id: "shop", name: "Shop", kind: "system" }]);
    expect(p.components.map((c) => `${c.id}:${c.kind}`)).toEqual(["api:service", "db:database", "kafka:queue", "customer:person"]);
    expect(p.relationships).toContainEqual({ from: "customer", to: "api", kind: "calls", label: "browses" });
    expect(p.relationships).toContainEqual({ from: "api", to: "db", kind: "writes", label: "writes" });
    expect(p.relationships).toContainEqual({ from: "api", to: "kafka", kind: "publishes", label: "OrderPlaced" });
    expect(detectNotation("@startuml\n[A] --> [B]\n@enduml")).toBe("plantuml");
  });

  it("exports the model as Structurizr DSL", () => {
    let m = upsertComponents(emptyModel(), [{ id: "api", name: "Orders API", kind: "service", boundary: "shop", technology: "Node" }, { id: "db", name: "Postgres", kind: "database", boundary: "shop" }, { id: "pay", name: "Payment gateway", kind: "external" }, { id: "cust", name: "Customer", kind: "person" }], []);
    m = upsertRelationships(m, [{ from: "api", to: "db", kind: "writes" }, { from: "api", to: "pay", kind: "calls", label: "charges" }], []).model;
    const dsl = toStructurizrDsl(m, "Shop v1");
    expect(dsl).toContain('workspace "Shop v1"');
    expect(dsl).toContain('shop = softwareSystem "Shop" {');
    expect(dsl).toContain('api = container "Orders API" "" "Node"');
    expect(dsl).toContain('pay = softwareSystem "Payment gateway"');
    expect(dsl).toContain('cust = person "Customer"');
    expect(dsl).toContain('api -> pay "charges"');
    expect(dsl).toContain("container shop");
  });
});
