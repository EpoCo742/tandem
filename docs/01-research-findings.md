# Research Findings: Shared AI Sessions for Collaborative Architecture

Working name used throughout these documents: **Tandem** (placeholder, rename freely).
Date of research: 2026-09-03.

This document answers the questions in the original brief: is it possible, what already exists, what it would take, and where the real risks are. The architecture and build spec live in `02-architecture.md` and `03-technical-design-spec.md`.

---

## 1. Verdict

**The product is buildable today, with one change to the idea as written.**

| Element of the idea | Status | Notes |
|---|---|---|
| Two or more people in one shared AI conversation with one shared context | Feasible, precedented | Mixus, Microsoft Copilot Cowork, Claude Design group chat, Claude Team shared projects all ship variants. None target software architects with a canvas plus versioned artifacts. |
| Each user's own credentials pay for their turns | **Partly feasible** | GitHub Copilot: officially supported. Anthropic API key (BYOK): allowed. **Claude Pro/Max subscription login: prohibited** by Anthropic as of 2026-02-19. OpenAI ChatGPT sign-in: grants API credits, third-party use is not clearly documented, treat as unverified. |
| Canvas of AI-produced artifacts (Mermaid, ERD, docs), uploads, ingestion | Feasible, mature tooling | React Flow, Excalidraw, Mermaid, Yjs are all MIT. Claude Design is the closest UX reference. |
| Conflict detection, queued steering, approval, versioning, rollback, attribution | Feasible, but this is the novel part | No shipped product does this well. Research (MUCA, GroupGPT, CHI 2026 collaborative editing study) gives design guidance but not an implementation. This is the differentiator. |
| Compile the canvas into a full design document | Feasible | Straightforward multi-step generation pipeline with structured outputs. |
| Future: two people building an app together with the AI | Feasible later | Copilot SDK and Claude Agent SDK both provide hosted agent runtimes; the shared-session layer designed here carries over. |

---

## 2. The credential question in detail

This is the one place the brief collides with vendor policy, so it gets the most space.

### 2.1 Anthropic

Anthropic's Claude Code legal page, updated 2026-02-19, states:

> Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens.

and, for API keys:

> This does not restrict how customers provision and manage their own API keys ... provided the resulting usage is billed to the key owner under their agreement with Anthropic and is not resold or intermediated.

Consequences for Tandem:

- **Do not** build "Sign in with Claude". It is prohibited and Anthropic actively enforces it (OpenClaw and other harnesses were cut off in January and February 2026).
- **Do** let each user paste their own Anthropic Console API key. Usage bills to their Console account. This is the standard BYOK pattern used by Warp, Kodus, Cursor and many others. Store keys encrypted (AES-256-GCM, envelope key in a KMS), never send them to the browser.
- A Claude Team or Enterprise organization can issue API keys to members through the Console, so "my employer pays" works via the same BYOK path.
- Alternative for enterprises: a single "session sponsor" key configured by the workspace owner. Permitted, since the key owner is billed for their own users.

### 2.2 GitHub Copilot

The Copilot SDK went GA on 2026-06-02. GitHub's OAuth setup guide says explicitly:

> Create an SDK client for each authenticated user, passing their token ... Copilot usage is billed to each user's subscription.

Supported token types are OAuth user tokens (`gho_`), GitHub App user tokens (`ghu_`) and fine-grained PATs. Classic PATs are rejected. The app owns the OAuth lifecycle (storage, refresh, expiry).

This is exactly the model the brief describes, and it is the only major vendor that documents it as allowed. Two important details:

- **Copilot serves Claude models.** Claude Opus 5 and Sonnet 4.5 are GA inside Copilot (availability varies by plan; Free and Student plans have had flagship Claude models removed). So a Copilot Pro+ or Business user gets Claude through their subscription without an Anthropic key. Model availability is queried at runtime through the SDK.
- **The SDK is an agent runtime, not a raw chat API.** Every SDK talks JSON-RPC to a bundled Copilot CLI process. Per-user sessions mean per-user CLI processes on your server. Each prompt consumes one premium request times the model multiplier. A "simple prompt/response" mode was requested in copilot-sdk issue 182 and is still open; today you drive the agent engine with tools disabled.

### 2.3 OpenAI

Codex supports ChatGPT sign-in and API-key auth. "Sign in with ChatGPT" for third-party apps grants a one-time API credit ($5 or $50 by plan) rather than metering against the subscription. Secondary sources say OpenAI tolerates ChatGPT-subscription OAuth inside third-party harnesses, but OpenAI's own auth docs do not state a policy. **Treat as unverified; ship OpenAI as BYOK API key only until confirmed in writing.**

### 2.4 Resulting provider matrix (v1)

| Provider | Auth in Tandem | Bills to | Claude models available | Policy status |
|---|---|---|---|---|
| Anthropic API | User-pasted API key | User's Console org | All current models | Explicitly allowed |
| GitHub Copilot | GitHub OAuth (per-user token) | User's Copilot seat | Opus 5, Sonnet 4.5 (plan-dependent) | Explicitly allowed |
| OpenAI API | User-pasted API key | User's platform org | none | Allowed (BYOK) |
| Claude Pro/Max | not offered | | | **Prohibited** |
| ChatGPT Plus/Pro | not offered in v1 | | | Unverified |
| Workspace sponsor key | Admin-configured Anthropic key | Workspace | All | Allowed |

---

## 3. What already exists

### 3.1 Shipped products with shared AI conversations

| Product | What it does | What it lacks for this use case |
|---|---|---|
| **Claude Design** (Anthropic Labs, 2026-04-17) | Chat left, canvas right. Org-scoped sharing; edit access lets colleagues "modify the design and chat with Claude together in a group conversation". Exports PDF/PPTX/HTML, hands off to Claude Code. | One org, one Anthropic bill. Visual design focus, not architecture artifacts. No conflict, approval, decision or versioning model beyond edit history. Closest UX reference. |
| **Claude Team / Enterprise shared projects** | Shared project knowledge, members see uploads and responses in real time; group sharing in beta on Enterprise. | Chats are private by default; no multi-author steering model; single billing org. |
| **Mixus** | "Multiplayer chat": multiple users in one AI conversation, speaker recognition, response threading, role-based permissions (view, contributor, moderator, admin). | General business chat; no canvas, no artifact versioning, no BYO credentials. Good reference for permission tiers. |
| **Microsoft Copilot Cowork** (Frontier, experimental) | Multiple team members interact with one shared Copilot agent that edits shared documents. | M365-only, opaque architecture. Validates the category. |
| **GitHub Copilot in Teams** (2026-08-21) | Shared agentic work in Teams channels. | Chat-in-channel, not a design canvas. |
| **Liveblocks AI Copilots** | Drop-in AI chat that reads and edits Yjs/Storage state; AI spreadsheet example where an agent edits cells alongside humans. | Chat is primarily single-player; you would still design the shared-turn model yourself. Strong candidate as infrastructure. |
| **Eraser / DiagramGPT, Miro AI, FigJam AI, Lucid AI** | Text-to-diagram, AI on a collaborative board. | AI is a feature bolted onto a board, not a persistent participant with shared context and its own attribution. |
| **SillyTavern MultiPlayer (STMP)** | Open-source multi-user LLM chat. | Hobbyist; useful proof that serialized multi-user turns work. |

Conclusion: the category is real and multiple large vendors are moving into it, but nobody combines (a) BYO credentials, (b) an architect's artifact canvas, (c) an explicit governance model for conflicting steering, and (d) git-like versioning of the shared design. That combination is the product.

### 3.2 Research that informs the design

- **MUCA: Multi-User Chat Assistant** (arXiv 2401.04883). Frames the group-chat assistant problem as three decisions: *what* to say, *when* to speak, *who* to address. Three modules: sub-topic generator, dialog analyzer, conversational strategies arbitrator. Tandem adopts the 3W framing: users explicitly address the AI in v1, and an "ambient" mode later lets the AI decide when to intervene.
- **GroupGPT** (arXiv 2603.01059). Separates the *intervention decision* from *response generation*, cutting token use up to 3x. Tandem uses the same split: a cheap classifier step (Haiku 4.5) decides whether a message needs a full turn, a conflict flag, or nothing.
- **Collaborative Document Editing with Multiple Users and AI Agents** (CHI 2026, arXiv 2509.11826). Week-long study, 14 teams. Teams folded agents into existing norms of authorship and control rather than treating them as teammates; agent outputs became shared resources, agent configurations stayed personal. Design implication: the AI's output must be attributed *to the human who asked*, and private scratch prompts must exist.
- **Multi-User Shared AI Sessions** (tianpan.co, 2026-04-17). Treat the session as an ordered persistent event stream; serialize LLM turns; broadcast tokens to everyone; attribute every tool call to a user identity; context fills faster with multiple authors so compaction must be attribution-aware; OT/CRDT do not map onto inference semantics. Tandem's ledger and turn broker follow this directly.
- **Multi-party turn-taking and addressee prediction** (several 2024-2026 papers). LLMs do reasonably at addressee recognition when speakers are explicitly labelled. Tandem always labels speakers in the transcript.

### 3.3 Infrastructure that can be reused

| Need | Options | Recommendation |
|---|---|---|
| Live canvas layout, presence, cursors, concurrent text edits | Yjs (+ Hocuspocus self-hosted, or Liveblocks managed), Automerge | **Yjs + Hocuspocus** for control and zero vendor lock; Liveblocks if you want to skip infra. |
| Artifact canvas (cards, edges, pan/zoom) | React Flow (MIT), tldraw (paid license since Sept 2025), Excalidraw (MIT) | **React Flow** for the card canvas; embed **Excalidraw** for freehand sketches. |
| Diagrams | Mermaid, D2, PlantUML | **Mermaid** (renders in browser, AI writes it well, exportable to SVG). |
| Rich text / markdown editing | Tiptap (Yjs-native), CodeMirror 6 | Tiptap for docs, CodeMirror for code/Mermaid source. |
| LLM access | Anthropic TS SDK, `@github/copilot-sdk`, OpenAI SDK | All three behind one adapter interface. |
| Long sessions | Anthropic compaction beta, context editing, prompt caching | Use all three (details in spec). |

---

## 4. The hard problems and how the design resolves them

The brief lists these directly. Short answers here; full mechanisms in the architecture document.

| Question from the brief | Answer |
|---|---|
| Two users direct it to do conflicting things. How does it resolve? | The AI never silently picks a winner. A cheap pre-check compares each directive against the **decision registry** and artifact ownership. Contradictions produce a **Decision Point** card with options and trade-offs; participants vote; the AI applies the agreed option. Session policy chooses between last-writer-wins, review-required, and consensus. |
| How does it version so we can roll back? | Every applied change creates an immutable artifact version; every AI turn creates a **session commit** (a git-like snapshot with parent pointer). Rollback creates a new commit pointing at old versions. Sessions can be **forked** for a v2. |
| Attribution, visible and invisible | Every ledger event carries an actor (`user:alice` or `ai on behalf of alice, triggered by message m42`). Visible: speaker colours, artifact headers, section-level "blame" overlay, diff view. Invisible: provenance metadata on every block, embedded as comments in exports, exportable audit log. |
| Do users have to agree? Is steering queued? | Configurable. Turns are always serialized (one AI turn at a time). Messages sent during a turn queue and are merged into the next turn as a labelled multi-speaker prompt. Whether changes need approval depends on session policy and on whether the change touches something the other person authored or a recorded decision. |
| How do you merge two ideas? | Text and layout: Yjs CRDT merges keystroke-level. Semantic: the AI runs a **reconciliation turn** that produces a merged proposal citing both sources, then it goes through the normal approval path. |
| How do users talk outside the context window? | A **side channel** (human-only chat, never sent to the AI unless a message is explicitly promoted), comments on artifacts, presence and cursors, private scratch prompts on the user's own credentials with a "share to session" action. |

---

## 5. What it would take

### 5.1 Effort (prototype to usable alpha)

| Milestone | Scope | Estimate (1-2 engineers) |
|---|---|---|
| M0 Walking skeleton | Two users, GitHub login, Anthropic BYOK, one session, ledger, serialized turns, tokens streamed to both, Markdown and Mermaid cards on a React Flow canvas | 2-3 weeks |
| M1 Governance | Proposals and approvals, decision registry, conflict flagging, artifact versions, session commits, rollback, blame overlay | 3-4 weeks |
| M2 Knowledge | Uploads (images, PDF, md), source cards, side channel, private scratch, compile-to-design-doc pipeline, exports (MD, DOCX, PDF) | 3 weeks |
| M3 Providers and scale | Copilot SDK adapter, session model pinning, compaction, forks and v2, workspace sponsor key | 3 weeks |
| M4 Build together | Shared repo workspace, agent turns via Copilot SDK or Claude Agent SDK, branch-per-proposal | 4-6 weeks |

Roughly one quarter to a compelling alpha with two providers and the full governance model.

### 5.2 Running cost (the part users pay themselves)

Each AI turn re-sends the shared context. Illustrative session: 60K-token working context, 40 AI turns, Claude Opus 5 ($5 input, $25 output per million, cache reads at 10% of input price).

| Scenario | Input tokens | Cost |
|---|---|---|
| No caching | 2.4M | $12.00 + output |
| With prompt caching, 80% cache hit rate | 0.48M full + 1.92M cached | $2.40 + $0.96 + output |
| Output, 40 turns at 1.5K tokens | 60K | $1.50 |

A two-hour architecture session costs each participant a few dollars on their own key. Because credentials rotate with the speaker, each participant's account warms its own cache; consecutive messages by the same person hit cache, alternating speakers do not. The spec includes a "sponsor" mode where one key pays for all turns and caching is maximal.

### 5.3 Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Vendor policy shifts again (Anthropic tightened terms twice in 2026) | High | Provider adapter layer; ship BYOK API key as the baseline that no policy has restricted; keep Copilot as the subscription path. |
| Data flows to *every* participant's provider account | Medium | Explicit consent at session join; visible "this turn runs on Bob's Anthropic account" badge; sponsor mode for enterprises with data-handling requirements. |
| Model inconsistency when participants use different providers or models | Medium | Session-level model pin; each participant must be able to serve the pinned model or the session degrades with a banner. |
| Copilot SDK is heavy (CLI process per user session) | Medium | Pool and hibernate sessions; run adapter in its own service; consider stateless per-turn sessions. |
| Context window pressure with multiple contributors | Medium | Session brief plus decision registry plus artifact index instead of raw transcript; compaction; attribution-preserving summaries. |
| Governance friction makes the tool feel slow | Medium | Default policy auto-applies additive changes, only gates conflicts; approvals are one click with a 30-second auto-apply timer option. |

---

## 6. Open questions (answered 2026-09-03)

Decisions: Copilot first (organization is licensed); sponsor mode yes; hybrid policy; 2-5 participants; self-hosted Yjs with Hocuspocus; card canvas with embedded sketches. POC runs as one process on SQLite; see `05-poc-plan.md`. The original questions are kept below for the record.

1. **First provider.** Recommended: Anthropic BYOK first (simplest, fully allowed), Copilot second. Agree?
2. **Sponsor mode in v1?** Enterprises will want one key for a session. It is a small addition to the payer selection logic. Recommended: yes, behind a workspace setting.
3. **Default governance policy.** Recommended default: *hybrid* (additive auto-applies, conflicts gated). Alternatives: last-writer-wins for speed, consensus for formal design reviews.
4. **More than two participants?** The design supports N; the UI is tuned for 2-5. Confirm N is not needed to be large.
5. **Self-host vs managed realtime.** Yjs + Hocuspocus (self-host) is recommended. Liveblocks saves a week of infra at the cost of a vendor.
6. **Canvas feel.** Card canvas (React Flow, structured artifacts) versus freeform whiteboard (Excalidraw). Recommended: card canvas primary, Excalidraw embedded per card.

---

## Sources

- Anthropic, Claude Code legal and compliance: https://code.claude.com/docs/en/legal-and-compliance
- WinBuzzer, Anthropic bans Claude subscription OAuth in third-party apps (2026-02-19): https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/
- GitHub Docs, Copilot SDK authentication: https://docs.github.com/en/copilot/how-tos/copilot-sdk/auth/authenticate
- GitHub Docs, Copilot SDK GitHub OAuth setup: https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/github-oauth
- GitHub Changelog, Copilot SDK GA (2026-06-02): https://github.blog/changelog/2026-06-02-copilot-sdk-is-now-generally-available/
- github/copilot-sdk repository: https://github.com/github/copilot-sdk
- copilot-sdk issue 182, user-delegated billing and simple prompt-response: https://github.com/github/copilot-sdk/issues/182
- GitHub Docs, supported models in Copilot: https://docs.github.com/en/copilot/reference/ai-models/supported-models
- OpenAI Codex authentication: https://learn.chatgpt.com/docs/auth
- Anthropic, Introducing Claude Design: https://www.anthropic.com/news/claude-design-anthropic-labs
- Claude Help, project visibility and sharing: https://support.claude.com/en/articles/9519189-manage-project-visibility-and-sharing
- Mixus multiplayer chat docs: https://docs.mixus.ai/multiplayer/overview
- Futurum, Microsoft Copilot Cowork: https://futurumgroup.com/insights/will-ms-copilot-cowork-enable-real-enterprise-ai-collaboration/
- GitHub Changelog, shared agentic work in Teams (2026-08-21): https://github.blog/changelog/2026-08-21-shared-agentic-work-with-github-copilot-in-microsoft-teams/
- Liveblocks AI Copilots: https://liveblocks.io/ai-copilots
- Tian Pan, Multi-User Shared AI Sessions (2026-04-17): https://tianpan.co/blog/2026-04-17-multi-user-shared-ai-sessions
- MUCA (arXiv 2401.04883): https://arxiv.org/abs/2401.04883
- GroupGPT (arXiv 2603.01059): https://arxiv.org/abs/2603.01059
- Collaborative Document Editing with Multiple Users and AI Agents, CHI 2026 (arXiv 2509.11826): https://arxiv.org/abs/2509.11826
- Charlie Guo, AI's Missing Multiplayer Mode: https://www.ignorance.ai/p/ais-missing-multiplayer-mode
- SitePoint, Anthropic API terms and the BYOK pattern: https://www.sitepoint.com/end-wrapper-era-anthropic-api-terms-saas/
- Meetrix, open-source whiteboard tools (tldraw licensing change): https://meetrix.io/blogs/open-source-whiteboard-tools/
- Eraser DiagramGPT: https://www.eraser.io/diagramgpt
