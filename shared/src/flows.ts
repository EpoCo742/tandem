import type { Constraint, ConstraintsContent } from "./artifacts.js";
import type { ArchModelContent, ModelBoundary, ModelComponent, ModelRelationship } from "./model.js";
import { liveArtifacts, type SessionState } from "./reducer.js";

// Data-flow classification: relationships say what data they carry, boundaries say where they
// are and how much they are trusted. Data residency and security constraints then become
// checks the server runs on every model change, by hand or by the AI, with no AI turn.

export type DataClass = "pii" | "payment" | "health" | "credentials" | "confidential" | "internal" | "public";
export const DATA_CLASSES: DataClass[] = ["pii", "payment", "health", "credentials", "confidential", "internal", "public"];
/** Classes a residency or security rule cares about. */
export const SENSITIVE: ReadonlySet<DataClass> = new Set<DataClass>(["pii", "payment", "health", "credentials", "confidential"]);

export type Trust = "public" | "internal" | "restricted";

export interface Violation {
  constraintId: string;
  relationshipId: string;
  reason: string; // "PII flows from Service A (EU) to Analytics (US); C-01 keeps customer data in the EU"
}

// Region words a constraint may use and the boundary region they map to. Boundaries store the
// canonical code (EU, US, UK, ...); the statement is parsed leniently.
const REGION_WORDS: [RegExp, string][] = [
  [/\b(eu|eea|europe|european union)\b/i, "EU"],
  [/\b(us|usa|united states|america)\b/i, "US"],
  [/\b(uk|united kingdom|britain)\b/i, "UK"],
  [/\b(ca|canada)\b/i, "CA"],
  [/\b(au|australia)\b/i, "AU"],
  [/\b(in|india)\b/i, "IN"],
  [/\b(jp|japan)\b/i, "JP"],
  [/\b(sg|singapore)\b/i, "SG"],
  [/\b(de|germany)\b/i, "DE"],
  [/\b(ch|switzerland)\b/i, "CH"],
  [/\b(apac|asia)\b/i, "APAC"],
];

/** Canonical region code for a free-text region ("the EU", "eu-west-1", "Germany"), or the text upper-cased. */
export function canonicalRegion(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const t = text.trim();
  if (!t) return undefined;
  for (const [re, code] of REGION_WORDS) if (re.test(t)) return code;
  return t.toUpperCase();
}

function regionsNamed(k: Constraint): string[] {
  const text = `${k.statement} ${k.value ?? ""}`;
  const out: string[] = [];
  for (const [re, code] of REGION_WORDS) if (re.test(text) && !out.includes(code)) out.push(code);
  return out;
}

const classWord = (cs: DataClass[]) => cs.filter((c) => SENSITIVE.has(c)).map((c) => (c === "pii" ? "PII" : c)).join(", ");

/** Every relationship that breaks a residency or security constraint, given the model's classification. */
export function checkFlows(model: Pick<ArchModelContent, "components" | "relationships" | "boundaries">, constraints: Constraint[]): Violation[] {
  const out: Violation[] = [];
  const comp = (id: string): ModelComponent | undefined => model.components.find((c) => c.id === id);
  const boundaryOf = (c: ModelComponent | undefined): ModelBoundary | undefined => (c?.boundary ? model.boundaries.find((b) => b.id === c.boundary) : undefined);
  const regionOf = (c: ModelComponent | undefined) => canonicalRegion(boundaryOf(c)?.region);
  const trustOf = (c: ModelComponent | undefined): Trust | undefined => boundaryOf(c)?.trust;
  const where = (c: ModelComponent | undefined) => (c ? `${c.name}${regionOf(c) ? ` (${regionOf(c)})` : c.kind === "external" ? " (external)" : ""}` : "?");

  for (const r of model.relationships as ModelRelationship[]) {
    const classes = (r.dataClasses ?? []).filter((c) => SENSITIVE.has(c));
    if (classes.length === 0) continue;
    const from = comp(r.from);
    const to = comp(r.to);
    for (const k of constraints) {
      if (k.exceptionTo) continue; // an exception relaxes; it never accuses
      if (k.category === "data_residency" || k.category === "compliance") {
        const regions = regionsNamed(k);
        if (regions.length === 0) continue;
        // "Customer data stays in the EU": sensitive data reaching a place known to be elsewhere breaks it.
        const dest = regionOf(to);
        const destIsElsewhere = dest ? !regions.includes(dest) : to?.kind === "external" && k.kind === "must_not";
        if (destIsElsewhere) out.push({ constraintId: k.id, relationshipId: r.id, reason: `${classWord(classes)} flows from ${where(from)} to ${where(to)}; ${k.id} keeps it in ${regions.join("/")}` });
      } else if (k.category === "security") {
        // Sensitive data into or out of a public-trust boundary breaks a security constraint that speaks of it.
        if (!/\b(public|internet|encrypt|tls|authenticat|expos|untrusted)\b/i.test(`${k.statement} ${k.value ?? ""}`)) continue;
        if (trustOf(to) === "public" || trustOf(from) === "public") out.push({ constraintId: k.id, relationshipId: r.id, reason: `${classWord(classes)} crosses a public-trust boundary (${where(from)} to ${where(to)}); ${k.id}` });
      }
    }
  }
  return out;
}

/** Violations for the session as it stands (live model against the live constraints card). */
export function violationsOf(state: SessionState): Violation[] {
  const live = liveArtifacts(state);
  const model = live.find((a) => a.type === "arch_model")?.current.content as ArchModelContent | undefined;
  const kc = live.find((a) => a.type === "constraints")?.current.content as ConstraintsContent | undefined;
  if (!model || !kc) return [];
  return checkFlows(model, kc.constraints);
}
