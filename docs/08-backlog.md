# Tandem backlog

What is not built yet, in the order it is worth doing. Status of what is built lives in `05-poc-plan.md` section 7. Last updated 2026-09-05.

## 1. Per-user MCP servers (new, 2026-09-05)

**Ask.** Each participant registers their own MCP servers with their own credentials and configuration, for example Atlassian and GitHub. In the chat a person can say "upload the design document to Confluence", "create epics and stories for the data model", or "commit the diagrams to the repo", and the AI discovers and uses that person's tools to do it.

**Why it fits.** The product already treats the AI credential as personal and bills each turn to a person. MCP servers are the same shape: personal, credentialed, and the source of what that person is allowed to do in outside systems. The Copilot SDK takes an `mcpServers` map per session (stdio servers with command, args and env; HTTP or SSE servers with a URL and headers), with a `tools` allow-list per server, so no new runtime is needed.

**Design sketch.**

- *Registration.* A "Tools" section on the credentials page: name, transport (stdio or HTTP), command or URL, environment or headers. Secrets are sealed with the same AES-256-GCM master key as AI credentials and never returned to the browser. A "test" button starts the server through the SDK and lists its tools, the way credential validation lists models; the tool list is stored for display and discovery.
- *Whose tools run.* The tools available on a turn are the speaker's, meaning the person the turn is on behalf of, not the sponsor's. In a batched turn with two speakers, each person's servers are attached under a name prefixed with their handle, and the prompt tells the model which tools belong to whom. A tool call can only ever use the credentials of the person who owns it.
- *Discovery.* On each turn the broker passes the speaker's registered servers to `createSession` alongside the canvas tools, and lists them in the prompt under "External tools available to Alice". The model already knows how to pick a tool from a description.
- *Governance.* Every external write is a new risk class, `outbound`. Under the hybrid policy it is a proposal that names the target ("create 4 Jira stories in project ORD", "publish page 'Order platform v1' to space ARCH") and needs the owner's approval; the person who registered the tool can pre-approve targets. Reads are additive. Nothing leaves the session without a ledger event that names who directed it and which tool ran, and the export's history shows the same.
- *Ledger events.* `tool.registered`, `tool.removed`, `external.call_proposed`, `external.call_completed` with the target and a link back to the message that caused it.
- *Sandboxing.* Stdio servers run as child processes of the Tandem server; production would run them in a per-user sandbox and the design already reserves that for M4.

**Acceptance.** Alice registers the Atlassian MCP with her token; Bob has none. Alice says "publish the design document to Confluence under ARCH". The AI proposes the publish with the page title and space, Alice approves, the page appears, the history shows Alice directed it. Bob asking the same is told he has no Confluence tool registered.

**Effort.** About a week for one engineer: registration and sealing reuse the credential code; the broker change is contained; the proposal card needs one new shape.

## 2. Collapsed source cards

Uploads stay first-class artifacts for provenance, but render collapsed by default: header, filename, open link, expand on demand. The Sources tab is the primary way to find them. Small.

## 3. Editing indicator

A "Bob is editing" chip on a card while someone has its editor open, carried through awareness like presence. Soft indicator, not a lock: the version check on save remains the guard. Small.

## 4. Real-image and long-document validation on Copilot

Attached files now go to the runtime as file attachments. Confirm on a real seat that a PNG is looked at and that an 80k-character spec is read whole. Half a day, needs a seat.

## 5. Live text co-editing on cards

Planned for P1 and deferred. Still doubtful: live editing bypasses the proposal flow that makes cross-owner edits reviewable. If done, it should be limited to a card the editor owns, with the Yjs text folded into a version on blur.

## 6. GitHub App instead of OAuth App

OAuth App tokens do not expire, which is why the POC uses one. A GitHub App would give finer permissions and short-lived tokens, and needs refresh-token handling in the server. Production item.

## 7. M4: change sets and building together

From the technical spec: a `change_set` artifact, a sandbox workspace per session, agent turns through the Copilot SDK on the payer's token, branch-per-proposal with test results in the proposal card. The MCP item above is the first step toward it, since committing diagrams to a repo is an external write like any other.
