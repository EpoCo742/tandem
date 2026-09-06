# Tandem roadmap

Plan of record from 2026-09-05. Everything built so far is listed in `05-poc-plan.md` section 7; the earlier backlog is folded into this document, which replaces `08-backlog.md` as the place to look for what is next.

## Where the product stands

Housekeeping shipped 2026-09-05: sessions can be renamed, archived (read only, out of the digest, reversible) and deleted (everything goes, forks are kept), owner only, with the changes in the ledger. Publishing shipped the same day: a design document gets a public page at a stable address with a frozen, numbered copy per version and the signatures on each; approval publishes on its own while the page is live; the owner can unpublish and restore. C1, the organisation library, and C2, templates, shipped with it (see below). Phases D (rigour) and E (presence) were added the same day and shipped the same day, item by item with smoke coverage, and B4 notifications closed the plan. Every item in the order table below is shipped; what is left is the carried-over production work (sandboxed MCP servers, GitHub App, M4) and the "not done" notes under each item.

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

**Status (2026-09-05): shipped.** `notification_rules` per person (MCP server, write tool, target JSON, events, enabled, last sent, last error); a bus-wide listener maps ledger events to recipients and texts (decision point raised, proposal waiting on you, sign-off requested, document approved, mention, flow violation; never the actor) and calls the person's tool directly, since setting the rule is the approval; routes to list, add, pause, test and remove rules; a Notifications section under credentials; the demo MCP server gains `slack_post_message`. Not done: batching several events into one message, and quiet hours.

---

## Phase C: memory (sessions compound)

### C1. Organisation library

**What.** Search across a person's sessions for decisions, components, and constraints. The AI can cite earlier sessions with attribution ("three earlier sessions chose Kafka for order events, agreed by …") and pull a decision or a component in as a starting point, linked back to its origin.

**Design.** A cross-session index of decisions and model components (SQLite full-text search in the POC), a `library_search` tool the AI may call, and an `imported_from` provenance field on anything copied in.

**Effort.** Five days. Depends on A1 and A2 for anything worth indexing.

**Status (2026-09-05): shipped.** SQLite FTS5 index over decisions, components, constraints and published documents, rebuilt per session from the ledger whenever the ledger moved. Scope: the sessions a person is in, plus every session that has a live published document (publishing is how a session enters the organisation's memory). A `/library` page with kind filters and links into the session on the right card; a read-only `library_search` tool with a prompt rule to cite and never invent precedent; `importedFrom` on decisions, components and constraints, shown as a "from …" chip. "Copy into…" on the library page copies a decision (as proposed), a component or a constraint into one of your sessions without an AI turn, through the same governance as a hand edit. Ranking is bm25 with the title weighted.

### C2. Templates

**What.** Session types (new service, integration, data migration, platform change) that seed the constraints card, the expected artifacts, and a completeness gauge the AI drives toward, so a session ends with a whole design instead of answers to whatever was last said.

**Effort.** Three days.

**Status (2026-09-05): shipped.** Four templates in `shared/src/templates.ts` (new service, integration between systems, data migration, platform change), each with default constraints seeded on the Constraints card at creation (set by the creator, `source: template:<id>`) and a checklist evaluated from the ledger: model size and kinds, named cards by title, constraints by category, agreed decisions, as-is, alternatives chosen, document compiled and signed off. The prompt carries the checklist with the template's guidance and a rule to steer, not invent; the side pane has a Checklist tab and the top bar a gauge; `GET /sessions/:id/checklist` serves it for digests. Forks keep the template. Not done: editing templates in the product (they are code), and per-organisation templates.

---

## Phase D: rigour (the model can be checked, replayed and reused)

Added 2026-09-05. Phase D deepens the model so more of governance becomes deterministic (fewer AI turns, fewer tokens) and the session's history becomes something people can walk through. Each item is a ledger event type and a reducer change first, then UI; each is demoable on the offline provider and adds a stage to `07-demo-script.md` and assertions to the smoke test.

### D1. Data-flow classification

**What.** Relationships carry the classes of data they move (PII, payment, health, credentials, public, internal). Boundaries carry a region and a trust level. Data residency and security constraints become checks the server runs, not judgements the AI makes: "PII crosses the EU boundary over a relationship marked public" is a violation the moment the model changes, by hand or by the AI, with no turn spent.

**Design.** `dataClasses` on `ModelRelationship`, `region` and `trust` on `ModelBoundary`; a `checkConstraints(model, constraints)` in shared that maps the data residency, security and compliance categories to rules over flows and placement; `model.violations` derived in the reducer; the model card and the views show a violation chip per relationship; a hand edit that introduces a violation applies but raises a system message and, in hybrid policy, a decision point naming the constraint. This also settles the parked "constraint check after hand edits" for the categories that matter, without a token.

**Effort.** Four days. Depends on A1, A3.

**Status (2026-09-05): shipped.** `dataClasses` on relationships, `region` and `trust` on boundaries (tools and hand edits alike); `checkFlows` in shared maps data residency and compliance constraints that name a region, and security constraints that speak of public exposure, to rules over classified flows; `applyVersion` in governance diffs violations before and after every model or constraints change and records `flow.violation` (a system line in the lane) plus, under hybrid, a system-raised decision point naming the constraint that blocks the model, one per constraint at a time. Views draw violating edges in red with the data classes on the label; the model card shows a violation count and per-relationship chips; the offline provider records "X sends customer PII to Y in the US". This is the deterministic form of the parked hand-edit constraint check for residency and security; other categories still rely on the AI.

### D2. Deployment view

**What.** A second layer under the model: environments, regions, zones and nodes (a cluster, a VM, a managed service), with components placed on them. A generated deployment view (C4 level 4) per environment. Capacity, availability and residency constraints check against placement (a database outside the EU, a single node for a component with an availability constraint).

**Design.** `deployment` on `ArchModelContent` (nodes with `kind`, `region`, `parent`; placements `componentId → nodeId` per environment), `upsert_deployment` tool, view kind `deployment` with an environment filter, D1's checker extended to placement. The as-is scanner reads compose and Kubernetes manifests into nodes when present.

**Effort.** Four days. Depends on A1, D1.

**Status (2026-09-05): shipped.** `deployment` on the model (environments, nodes nested by parent with region, trust and technology, placements per environment); `upsert_deployment` tool and prompt rule; view kind `deployment` with an environment; `nodeOf` and `nodeAttr` let the flow checks use placement before the boundary; placements listed on the model card, in the prompt and the export; new-service and platform-change templates ask for the view; the offline provider records "X runs on Y in the EU (production)". Not done: reading compose or Kubernetes manifests into nodes during as-is capture.

### D3. Session replay

**What.** A time slider over the session. Drag it and the canvas, the decision registry and the constraints show what they were at that moment, with the lane scrolled to the messages of the time. The reducer is pure and the ledger is complete, so this is a fold up to a sequence number, not a new store. The same fold gives "model diff between any two commits", not only as-is against to-be.

**Design.** `reduceUpTo(events, seq)` in shared with a memoised checkpoint every N events; a read-only canvas mode that renders a past state (no editing, no threads, a "back to now" button); a compare picker on the model card that shows the D-style diff view between two commits.

**Effort.** Three days. Depends on nothing new; A5 for the diff view.

**Status (2026-09-05): shipped.** `reduceUpTo` in shared; the client folds its own copy of the ledger (it already holds every event) so replay needs no server call; slider with commit and decision marks, keyboard stepping, read-only mode (composer and card actions hidden), live events buffered and restored on "back to now". `diffModels` and `compareMermaid` generalise the as-is diff; the model card's "compare with" picker draws any earlier version against now. Checkpointing was not needed at POC sizes.

### D4. Impact analysis

**What.** Click a component and get a deterministic report: decisions that name it, constraints it is subject to (after D1, the flows it takes part in), views and alternatives it appears in, documents and threads that mention it, and what would dangle if it were removed. "What breaks if we drop Kafka" without a turn.

**Design.** `impactOf(state, componentId)` in shared over the model, decisions, constraints, threads and the design document text; an Impact panel opened from the model table and from a node in a view; a `remove_from_model` pre-check that lists the impact in the tool result so the AI names it before removing.

**Effort.** Two days. Depends on A1, A2; better after D1.

**Status (2026-09-05): shipped.** `impactOf` and `impactLines` in shared over relationships, decisions (by id or by name), constraints naming it, views drawing it, alternatives containing it, text mentions in documents and cards, anchored threads, and an "if removed" summary; Impact panel from the model table with links into each finding; `GET /sessions/:id/impact/:componentId`; `remove_from_model` returns the impact per removed component and the prompt asks the AI to repeat it.

### D5. Contracts as first-class cards

**What.** An API or event contract (an OpenAPI or AsyncAPI fragment, or a plain schema) as a card attached to a relationship or a component. A change to the contract flags every consumer in the model; the library indexes contracts; the integration template's contract item points at this card type instead of a title match.

**Design.** Artifact type `contract` with `format`, `body`, `attachedTo` (relationship or component id) and a `version`; a `consumers` derivation from the model; a "contract changed since v" chip on consuming components; `upsert_contract` tool; export and design-document sections.

**Effort.** Three days. Depends on A1.

**Status (2026-09-05): shipped.** Artifact type `contract` with format, body, `attachedTo` (relationship or component) and a version label; `contractsOf` in shared derives provider and consumers from the model's relationships and flags contracts that changed after the model last changed; the model table shows "contract vN" or "contract changed" on consumer rows; `upsert_contract` tool with a prompt rule; the card renders Markdown or the raw text; the editor edits the body; export section, library kind and a `GET /sessions/:id/contracts` route; the integration and new-service templates accept a contract card for their contract item. Not done: schema-aware diffs between contract versions.

### D6. Sequence diagrams from the model

**What.** Choose a starting component and a path through the relationships, and get the sequence diagram deterministically. Stored as a view (kind `sequence`) so it regenerates when the model changes, like the other views.

**Design.** `pathsFrom(model, start, depth)` and `sequenceMermaid(model, path)` in shared; a picker on the model card; the AI gets the same through a `create_view` kind instead of drawing free Mermaid; the integration template's sequence item accepts either.

**Effort.** Two days. Depends on A1.

**Status (2026-09-05): shipped.** `pathFrom` and `sequenceMermaid` in shared; view kind `sequence` with `focus` as the start and `depth`; "sequence from" picker on the model card creates the view by hand; the offline provider answers "draw a sequence diagram for X"; the prompt prefers the view over hand-drawn sequence Mermaid; the integration template's checklist accepts either; exports render it from the model. Choosing an explicit path (instead of breadth-first from a start) was not done.

### D7. Assumptions register

**What.** Things believed true but not decided, each with an owner and a revisit date, separate from decisions. The AI records "we assume …" statements here, flags a later message that contradicts one, and offers to turn it into a decision or a decision point. Decisions gain an optional revisit date too, and the digest lists what is due.

**Design.** `assumption.recorded`, `assumption.resolved` events; `state.assumptions`; `record_assumption` tool and a prompt rule; the Decisions tab gets an Assumptions section; the export and the design document get a section; the digest's waiting list gets "assumptions to revisit".

**Effort.** Three days. Depends on A2, B1.

**Status (2026-09-05): shipped.** `assumption.recorded` and `assumption.resolved` events; `state.assumptions` with labels A-01…; `record_assumption` and `resolve_assumption` tools with a prompt rule, and an "Assumptions" section in the prompt; `revisitAt` on decisions; `dueForRevisit` feeds the digest's waiting list (my assumptions, the session's decisions) and the home page shows "due a look"; Assumptions section in the Decisions tab with held / did not hold and an add-by-hand form with a date; routes for both; export section; the offline provider records "we assume …" and settles on "actually …".

### D8. Import from existing notation

**What.** Paste Mermaid (flowchart), PlantUML (component) or Structurizr DSL and get a model, with what could not be mapped listed as notes. Export Structurizr DSL alongside Markdown so the model can leave.

**Design.** Parsers in `shared/src/import/` (Mermaid flowchart first, since it is the most common paste; Structurizr second; PlantUML third), each returning `{ components, relationships, boundaries, notes }` like `scanRepo`; an Import button on the model card that previews before applying through the usual governance; `set_as_is` accepts the same input so a pasted diagram can be the baseline; a Structurizr DSL exporter next to the Markdown export.

**Effort.** Four days. Depends on A1, A5.

**Status (2026-09-05): shipped.** `shared/src/notation.ts`: parsers for Mermaid flowcharts (shapes, edge labels, chains, `&`, subgraphs), Structurizr DSL (people, software systems with containers as boundaries, groups, relationships lifted from components to containers) and PlantUML component diagrams (declarations, aliases, packages, arrows with labels), each returning components, relationships, boundaries and notes; notation detection; `toStructurizrDsl` exporter. `POST /sessions/:id/model/import` previews or applies (merge, replace, as-is) through `requestChange`; `?format=structurizr` on the export route; an import dialog and a `.dsl` link on the model card; unit tests for all three parsers and the exporter. Not done: C4-PlantUML macros and Mermaid C4 diagrams.

---

## Phase E: presence (the session looks alive and reads well)

Added 2026-09-05. Phase E is visual and experience work. Nothing here changes governance; most of it reads state the ledger already has. Items are small and can ship between Phase D items.

### E1. Change glow

**What.** When a card changes, the rows or nodes that changed light up for a few seconds, and cards changed since you last looked carry a mark until you open them. The digest already knows "since"; the canvas should show it.

**Design.** Per-card diff of consecutive versions in the reducer (`changedRows` on the latest version for tables, node ids for views); a CSS transition keyed on version; the `participants.last_seen_seq` already tracked drives the "since you looked" mark.

**Effort.** Two days.

**Status (2026-09-05): shipped.** Card glow and per-row glow on version change (model components and constraints, diffed against the previous version client-side); "new" chip and accent edge on cards changed after the reader's last seen sequence, cleared on touch; reduced-motion respected.

### E2. Live cursors and selection, with a visibility toggle

**What.** Each person's cursor and selected card shown on the canvas in their colour. A toggle in the top bar with three states: see others and be seen (default), see others but hide me, hide everyone. The choice is per person and per session, remembered, and honoured on both sides: someone who hides themselves is not shown to anyone, and someone who hides others still broadcasts unless they also hide themselves.

**Design.** Yjs awareness already carries presence; add cursor position and selection to it, plus a `visible` flag; the canvas renders cursors from awareness for participants whose flag is on; the toggle writes the flag and a local preference; a note in the presence strip says "3 present, 1 hidden".

**Effort.** Two days.

**Status (2026-09-05): shipped.** Cursor (flow coordinates, throttled), selected card and a `visible` flag travel in Yjs awareness; others' cursors render in a viewport portal in their colour with a name tag; a selected card gets an outline and a chip; the three-state toggle is per session in local storage and honoured on both sides; hidden people are dimmed in the presence strip.

### E3. Coloured boundaries

**What.** Trust zones, teams and systems get their own tint in every generated view, consistent across views and the deployment view; nodes show technology and decision count on hover; hovering a relationship highlights both ends.

**Design.** A `color` on `ModelBoundary` chosen from the participant palette's neighbours, set on creation and editable on the model card; `modelToMermaid` emits `classDef` per boundary; hover behaviour on the rendered SVG through data attributes the renderer already leaves on nodes.

**Effort.** One day. Depends on A1.

**Status (2026-09-05): shipped.** `color` on boundaries with a palette fallback by position so every view agrees; `style` lines in every generated view (container, context, component, diff, compare); swatches on the model table and a legend with a colour picker that writes a new model version through the usual governance; `upsert_components` accepts `boundaries` (name, kind, colour). Hover details and relationship highlighting were not done (Mermaid's strict mode blocks click handlers; would need SVG post-processing).

### E4. Presentation mode

**What.** Full-screen walkthrough of the canvas in an order you set: one card per screen, the AI lane and side pane hidden, the decision log as the closing screen, arrow keys to move. For presenting a design to people who were not in the session.

**Design.** An ordered list of card ids stored in the Yjs layout document (so it is shared and not in the ledger); a `/s/:id/present` route reusing the card renderers at large size; a "present" button in the top bar; Escape returns.

**Effort.** Two days.

**Status (2026-09-05): shipped.** Present button, full-screen overlay reusing the card renderers at large size, keyboard and click navigation, an arrange panel (include or leave out, move up or down, reset to canvas order) writing a `present` array in the Yjs layout document, decision log and assumptions as the closing screen. A separate route was not needed.

### E5. Published page polish

**What.** A table of contents, a print stylesheet, diagram zoom, a link preview image, and the version picker moved into a sidebar. The page outsiders see should look finished.

**Design.** Headings collected client-side into a sticky sidebar; `@media print` rules; click-to-enlarge on Mermaid SVGs; an `og:image` rendered server-side from the title and status (a small SVG-to-PNG step, or a static image if that costs too much); the `.md` link kept.

**Effort.** One day.

**Status (2026-09-05): shipped.** Sticky sidebar with the version picker, status, a contents list built from the rendered headings, `.md` and print; print stylesheet; click-to-enlarge diagrams; the SPA fallback injects title, description and Open Graph tags for `/p/<slug>` with a server-drawn SVG preview at `/p/<slug>/preview.svg`.

### E6. Session thumbnails

**What.** A small preview of the canvas on the home page rows and on library hits, so a session is recognised by its shape, not its title.

**Design.** The client renders a thumbnail from the layout document and card types (coloured rectangles, no content) and posts it to the server on leave; stored per session, served with the session list; regenerated when the layout changes.

**Effort.** One day.

**Status (2026-09-05): shipped.** The canvas draws an SVG of card rectangles tinted by type from the shared layout and puts it on `PUT /sessions/:id/thumbnail` (plain SVG only, size-capped) four seconds after the layout settles and when the tab leaves; the session list returns it and the home page rows show it. Library hits do not show it (their sessions may not be the reader's).

### E7. Guided empty state per template

**What.** A blank templated canvas suggests the first prompt and shows the checklist's first three items as the plan: "Start by describing the systems involved; then state the limits; then ask for the data model". Blank sessions get a lighter version: three example prompts.

**Design.** A `starters` list per template in `templates.ts`; an empty-state panel on the canvas that disappears once the first card exists; clicking a starter puts it in the composer.

**Effort.** Half a day. Depends on C2.

**Status (2026-09-05): shipped.** `starters` per template and `BLANK_STARTERS`; an empty-canvas panel with the template's summary, the starters (click puts one in the composer) and the first three open checklist items; gone once a card other than the seeded constraints exists.

---

## Readable diagrams (added 2026-09-06)

Generated views now render through Mermaid's ELK layout (orthogonal edges, balanced layers; dagre as a fallback per diagram), declare nodes in reading order by kind with invisible bridges between unconnected layers, pick top-down or left-right from the model's shape with a per-view override, style every kind the same way on every diagram, keep edge labels short, and carry a legend (derived from the diagram source, so it works on cards, the published page, presentation mode and the Markdown export). The system prompt gained rules for the AI's hand-drawn Mermaid. Not done: manual node placement, which would need views drawn with React Flow instead of Mermaid.

## Built-in demo (added 2026-09-05)

A complete session shipped as a fixture and loaded at start on every install: read only for everyone, replayable from the first event, never published, forked or deleted, out of the digest, and present in the library only through its design document. Captured from `demo.mjs` with the publish and fork stages skipped; refreshed by re-running the seeder and `export-demo-fixture.mjs` (see `07-demo-script.md`). `TANDEM_DEMO=0` disables it.

## Carried over from the earlier backlog

- **Constraint check after hand edits.** Direct edits of the model or of free Mermaid cards are not checked against the constraints; only the AI's own changes are. The cheap version tells the AI on its next turn that the model changed by hand so it re-checks; the user's concern is that this spends tokens on every turn after a manual edit. Park until there is evidence of hand edits breaking constraints.
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
| 10 | C1 Organisation library (shipped, with publishing) | 5 | A1, A2 |
| 11 | C2 Templates (shipped) | 3 | A3 |
| 12 | E1 Change glow | 2 | — |
| 13 | D3 Session replay | 3 | A5 |
| 14 | D4 Impact analysis | 2 | A1, A2 |
| 15 | E2 Live cursors with visibility toggle | 2 | — |
| 16 | D1 Data-flow classification | 4 | A1, A3 |
| 17 | E3 Coloured boundaries | 1 | A1 |
| 18 | D6 Sequence diagrams from the model | 2 | A1 |
| 19 | E7 Guided empty state | 0.5 | C2 |
| 20 | D5 Contracts as cards | 3 | A1 |
| 21 | D7 Assumptions register | 3 | A2, B1 |
| 22 | E4 Presentation mode | 2 | — |
| 23 | E5 Published page polish | 1 | — |
| 24 | D2 Deployment view | 4 | A1, D1 |
| 25 | D8 Import from existing notation | 4 | A1, A5 |
| 26 | E6 Session thumbnails | 1 | — |
| 27 | B4 Notifications (shipped) | 2 | B1 |

Roughly eight working weeks for one engineer with Claude Code driving, in shippable slices, for items 1 to 11; items 12 to 27 add about seven more. Each item adds its stage to `07-demo-script.md` and its assertions to the smoke test before it is called done.

**Why this order for 12 to 27.** Start with two visible wins that need no new model work (change glow, replay), then impact analysis because it reuses the library index. Data-flow classification next, since deployment view and the hand-edit constraint check both build on it, with the small visual items (coloured boundaries, guided empty state) slotted between larger ones. Contracts and assumptions extend what the AI can record and the templates can check. Presentation mode and the published page polish come once there is more to show. Deployment view and import are the largest and least urgent. B4 notifications stays last at the user's request; it can move up when people outside the room start asking for it.

**Shipped 2026-09-05:** A1, the architecture model (model, generated views, tools, decision links). A2, decisions as records (ADR fields on record_decision, the Decisions tab record, ADR-form export, ADR file download, `render_adr` tool and repository commit through a registered file tool under the outbound gate, data-model `ownedBy`). B1, asynchronous participation (deadlines with expiry, vote page, home-page digest with waiting items and since-you-looked, mentions). A3, constraints (constraints card with attribution and sources, two tools, prompt enforcement, decision points that name the violated constraint, export and design-document sections). B2, threads anchored to cards (notes with an anchor to a card or a model component, replies, resolve, promotion that carries the anchor and the rest of the thread as background, thread panel on every card and per component on the model table, export section). A4, alternatives side by side (propose_alternatives tool, alternatives card with per-candidate models, comparison against the constraints, Decide opens a vote, adoption sets the model and records the decision with every candidate considered, no AI turn). B3, review and sign-off (reviewer role on invites, design document status derived from review events, named sign-offs, approval recorded as a decision agreed by the signers, back to draft on any canvas change with a note, digest item for pending sign-offs, export status line). A5, as-is from code (repository manifests read through the person's read-only tool or an attachment, `scanRepo` heuristics in shared, `set_as_is` tool, as-is baseline on the model, diff view kind with added, removed, changed and unchanged, model card banner and row chips, export summary). Next: B4, notifications.

## Phase F: first feedback round (2026-09-06)

Seven things noticed in use, all shipped the same day.

| Item | What changed | Status |
|---|---|---|
| F1 Light-mode buttons | Primary buttons inside containers that reset button backgrounds (the session menu's rename, canvas tools, empty state) showed white text on white; they keep the primary look now. | shipped |
| F2 Drop to attach | A file dragged onto the AI lane is staged in the composer, the same as Attach file. | shipped |
| F3 Composer grip | The resize handle moved to the top edge: dragging up makes the box taller where it grows; remembered per browser. | shipped |
| F4 Quiet tool servers | External tool servers that connect normally no longer post a line in the lane each turn; only failures, timeouts and login requests do. | shipped |
| F5 Tidy fills the screen | Packing chooses the column count whose wall is closest to the canvas's shape, so tall diagrams spread sideways instead of forming a strip. | shipped |
| F6 Questions register | Open questions in a Questions tab (Q-nn labels, ask, answer, drop), the AI's clarifications recorded there, open ones listed in the prompt with a rule never to re-ask, answers reaching the AI without a turn, `resolve_question` tool, export and design-document sections. | shipped |
| F8 Version comparison | Any two versions of the design document compared by computation (text by section, decisions, model, constraints, contracts, assumptions, questions, cards) with a ranked major-changes list; saved as a card without an AI turn; an optional AI turn writes "What matters" on top; "changes since v n" from the publish panel. | shipped |
| F7 Contracts as API references | An OpenAPI or AsyncAPI contract renders as grouped endpoints (method, path, summary; parameters, body and responses on click) or channels, with the raw text a click away. | shipped |
