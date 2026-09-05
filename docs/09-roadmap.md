# Tandem roadmap

Plan of record from 2026-09-05. Everything built so far is listed in `05-poc-plan.md` section 7; the earlier backlog is folded into this document, which replaces `08-backlog.md` as the place to look for what is next.

## Where the product stands

The POC does the moment of collaboration well: two to five people in one AI conversation, turns batched and attributed, a governed canvas with proposals and decision points, versions and forks, a compiled design document, per-person AI credentials and per-person external tools with gated writes, a running brief for long sessions, and an export with provenance.

It is weak on either side of that moment. Underneath, diagrams are free text with no model, so consistency depends on the AI behaving. Around it, only people who are online can take part, and decisions are statements rather than records. After it, nothing carries into the next session.

The roadmap fixes those three things in that order: **depth**, **reach**, **memory**. Each phase is a set of two-to-five-day items that can ship independently and are demoable on the offline provider.

## Principles that stay fixed

- The ledger is the truth; every new capability is new event types and a reducer change first, UI second.
- Attribution survives everything: models, decisions, threads, digests, exports.
- Governance is one mechanism: additive applies, cross-owner waits, destructive and outbound need the owner, contradictions become decision points. New artifact types inherit it rather than inventing their own.
- Each person's credentials and tools stay their own. Nothing runs on someone else's account.
- The offline provider learns every new behaviour so the demo script and smoke test cover it without a seat.

---

## Phase A: depth (the canvas means something)

### A1. Architecture model under the diagrams

**What.** A canonical model per session: components (service, database, queue, external system, UI, person), relationships (calls, publishes, subscribes, reads, writes) with labels, and boundaries (a system, a team, a trust zone). Diagrams become views generated from the model: context, container, and a focused view of one component. Free Mermaid cards remain allowed for anything the model does not cover.

**Why.** Renames propagate. A component can be clicked to see every decision and requirement about it. The data model links each entity to the component that owns it. The coherence check in the spec becomes a check against structure instead of a prompt.

**Design.** New artifact type `arch_model` (one per session, created by the AI or by hand), content `{ components, relationships, boundaries, sections }`. New tools `upsert_components`, `upsert_relationships`, `remove_from_model` with the same governance as `update_artifact` (the model has an owner; others' changes are proposals). `view` cards carry `{ kind: "context" | "container" | "component", focus?: componentId }` and render Mermaid generated from the model at render time, so they never go stale. Decisions get an optional `about: componentId[]`; data model entities get `ownedBy: componentId`. Prompt: the model is rendered as a compact structured list on every turn with the instruction that it is the source of truth for diagrams.

**Acceptance.** Alice: "Service A publishes OrderPlaced to Kafka; Service B subscribes and writes to Postgres." → model with four components and three relationships, a context view. Bob renames Service B to Fulfilment through the model; every view updates; the decision recorded against Service B now reads Fulfilment. Clicking Kafka in a view lists D-01.

**Effort.** Five days. First item because everything after it is better on top of it.

### A2. Decisions as records (ADR grade)

**What.** `record_decision` grows context, options considered with their trade-offs, consequences, and `about` components. The Decisions tab shows the record; the export writes each decision in ADR form; an "export ADRs" action produces one Markdown file per decision, and, when a GitHub MCP tool is registered, the AI can commit them to `docs/adr` through the same outbound gate as any other write.

**Why.** It makes Tandem the place decisions are made, not merely discussed, and leaves the repository with the artefact architects already keep.

**Acceptance.** A resolved decision point produces an ADR with the options that were voted on; "commit the ADRs to the repo" proposes a GitHub write naming the repository and path; after approval the files exist.

**Effort.** Three days. Depends on A1 only for the `about` links.

### A3. Constraints the AI designs against

**What.** A `constraints` card: non-functional targets and hard constraints (latency, data residency, budget, mandated platforms, compliance), each attributed and with a source (a person or an uploaded document). Rendered in every prompt. On each turn the AI checks new or changed structure against them and raises a decision point, not a silent change, when a proposal conflicts.

**Why.** Uploads already carry business rules; this makes them enforceable and gives the coherence check something to check against.

**Acceptance.** A constraint "no data leaves the EU" and a directive "back up orders to a US bucket" yields a decision point citing the constraint and who set it.

**Effort.** Three days. Independent of A1; better with it.

### A4. Alternatives side by side

**What.** "Explore alternatives" asks the AI for two or three candidate architectures. Each becomes a branch: a labelled group of cards with its own model view, plus a trade-off table card that cites the constraints. A decision point chooses; the losing branches are kept, folded, and marked.

**Why.** This is how architects actually think, and forks already exist; this is forking with intent inside one session.

**Acceptance.** Three candidate branches appear; picking one records the decision with the others as options considered (A2), and the model (A1) is set from the chosen branch.

**Effort.** Four days. Depends on A1 and A2.

### A5. As-is from code

**What.** With a GitHub MCP registered, "draw the current architecture of repository X" reads the repository through that person's tool and populates the model as the as-is state; target-state work is then shown as a diff view (added, removed, changed components).

**Why.** Most design sessions start from something that exists, and the as-is versus to-be view is what stakeholders ask for.

**Acceptance.** Against the Tandem repository itself: the model shows the server, the web app, SQLite, the Copilot runtime, and the MCP servers; adding a Redis component shows as a to-be change.

**Effort.** Four days. Depends on A1; reads only, so no new governance.

---

## Phase B: reach (people who are not in the room)

### B1. Asynchronous participation

**What.** Decision points get an optional deadline and can be voted on from a link without opening the canvas. A digest, built from the brief and the ledger, summarises what changed since a person last looked, with the decisions waiting on them first. A person can be mentioned in a message or a note to request their input; they see it in the digest. Digests post to Slack or Teams through a registered MCP tool when one exists, and are otherwise in-app.

**Why.** Five people are never all live. The brief already exists; this turns it into a call to action.

**Acceptance.** Bob is offline while Alice raises a decision point with a deadline; Bob's digest shows it first; voting from the link resolves it; the deadline passing without a majority records the point as expired rather than silently open.

**Effort.** Five days. No dependency on Phase A.

### B2. Threads anchored to cards

**What.** Comments on a specific card or a component in a view, threaded, human-only like the side channel, with "promote to AI" carrying the anchor so the AI knows what "this boundary is wrong" refers to.

**Effort.** Three days. Anchoring to components needs A1; anchoring to cards does not.

### B3. Review and sign-off

**What.** A reviewer role that can comment, vote, and propose but not edit directly. The design document gets a status (draft, in review, approved) with named sign-offs recorded as decisions; changing the canvas after approval moves it back to draft with a note of what changed.

**Why.** Architecture review boards want a document with a status, and the ledger already proves who agreed to what.

**Effort.** Three days.

### B4. Notifications through existing tools

**What.** Events that matter (decision point raised, proposal waiting on you, document approved) go out through a person's registered Slack or Teams MCP tool, governed like any outbound write but pre-approvable per channel.

**Effort.** Two days. Depends on the MCP work already shipped and on B1 for the digest.

---

## Phase C: memory (sessions compound)

### C1. Organisation library

**What.** Search across a person's sessions for decisions, components, and constraints. The AI can cite earlier sessions with attribution ("three earlier sessions chose Kafka for order events, agreed by …") and pull a decision or a component in as a starting point, linked back to its origin.

**Design.** A cross-session index of decisions and model components (SQLite full-text search in the POC), a `library_search` tool the AI may call, and an `imported_from` provenance field on anything copied in.

**Effort.** Five days. Depends on A1 and A2 for anything worth indexing.

### C2. Templates

**What.** Session types (new service, integration, data migration, platform change) that seed the constraints card, the expected artifacts, and a completeness gauge the AI drives toward, so a session ends with a whole design instead of answers to whatever was last said.

**Effort.** Three days.

---

## Carried over from the earlier backlog

- **Sandboxed MCP servers.** Stdio servers run as children of the Tandem server; production needs a per-user sandbox. Production item; unchanged.
- **Copilot runtime MCP path on a real seat.** Wired and typechecked, not yet exercised on a seat. Needs a person with an Atlassian or GitHub MCP registered to ask the AI to publish something. Half a day, user-driven.
- **Live text co-editing.** Still deprioritised: it bypasses the proposal flow. Anchored threads (B2) cover most of what people wanted from it.
- **GitHub App instead of OAuth App.** Production item: short-lived tokens with refresh handling.
- **M4, build together.** Change sets, a sandbox workspace, agent turns, branch-per-proposal. Starts after Phase A, since A5 (as-is from code) is its first step.

---

## Order and next steps

| Order | Item | Days | Depends on |
|---|---|---|---|
| 1 | A1 Architecture model | 5 | — |
| 2 | A2 ADR-grade decisions | 3 | A1 (links) |
| 3 | B1 Asynchronous participation | 5 | — |
| 4 | A3 Constraints | 3 | — |
| 5 | B2 Anchored threads | 3 | A1 for component anchors |
| 6 | A4 Alternatives | 4 | A1, A2 |
| 7 | B3 Review and sign-off | 3 | A2 |
| 8 | A5 As-is from code | 4 | A1 |
| 9 | B4 Notifications | 2 | B1 |
| 10 | C1 Organisation library | 5 | A1, A2 |
| 11 | C2 Templates | 3 | A3 |

Roughly eight working weeks for one engineer with Claude Code driving, in shippable slices. Each item adds its stage to `07-demo-script.md` and its assertions to the smoke test before it is called done.

**Shipped 2026-09-05:** A1, the architecture model (model, generated views, tools, decision links). A2, decisions as records (ADR fields on record_decision, the Decisions tab record, ADR-form export, ADR file download, `render_adr` tool and repository commit through a registered file tool under the outbound gate, data-model `ownedBy`). B1, asynchronous participation (deadlines with expiry, vote page, home-page digest with waiting items and since-you-looked, mentions). A3, constraints (constraints card with attribution and sources, two tools, prompt enforcement, decision points that name the violated constraint, export and design-document sections). Next: B2, threads anchored to cards.
