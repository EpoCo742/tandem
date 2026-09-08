import { describe, expect, it } from "vitest";
import { emptyUseCases, isUseCaseDiagram, parsePlantUmlUseCases, upsertUseCases, useCasesToMermaid } from "./usecases.js";
import { useCasesMarkdown } from "./artifacts.js";
import type { ArchModelContent } from "./model.js";

const model = { components: [{ id: "customer", name: "Customer", kind: "person" }, { id: "orders", name: "Orders service", kind: "service" }], relationships: [], boundaries: [], sections: [] } as unknown as ArchModelContent;

describe("use cases", () => {
  it("merges by name, links by name, drops component ids the model lacks", () => {
    const first = upsertUseCases(emptyUseCases("Order platform"), { actors: [{ name: "customer", componentId: "customer" }], useCases: [{ name: "place an order.", componentIds: ["orders", "ghost"] }, { name: "track it" }], links: [{ actor: "Customer", useCase: "Place an order" }, { actor: "customer", useCase: "track it" }], derivedFrom: ["e1"] }, model);
    expect(first.unknown).toEqual(["ghost"]);
    expect(first.content.actors).toEqual([{ id: "a_customer", name: "Customer", componentId: "customer" }]);
    expect(first.content.useCases.map((u) => u.name)).toEqual(["Place an order", "Track it"]);
    expect(first.content.useCases[0]!.componentIds).toEqual(["orders"]);
    expect(first.content.links).toHaveLength(2);
    const second = upsertUseCases(first.content, { actors: [{ name: "Ops" }], useCases: [{ name: "Place an order", description: "From the web app" }, { name: "Cancel an order" }], links: [{ actor: "Ops", useCase: "Cancel an order" }], relations: [{ from: "Cancel an order", to: "Place an order", kind: "extend" }], derivedFrom: ["e2"] }, model);
    expect(second.content.useCases).toHaveLength(3);
    expect(second.content.useCases[0]!.description).toBe("From the web app");
    expect(second.content.useCases[0]!.derivedFrom).toEqual(["e1", "e2"]);
    expect(second.content.relations).toEqual([{ from: "uc_cancel_an_order", to: "uc_place_an_order", kind: "extend" }]);
    expect(second.content.system).toBe("Order platform");
  });

  it("draws primary actors left, secondary right, include and extend dashed", () => {
    const c = upsertUseCases(emptyUseCases("Shop"), { actors: [{ name: "Customer" }, { name: "Payment provider", kind: "secondary" }], useCases: [{ name: "Pay" }, { name: "Refund" }], links: [{ actor: "Customer", useCase: "Pay" }, { actor: "Payment provider", useCase: "Pay" }], relations: [{ from: "Refund", to: "Pay", kind: "extend" }] }).content;
    const src = useCasesToMermaid(c);
    expect(src).toMatch(/^flowchart LR\n {2}a_customer\["Customer"\]:::actor\n {2}subgraph sys\["Shop"\]/);
    expect(src).toContain('uc_pay(["Pay"]):::usecase');
    expect(src.indexOf('a_payment_provider["Payment provider"]')).toBeGreaterThan(src.indexOf("  end"));
    expect(src).toContain("  a_customer --> uc_pay");
    expect(src).toContain("  uc_pay --> a_payment_provider");
    expect(src).toContain("  uc_refund -.->|extend| uc_pay");
  });

  it("recognises and parses a PlantUML use case diagram", () => {
    const puml = ["@startuml", "left to right direction", "actor Customer", 'actor "Payment provider" as pay', 'rectangle "Order platform" {', '  usecase "Place an order" as UC1', "  (Pay for an order) as UC2", '  usecase UC3 as "Refund an order"', "}", "Customer --> UC1", "Customer --> (Pay for an order)", "UC2 --> pay", "UC1 .> UC2 : include", "UC3 ..> UC2 : <<extend>>", ":Ops: --> UC3", "@enduml"].join("\n");
    expect(isUseCaseDiagram(puml)).toBe(true);
    expect(isUseCaseDiagram('component "Orders API" as api\n[Web] --> api')).toBe(false);
    const p = parsePlantUmlUseCases(puml);
    expect(p.system).toBe("Order platform");
    expect(p.actors.map((a) => `${a.name}${a.kind === "secondary" ? "*" : ""}`)).toEqual(["Customer", "Payment provider*", "Ops"]);
    expect(p.useCases.map((u) => u.name)).toEqual(["Place an order", "Pay for an order", "Refund an order"]);
    expect(p.links).toHaveLength(4);
    expect(p.relations).toEqual([{ from: "uc_place_an_order", to: "uc_pay_for_an_order", kind: "include" }, { from: "uc_refund_an_order", to: "uc_pay_for_an_order", kind: "extend" }]);
    expect(p.notes).toEqual([]);
  });

  it("renders the table with model names for the realising components", () => {
    const c = upsertUseCases(emptyUseCases("Order platform"), { actors: [{ name: "Customer" }], useCases: [{ name: "Place an order", componentIds: ["orders"] }], links: [{ actor: "Customer", useCase: "Place an order" }] }, model).content;
    expect(useCasesMarkdown(c, model)).toContain("| Place an order | Customer | Orders service |  |");
  });
});
