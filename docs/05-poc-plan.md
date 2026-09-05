# Tandem: Proof-of-Concept Plan

Purpose: get a working, demoable prototype running locally (and in one container) with the fewest moving pieces, without changing the real architecture in `02-architecture.md`. Every consolidation below is a swap behind an interface, with the production component named so the path back is obvious.

Decisions recorded 2026-09-03:

| Question | Decision |
|---|---|
| First provider | **GitHub Copilot** (organization already licensed). Anthropic and OpenAI adapters deferred. |
| Sponsor mode | **Yes.** Default for the POC: the session creator's Copilot token funds every turn. Speaker mode stays available as a toggle. |
| Governance | **Hybrid** only. Other policies remain in the table but are not implemented. |
| Participants | 2-5. |
| Realtime | **Self-hosted Yjs with Hocuspocus**, embedded in the app process. |
| Canvas | Structured card canvas (React Flow) with Mermaid and Markdown cards. Freehand sketch card deferred. |
| Infrastructure | No Postgres, no Redis, no S3, no KMS. One Node process, SQLite file, local disk. |

---

## 1. Consolidation map

| Production component (spec) | POC replacement | Interface that hides the swap | Path back |
|---|---|---|---|
| Postgres 16 | **SQLite** via `better-sqlite3`, WAL mode, file `./data/tandem.db` | Drizzle ORM repositories in `server/src/db` | Change Drizzle driver and run the Postgres migration set; schema is the same minus `bigserial` |
| Redis pub/sub (event fan-out) | In-process `EventEmitter` keyed by session id | `Bus.publish(sessionId, event)` / `Bus.subscribe` | Redis adapter for `Bus` |
| Redis locks + BullMQ (one turn per session) | In-process per-session `async-mutex` and a promise chain | `TurnQueue.enqueue(sessionId, job)` | BullMQ + Redlock adapter |
| S3 (uploads, exports, snapshots) | `./data/files/{sessionId}/...` | `BlobStore.put/get` | S3 adapter |
| KMS envelope encryption | AES-256-GCM with one master key from `TANDEM_MASTER_KEY` (32 bytes, hex) | `crypto.seal/unseal` | Wrap data keys with KMS |
| Separate Hocuspocus service | `@hocuspocus/server` embedded; `handleConnection` on the `/collab` WebSocket upgrade; documents persisted to SQLite table `yjs_documents` | none needed | Move to its own process, same hooks |
| API gateway, turn broker, ingestion worker, compiler worker | **One Fastify process** | Module boundaries only | Split by process later |
| Next.js app | **Vite + React SPA**, served as static files by Fastify in demo mode | none | Keep the SPA; Next.js is not required by the architecture |
| Auth.js | Hand-rolled GitHub OAuth (two routes) + signed cookie | `req.user` | Swap to Auth.js if needed |
| Haiku screening call (Anthropic) | Deterministic ownership check in the tool executor, plus the main model instructed to check the decision registry and call `create_decision_point` itself | `screen(batch)` returns the same `ScreenResult` shape | Reinstate the separate screening call when Anthropic adapter lands |
| Brief update + compaction | Skipped; transcript window only (demo sessions are short) | `assembleContext` | Add brief update job |
| Coherence check | Skipped | | |
| Forks, DOCX/PDF export, PDF ingestion | Skipped; Markdown export only; uploads limited to images, `.md`, `.txt`, `.mmd` | | |

Result: **two processes in development** (`vite` and the server), **one container in demo mode**.

---

## 2. Copilot provider adapter, concretely

Package: `@github/copilot-sdk` (Node). The SDK bundles the Copilot CLI runtime for Node, so nothing else is installed.

### 2.1 Auth

- Register a **GitHub OAuth App** (simpler than a GitHub App; the docs say both work and the token flow is identical). Callback: `http://localhost:3000/auth/github/callback`.
- Scopes: GitHub's Copilot SDK docs do not list required scopes. Start with `read:user` for identity and test a Copilot call; the entitlement check is server-side on the token. Add scopes only if the runtime reports an authorization error.
- Store the `gho_` token sealed with AES-256-GCM in `provider_credentials`. OAuth App user tokens do not expire unless expiration is enabled on the app; leave it disabled for the POC.
- Each user needs an active Copilot seat **only if they will fund turns**. In sponsor mode only the session creator needs one, which makes demos easy.
- Validate at connect time by creating a client and listing models; cache the model list on the credential row.

### 2.2 One turn = one throwaway session

```ts
import { CopilotClient, defineTool, approveAll } from "@github/copilot-sdk";

export async function runCopilotTurn(req: TurnRequest): Promise<TurnResult> {
  const client = new CopilotClient({
    gitHubToken: req.credential.token,
    useLoggedInUser: false,
    baseDirectory: path.join(DATA_DIR, "copilot"),     // keeps CLI state inside ./data
    mode: "empty",                                      // no Copilot CLI default tools/prompt; verify on installed version
    logLevel: "warning",
  });
  await client.start();
  try {
    const session = await client.createSession({
      model: req.model,                                 // e.g. "claude-opus-5" if the plan has it
      streaming: true,
      systemMessage: { mode: "replace", content: req.context.system },
      tools: canvasTools(req),                          // defineTool(...) with skipPermission: true
      onPermissionRequest: approveAll,
    });
    session.on("assistant.message_delta", (e) => req.onDelta(e.data.deltaContent));
    session.on("tool.execution_start", (e) => req.onToolStart(e.data.toolName, e.data.arguments));
    session.on("assistant.usage", (e) => req.onUsage(e.data));
    const final = await session.sendAndWait({ prompt: renderPrompt(req.context), timeout: 180_000 });
    return collectResult(final, req);                   // text + executed tool calls + usage
  } finally {
    await client.stop();
  }
}
```

Notes:
- `renderPrompt` writes the brief, decision registry, artifact index, speaker-labelled transcript, and the current batch as one text prompt with clear headers. The system message carries only the frozen protocol.
- Tools are `defineTool(name, { parameters: zodSchema, handler, skipPermission: true })`. The handler is the same executor used by every adapter: it appends ledger events and returns `{ status: 'applied' | 'pending_approval' | 'stale' | 'blocked_by_decision_point', ... }`.
- Interrupt: keep the session handle; on Stop call `session.abort()` if present on the installed version, otherwise `client.forceStop()`. Partial text is persisted as an `ai.message` with `partial: true`.
- Usage: read `assistant.usage` events; record model, input and output tokens, and note that each `sendAndWait` costs one premium request times the model multiplier.
- Concurrency: at most `TANDEM_MAX_CONCURRENT_TURNS` (default 3) Copilot clients alive, enforced by a semaphore, since each client spawns a CLI process.
- Model pin: the session stores `pinned_model`; at session creation the UI shows the sponsor credential's model list and defaults to the first of `claude-opus-5`, `claude-sonnet-4.5`, `gpt-5` that is present. Exact model ids come from `client` model listing on the installed SDK; do not hardcode beyond this fallback list.

### 2.3 Sponsor mode

`sessions.payer_mode = 'sponsor'` and `sessions.sponsor_credential_id` (added for the POC directly on the session rather than on a workspace) point at the creator's Copilot credential. `selectPayer` returns it for every turn. Every AI message still carries `on_behalf_of` = the first speaker in the batch, so attribution is unchanged; only the funding credential differs. Badge text: "ran on Alice's Copilot seat (sponsor)".

---

## 3. POC repository layout

```
tandem-poc/
  package.json                 # pnpm workspaces: server, web, shared
  shared/                      # event types, tool schemas (zod), ledger reducer, DTOs
  server/
    src/
      index.ts                 # Fastify: static SPA, REST, /ws, /collab (Hocuspocus), OAuth routes
      db/                      # drizzle sqlite schema + migrations (subset of spec §2)
      ledger.ts                # appendEvent (tx: next_seq, insert, bus.publish)
      bus.ts                   # EventEmitter fan-out
      turn/                    # broker state machine, batch window, TurnQueue, payer selection
      context/                 # assembleContext, renderPrompt, system prompt
      providers/copilot.ts     # runCopilotTurn, validateCredential, listModels
      tools/                   # executors: create/update/delete artifact, record_decision, create_decision_point, ask_clarification, read_artifact
      governance/              # risk classification, hybrid gate, proposals, votes, auto-apply timers
      versions.ts              # artifact versions, commits, revert
      collab.ts                # Hocuspocus server embedded, SQLite persistence
      uploads.ts               # multipart to ./data/files, source card creation
      export.ts                # Markdown export with provenance comments
      auth.ts                  # GitHub OAuth, cookie session, crypto seal/unseal
    data/                      # tandem.db, files/, copilot/ (gitignored)
  web/
    src/
      App.tsx                  # routes: /login, /settings, /s/:id
      state/ledgerStore.ts     # zustand; applies shared reducer to events from /ws
      collab/                  # y-websocket provider to /collab, awareness
      panes/ConversationPane   # AI lane, streaming bubble, payer badge, queued state, Stop, Send now
      panes/SidePane           # side channel, promote, presence
      canvas/                  # React Flow; MermaidNode, MarkdownNode, DecisionNode, DecisionPointNode, SourceNode; ProposalCard overlay
      timeline/                # commits list, revert
  Dockerfile                   # multi-stage: build web, copy into server/public, node:22-bookworm-slim
  docker-compose.yml           # one service, volume ./data
  .env.example
```

Environment:

```
PORT=3000
APP_URL=http://localhost:3000
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
SESSION_SECRET=            # cookie signing, 32+ bytes
TANDEM_MASTER_KEY=         # 64 hex chars
TANDEM_DEFAULT_MODEL=claude-opus-5
TANDEM_MAX_CONCURRENT_TURNS=3
DATA_DIR=./data
```

Run locally: `pnpm i`, `pnpm dev` (Vite on 5173 proxying `/api`, `/ws`, `/collab`, `/auth` to 3000). Demo: `docker compose up`, open `http://localhost:3000`, two browsers (one private window) with two GitHub accounts.

---

## 4. Scope by step

| Step | Deliverable | Done when |
|---|---|---|
| P0 Skeleton (week 1) | GitHub login, connect Copilot (validate + model list), create session, invite link, consent, ledger append + `/ws` replay, presence via Yjs awareness | Two browsers see the same event stream after reload |
| P1 First turn (week 1-2) | Batch window, TurnQueue, Copilot adapter, streaming deltas to all, `create_artifact` and `update_artifact` for `markdown` and `mermaid`, React Flow canvas with Yjs layout, live Markdown editing through Yjs | The Kafka/Postgres exchange produces one diagram both users see updating live |
| P2 Governance (week 2-3) | Risk classification, hybrid gate, ProposalCard with diff and 60 s auto-apply, `record_decision`, `create_decision_point` with votes, `ask_clarification`, versions, commits, revert, blame tint | Scripted conflict yields a Decision Point, no change until vote, supersession recorded, revert works |
| P3 Demo polish (week 3-4) | Uploads (image, md, txt, mmd) to source cards, side channel + promote, sponsor/speaker toggle, payer badges, Markdown export with provenance comments, Dockerfile | `docker compose up` runs the full demo script below |

Roughly 3-4 weeks for one engineer with Claude Code driving.

---

## 5. Demo script

1. Alice signs in, connects Copilot, creates "Order platform v1" with sponsor mode on and `claude-opus-5` pinned (or the best model her plan lists).
2. Bob joins by link, consents. He does not need a Copilot seat.
3. Alice: "Service A publishes an OrderPlaced event to Kafka." Bob, within a second: "Service B subscribes to OrderPlaced and writes to the orders table in Postgres." One turn runs, both see it stream, the ARCH-01 card appears with both services and two decisions recorded to different authors.
4. Bob edits the ARCH-01 Mermaid source directly (adds a retry note). Card header shows "v2 by Bob (direct edit)".
5. Alice: "Drop Kafka, store events in Postgres." The AI raises DP-01 with three options and does not touch ARCH-01. Both vote "outbox". The AI applies it; D-01 is superseded by D-03; ARCH-01 goes to v3 with blame showing Alice and Bob via DP-01.
6. Alice asks for a data model. A `data_model` card appears; Bob's request to rename a column becomes a proposal because Alice's turn created the card; Alice approves.
7. Alice uploads a screenshot of the legacy system; a source card appears with a summary; she asks the AI to reference it in the diagram.
8. Bob reverts to the commit before step 6 to show rollback, then reverts forward.
9. Export Markdown; open it and show provenance comments and the decision log.

---

## 6. What stays exactly as designed

Ledger event types and the reducer, tool names and schemas, proposal and decision semantics, version and commit model, attribution chain, the context layout the model sees, and the provider adapter interface. The POC is the real system with cheaper infrastructure underneath it.

---

## 7. Implementation status (2026-09-03)

Implemented and verified (smoke test `server/scripts/smoke.mjs` plus a manual browser run with the offline provider): P0 skeleton, P1 first turn with streaming and the React Flow canvas, P2 governance (proposals with auto-apply timer, decision points with votes and resolution turns, versions, commits, revert, provenance highlighting), side channel with promotion, Markdown export, Dockerfile.

Deviations from the plan above:
- Direct card edits go through the versioned edit dialog rather than live Yjs text editing; Yjs carries canvas layout and presence only. Live text editing is a later addition.
- The fake provider records decisions and raises decision points deterministically; with real Copilot the model does this through the same tools and system prompt.

Added later the same day: uploads and source cards (P3) with `.mmd` files becoming diagram cards and uploaded text wrapped as untrusted source material for the AI; a "compile design document" action that runs as a normal AI turn with every artifact in context and produces a `design_doc` card (diagrams render inline); reducer unit tests.

Also added: an AI-drafted data model card; session forking (M3 item pulled forward: new session from the current canvas with agreed decisions, participants re-consent, origin link); download of the compiled document; smoke coverage for speaker-mode payment (fallback to another participant's credential, then the speaker's own) and proposal auto-apply.

2026-09-04: light and dark themes (auto follows the OS; toggle in the top bar, stored per browser) and a canvas backdrop toggle (dots, lines, off) in the canvas corner. Mermaid diagrams and the React Flow chrome follow the theme.

2026-09-04, later: first user feedback round. Cards resize (size shared through the layout document) and open full size; zoom ceiling raised; Markdown uploads render as Markdown; a file can be attached to a message and the AI sees it named in the batch with its content in context; cards can be deleted (your own sole-authored work applies at once, anything else is a proposal); a Sources tab lists uploads with locate; export opens a preview before download. Two real bugs fixed underneath: the canvas rebuilt every node object on each change and lost React Flow's measurements (cards vanishing, blank minimap), and the embedded Hocuspocus was never fed the socket frames, so layout had been browser-local since the start. The smoke test now covers the layout round-trip, attachments and delete.

Validated against a real Copilot seat on 2026-09-04: the model drives the canvas tools through the same prompt the offline provider is scripted against.

2026-09-05: compaction. Messages outside the transcript window are folded into a running brief by the provider (deterministic in the offline provider; a summarisation prompt with attribution rules on Copilot), stored as a `brief.updated` event with the seq it covers, rendered at the top of every prompt, shown in a Brief tab with a manual refresh. One provider request per compaction on the sponsor's plan; `TANDEM_COMPACT_AFTER=0` disables the automatic runs.

2026-09-05, second feedback round: GitHub OAuth confirmed working end to end (avatar and login shown in the top bar). Text uploads are kept whole (was 20k characters) and a card attached to a message gets an 80k-character allowance in the prompt; attached files are also handed to the Copilot runtime as file attachments, which is how images reach a vision-capable model. Export renders data models as tables and quotes only the top of uploaded files; the compile prompt says the same. Export preview draws diagrams at natural size and renders Markdown tables.

2026-09-05, third batch: per-user MCP servers (registered under credentials, config sealed, tools discovered by connecting; the speaker's servers are attached to their turns; MCP writes are proposed to the tool's owner through the Proposals tab and denied on timeout; reads run at once; a demo stdio server stands in for Atlassian), collapsed source cards, and an "editing" chip carried through awareness.

2026-09-05, fourth batch: standing permissions for outbound writes (approve once for a target, listed and revocable per server), external actions in the History tab and the export, and print-to-PDF from the export preview. Also card renaming, images scaling with resized cards, and a reset-to-automatic-size button.

2026-09-05, roadmap item A1: the architecture model. One `arch_model` card per session (components with kinds, technology and boundaries; relationships with kinds and labels) is the source of truth for structure; `view` cards (context, container, component) are generated from it at render time, in the prompt and in the export, so a rename propagates everywhere; three model tools with the usual governance; decisions carry `about` component ids and the model card filters the Decisions tab by component. The offline provider is model-first.

2026-09-05, roadmap item A2: decisions as records. `record_decision` carries context, options considered (chosen one marked) and consequences; the Decisions tab shows the record; the export has a "Decision records" section in ADR form; `GET /adrs` and a zip download give one file per decision under `docs/adr`; the `render_adr` tool lets the AI commit them through a registered file tool, gated like any outbound write. Data-model entities can name their owning component.

2026-09-05, roadmap item B1: asynchronous participation. Decision points take a deadline and expire without a majority (cards unblocked, question kept open); a vote page at `/s/:id/vote/:artifactId` works from a link; the home page opens with a digest (what waits on you: decision points, proposals, outbound writes; what changed since you last looked, including mentions); `@name` mentions are recorded on messages; the session reports how far each person has read.

2026-09-05, roadmap item A3: constraints. A `constraints` card (id, statement, must / must not / target, category, who set it or which document it came from) is always in the prompt; `upsert_constraints` and `remove_constraints` tools; the system prompt requires a check before structural changes and a decision point with `violatesConstraintIds` when one would break; the offline provider records stated limits and refuses region-crossing placements; export and the compiled document carry a constraints table.

Not yet done: see `09-roadmap.md` (per-user MCP servers first, then collapsed source cards, an editing indicator, live text editing, GitHub App tokens, M4).

## 8. Known POC limitations to state in the demo

- Copilot premium requests: one per turn times the model multiplier; the sponsor's allowance is consumed.
- No compaction: sessions longer than roughly 40 turns will exceed the prompt budget; start a new session.
- Hocuspocus state is in SQLite; concurrent editors on one card are fine, but there is no history for direct edits between commits.
- `mode: "empty"` and `session.abort` must be confirmed against the installed SDK version; the SDK changes monthly.
- Single process: a crash mid-turn loses the streaming text but never the ledger (events are written before broadcast).
