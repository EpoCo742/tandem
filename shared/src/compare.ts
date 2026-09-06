import type { Constraint, ConstraintsContent } from "./artifacts.js";
import type { ContractContent } from "./contracts.js";
import { diffModels, type ArchModelContent, type ModelDiff } from "./model.js";
import { liveArtifacts, type Assumption, type Decision, type Question, type SessionState } from "./reducer.js";

// Two versions of the design side by side: not only the document text, but the state of the
// session when each version was written (decisions, model, constraints, contracts, assumptions,
// questions, cards). Everything here is computed; the AI is only asked, on request, to say what
// matters. That keeps a comparison cheap and repeatable.

export interface SectionChange { heading: string; wordsBefore: number; wordsAfter: number }

export interface DesignComparison {
  from: { versionNo: number; at: string };
  to: { versionNo: number; at: string };
  sections: { added: string[]; removed: string[]; changed: SectionChange[]; unchanged: number };
  words: { before: number; after: number };
  decisions: { added: Decision[]; superseded: Decision[]; statusChanged: { before: Decision; after: Decision }[] };
  model: ModelDiff | null;
  constraints: { added: Constraint[]; removed: Constraint[]; changed: { before: Constraint; after: Constraint }[] };
  contracts: { added: string[]; removed: string[]; changed: { title: string; from: number; to: number }[] };
  assumptions: { added: Assumption[]; settled: Assumption[] };
  questions: { asked: Question[]; answered: Question[] };
  cards: { added: { type: string; title: string }[]; removed: { type: string; title: string }[]; changed: { type: string; title: string; from: number; to: number }[] };
  major: string[]; // ranked, one sentence each
}

const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
const norm = (t: string) => t.replace(/<!--[\s\S]*?-->/g, "").replace(/\s+/g, " ").trim();

/** Headings (levels 1 to 3) and the text under each; the text before the first heading is the preamble. */
export function sectionsOf(markdown: string): Map<string, string> {
  const out = new Map<string, string>();
  let key = "(preamble)";
  let buf: string[] = [];
  const flush = () => {
    const body = norm(buf.join("\n"));
    if (body || out.size > 0 || key !== "(preamble)") out.set(key, (out.get(key) ? out.get(key) + " " : "") + body);
    buf = [];
  };
  for (const line of markdown.split("\n")) {
    const h = line.match(/^(#{1,3})\s+(.+?)\s*#*\s*$/);
    if (h) {
      flush();
      key = h[2]!.trim();
    } else buf.push(line);
  }
  flush();
  return out;
}

export function compareDesign(before: SessionState, after: SessionState, mdBefore: string, mdAfter: string, at: { from: { versionNo: number; at: string }; to: { versionNo: number; at: string } }): DesignComparison {
  // Document text, by section.
  const sb = sectionsOf(mdBefore);
  const sa = sectionsOf(mdAfter);
  const added = [...sa.keys()].filter((k) => !sb.has(k) && k !== "(preamble)");
  const removed = [...sb.keys()].filter((k) => !sa.has(k) && k !== "(preamble)");
  const changed: SectionChange[] = [];
  let unchanged = 0;
  for (const [k, body] of sa) {
    if (!sb.has(k)) continue;
    if (sb.get(k) === body) unchanged++;
    else changed.push({ heading: k, wordsBefore: words(sb.get(k)!), wordsAfter: words(body) });
  }

  // The registry.
  const dAdded = Object.values(after.decisions).filter((d) => !before.decisions[d.id]);
  const dSuperseded = Object.values(after.decisions).filter((d) => d.status === "superseded" && before.decisions[d.id] && before.decisions[d.id]!.status !== "superseded");
  const dStatus = Object.values(after.decisions).filter((d) => before.decisions[d.id] && before.decisions[d.id]!.status !== d.status && d.status !== "superseded").map((d) => ({ before: before.decisions[d.id]!, after: d }));

  // The model.
  const modelOf = (s: SessionState) => liveArtifacts(s).find((a) => a.type === "arch_model")?.current.content as ArchModelContent | undefined;
  const mb = modelOf(before);
  const ma = modelOf(after);
  const empty = { components: [], relationships: [], boundaries: [] };
  const model = mb || ma ? diffModels(mb ?? empty, ma ?? empty) : null;

  // Constraints.
  const consOf = (s: SessionState) => ((liveArtifacts(s).find((a) => a.type === "constraints")?.current.content as ConstraintsContent | undefined)?.constraints ?? []);
  const cb = new Map(consOf(before).map((c) => [c.id, c]));
  const ca = new Map(consOf(after).map((c) => [c.id, c]));
  const constraints = {
    added: [...ca.values()].filter((c) => !cb.has(c.id)),
    removed: [...cb.values()].filter((c) => !ca.has(c.id)),
    changed: [...ca.values()].filter((c) => cb.has(c.id) && (cb.get(c.id)!.statement !== c.statement || cb.get(c.id)!.kind !== c.kind || (cb.get(c.id)!.value ?? "") !== (c.value ?? ""))).map((c) => ({ before: cb.get(c.id)!, after: c })),
  };

  // Contracts and every other card.
  const liveB = liveArtifacts(before);
  const liveA = liveArtifacts(after);
  const kb = new Map(liveB.filter((a) => a.type === "contract").map((a) => [a.id, a]));
  const ka = new Map(liveA.filter((a) => a.type === "contract").map((a) => [a.id, a]));
  const contracts = {
    added: [...ka.values()].filter((a) => !kb.has(a.id)).map((a) => `${a.title} (${(a.current.content as ContractContent).format})`),
    removed: [...kb.values()].filter((a) => !ka.has(a.id)).map((a) => a.title),
    changed: [...ka.values()].filter((a) => kb.has(a.id) && kb.get(a.id)!.current.versionNo !== a.current.versionNo).map((a) => ({ title: a.title, from: kb.get(a.id)!.current.versionNo, to: a.current.versionNo })),
  };
  const skip = new Set(["design_doc", "arch_model", "constraints", "contract"]);
  const ob = new Map(liveB.filter((a) => !skip.has(a.type)).map((a) => [a.id, a]));
  const oa = new Map(liveA.filter((a) => !skip.has(a.type)).map((a) => [a.id, a]));
  const cards = {
    added: [...oa.values()].filter((a) => !ob.has(a.id)).map((a) => ({ type: a.type, title: a.title })),
    removed: [...ob.values()].filter((a) => !oa.has(a.id)).map((a) => ({ type: a.type, title: a.title })),
    changed: [...oa.values()].filter((a) => ob.has(a.id) && ob.get(a.id)!.current.versionNo !== a.current.versionNo).map((a) => ({ type: a.type, title: a.title, from: ob.get(a.id)!.current.versionNo, to: a.current.versionNo })),
  };

  // Assumptions and questions.
  const assumptions = {
    added: Object.values(after.assumptions).filter((a) => !before.assumptions[a.id]),
    settled: Object.values(after.assumptions).filter((a) => a.status !== "open" && before.assumptions[a.id]?.status === "open"),
  };
  const questions = {
    asked: Object.values(after.questions).filter((q) => !before.questions[q.id]),
    answered: Object.values(after.questions).filter((q) => q.status === "answered" && before.questions[q.id]?.status === "open"),
  };

  // What matters most, ranked: structure and settled things first, prose last.
  const ranked: { w: number; text: string }[] = [];
  if (model) {
    for (const c of model.removed) ranked.push({ w: 10, text: `Removed ${c.name} (${c.kind}) from the architecture.` });
    for (const c of model.added) ranked.push({ w: 9, text: `Added ${c.name} (${c.kind}${c.technology ? `, ${c.technology}` : ""}) to the architecture.` });
    for (const { before: b, after: a } of model.changed) ranked.push({ w: 6, text: `${a.name}: ${[b.name !== a.name ? `renamed from ${b.name}` : "", b.kind !== a.kind ? `now a ${a.kind}` : "", (b.technology ?? "") !== (a.technology ?? "") ? `technology ${a.technology ?? "unset"}` : "", (b.boundary ?? "") !== (a.boundary ?? "") ? `moved to ${a.boundary ?? "no boundary"}` : ""].filter(Boolean).join(", ")}.` });
    const cname = (id: string) => ma?.components.find((c) => c.id === id)?.name ?? mb?.components.find((c) => c.id === id)?.name ?? id;
    for (const r of model.addedRels) ranked.push({ w: 5, text: `New relationship: ${cname(r.from)} ${r.kind.replace("_", " ")} ${cname(r.to)}.` });
    for (const r of model.removedRels) ranked.push({ w: 5, text: `Dropped relationship: ${cname(r.from)} ${r.kind.replace("_", " ")} ${cname(r.to)}.` });
  }
  for (const d of dSuperseded) ranked.push({ w: 9, text: `${d.label} superseded${d.supersededBy && after.decisions[d.supersededBy] ? ` by ${after.decisions[d.supersededBy]!.label}` : ""}: ${d.statement}.` });
  for (const d of dAdded) ranked.push({ w: d.status === "agreed" ? 8 : 5, text: `${d.label} ${d.status}: ${d.statement}.` });
  for (const { before: b, after: a } of dStatus) ranked.push({ w: 6, text: `${a.label} went from ${b.status} to ${a.status}: ${a.statement}.` });
  for (const c of constraints.added) ranked.push({ w: 8, text: `New constraint ${c.id} (${c.kind.replace("_", " ")}): ${c.statement}.` });
  for (const c of constraints.removed) ranked.push({ w: 8, text: `Constraint ${c.id} removed: ${c.statement}.` });
  for (const { after: a } of constraints.changed) ranked.push({ w: 7, text: `Constraint ${a.id} changed: ${a.statement}.` });
  for (const t of contracts.added) ranked.push({ w: 7, text: `New contract: ${t}.` });
  for (const t of contracts.removed) ranked.push({ w: 7, text: `Contract removed: ${t}.` });
  for (const c of contracts.changed) ranked.push({ w: 6, text: `Contract ${c.title} moved from v${c.from} to v${c.to}; its consumers may have to catch up.` });
  for (const a of assumptions.settled) ranked.push({ w: a.status === "refuted" ? 6 : 3, text: `Assumption ${a.label} ${a.status === "refuted" ? "did not hold" : a.status === "confirmed" ? "held" : "became a decision"}: ${a.statement}.` });
  for (const q of questions.answered) ranked.push({ w: 4, text: `${q.label} answered: ${q.answer ?? ""}.` });
  for (const h of removed) ranked.push({ w: 5, text: `Section "${h}" was removed from the document.` });
  for (const h of added) ranked.push({ w: 4, text: `Section "${h}" is new in the document.` });
  for (const s of changed) {
    const delta = Math.abs(s.wordsAfter - s.wordsBefore);
    if (delta >= 40 || delta >= Math.max(1, s.wordsBefore) * 0.3) ranked.push({ w: 4, text: `Section "${s.heading}" was rewritten (${s.wordsBefore} → ${s.wordsAfter} words).` });
  }
  if (cards.added.length) ranked.push({ w: 3, text: `${cards.added.length} new card${cards.added.length === 1 ? "" : "s"}: ${cards.added.map((c) => c.title).join(", ")}.` });
  if (cards.removed.length) ranked.push({ w: 3, text: `${cards.removed.length} card${cards.removed.length === 1 ? "" : "s"} removed: ${cards.removed.map((c) => c.title).join(", ")}.` });
  const major = ranked.sort((a, b) => b.w - a.w).slice(0, 10).map((r) => r.text);

  return {
    from: at.from,
    to: at.to,
    sections: { added, removed, changed, unchanged },
    words: { before: words(norm(mdBefore)), after: words(norm(mdAfter)) },
    decisions: { added: dAdded, superseded: dSuperseded, statusChanged: dStatus },
    model,
    constraints,
    contracts,
    assumptions,
    questions,
    cards,
    major,
  };
}

/** The comparison as a Markdown document: "Major changes" on top, then every category in full. */
export function comparisonMarkdown(c: DesignComparison, docTitle: string): string {
  const day = (iso: string) => iso.slice(0, 10);
  const out: string[] = [];
  out.push(`# Changes: ${docTitle} v${c.from.versionNo} → v${c.to.versionNo}`, "");
  out.push(`_v${c.from.versionNo} of ${day(c.from.at)} compared with v${c.to.versionNo} of ${day(c.to.at)}; ${c.words.before} → ${c.words.after} words._`, "");
  out.push("## Major changes", "");
  if (c.major.length === 0) out.push("Nothing of substance changed between these versions.");
  for (const m of c.major) out.push(`- ${m}`);
  out.push("");
  if (c.model && (c.model.added.length || c.model.removed.length || c.model.changed.length || c.model.addedRels.length || c.model.removedRels.length)) {
    out.push("## Architecture model", "");
    for (const x of c.model.added) out.push(`- Added **${x.name}** (${x.kind}${x.technology ? `, ${x.technology}` : ""})${x.boundary ? ` in ${x.boundary}` : ""}`);
    for (const x of c.model.removed) out.push(`- Removed **${x.name}** (${x.kind})`);
    for (const { before: b, after: a } of c.model.changed) out.push(`- **${a.name}**: ${[b.name !== a.name ? `was ${b.name}` : "", b.kind !== a.kind ? `${b.kind} → ${a.kind}` : "", (b.technology ?? "") !== (a.technology ?? "") ? `${b.technology ?? "no technology"} → ${a.technology ?? "no technology"}` : "", (b.boundary ?? "") !== (a.boundary ?? "") ? `${b.boundary ?? "no boundary"} → ${a.boundary ?? "no boundary"}` : ""].filter(Boolean).join("; ")}`);
    for (const r of c.model.addedRels) out.push(`- New relationship: ${r.from} ${r.kind.replace("_", " ")} ${r.to}${r.label ? ` (${r.label})` : ""}`);
    for (const r of c.model.removedRels) out.push(`- Dropped relationship: ${r.from} ${r.kind.replace("_", " ")} ${r.to}`);
    out.push(`- ${c.model.same.length} component${c.model.same.length === 1 ? "" : "s"} unchanged`, "");
  }
  if (c.decisions.added.length || c.decisions.superseded.length || c.decisions.statusChanged.length) {
    out.push("## Decisions", "");
    for (const d of c.decisions.added) out.push(`- **${d.label}** new, ${d.status}: ${d.statement}`);
    for (const d of c.decisions.superseded) out.push(`- **${d.label}** superseded: ${d.statement}`);
    for (const { before: b, after: a } of c.decisions.statusChanged) out.push(`- **${a.label}** ${b.status} → ${a.status}: ${a.statement}`);
    out.push("");
  }
  if (c.constraints.added.length || c.constraints.removed.length || c.constraints.changed.length) {
    out.push("## Constraints", "");
    for (const k of c.constraints.added) out.push(`- **${k.id}** new (${k.kind.replace("_", " ")}, ${k.category.replace("_", " ")}): ${k.statement}`);
    for (const k of c.constraints.removed) out.push(`- **${k.id}** removed: ${k.statement}`);
    for (const { before: b, after: a } of c.constraints.changed) out.push(`- **${a.id}** changed: ${b.statement} → ${a.statement}`);
    out.push("");
  }
  if (c.contracts.added.length || c.contracts.removed.length || c.contracts.changed.length) {
    out.push("## Contracts", "");
    for (const t of c.contracts.added) out.push(`- New: ${t}`);
    for (const t of c.contracts.removed) out.push(`- Removed: ${t}`);
    for (const k of c.contracts.changed) out.push(`- ${k.title}: v${k.from} → v${k.to}`);
    out.push("");
  }
  if (c.assumptions.added.length || c.assumptions.settled.length || c.questions.asked.length || c.questions.answered.length) {
    out.push("## Assumptions and questions", "");
    for (const a of c.assumptions.added) out.push(`- Assumption **${a.label}** recorded: ${a.statement}`);
    for (const a of c.assumptions.settled) out.push(`- Assumption **${a.label}** ${a.status === "refuted" ? "did not hold" : a.status === "confirmed" ? "held" : "became a decision"}: ${a.statement}`);
    for (const q of c.questions.asked) out.push(`- Question **${q.label}** asked: ${q.text}`);
    for (const q of c.questions.answered) out.push(`- Question **${q.label}** answered: ${q.text} → ${q.answer ?? ""}`);
    out.push("");
  }
  out.push("## Document sections", "");
  for (const h of c.sections.added) out.push(`- New: ${h}`);
  for (const h of c.sections.removed) out.push(`- Removed: ${h}`);
  for (const s of c.sections.changed) out.push(`- Changed: ${s.heading} (${s.wordsBefore} → ${s.wordsAfter} words)`);
  out.push(`- ${c.sections.unchanged} section${c.sections.unchanged === 1 ? "" : "s"} unchanged`, "");
  if (c.cards.added.length || c.cards.removed.length || c.cards.changed.length) {
    out.push("## Other cards", "");
    for (const x of c.cards.added) out.push(`- New ${x.type.replace("_", " ")}: ${x.title}`);
    for (const x of c.cards.removed) out.push(`- Removed ${x.type.replace("_", " ")}: ${x.title}`);
    for (const x of c.cards.changed) out.push(`- ${x.title}: v${x.from} → v${x.to}`);
    out.push("");
  }
  return out.join("\n");
}
