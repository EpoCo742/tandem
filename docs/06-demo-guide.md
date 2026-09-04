# Tandem POC: Demo Guide

A walkthrough of the proof of concept as it runs today, with screenshots from a real run on 2026-09-03. Two people, Alice and Bob, design an order platform with one AI participant on a shared, versioned canvas. The run uses the offline "fake" provider so it costs nothing and needs no Copilot seat; with a Copilot credential the same steps run against a real model.

---

## 1. Start the app

Requirements: Node 22+ and pnpm 10. From the repository root:

```
pnpm install
cp .env.example .env            # set SESSION_SECRET and TANDEM_MASTER_KEY; TANDEM_DEV_AUTH=1; TANDEM_PROVIDER=fake
cp .env server/.env
pnpm --filter @tandem/web build
pnpm --filter @tandem/server start
```

Open http://localhost:3000. For a second participant, open a private window (or a second browser) and log in with a different handle. The helper `node server/scripts/bob.mjs` can also play the second participant from the command line, which is how Bob's actions were driven for these screenshots.

---

## 2. Sign in

With `TANDEM_DEV_AUTH=1` the login page offers a dev login: type any handle. When a GitHub OAuth App is configured, a "Sign in with GitHub" button appears instead and the OAuth token becomes a Copilot credential automatically.

![Login page with dev login](guide/01-login.jpg)

---

## 3. Connect an AI credential

Open **credentials** in the top bar. Choose a provider and connect it. Tokens are encrypted at rest with AES-256-GCM and never sent back to the browser. For Copilot, validation starts the bundled Copilot runtime with your token and lists the models your plan allows; for the offline provider no token is needed.

![Credentials page showing the connected offline provider](guide/02-credentials.jpg)

What to notice: the card lists the models the credential can serve. The session's model pin is checked against this list on every turn.

---

## 4. Create a session

Back on the home page, give the session a title and choose who pays. **Sponsor** (the default) funds every turn with the creator's credential, so only the creator needs a seat. **Speaker** uses each person's own credential for the turns they trigger. The policy is hybrid: additive changes apply at once, edits to someone else's work wait for approval, contradictions raise a decision point.

![New session form](guide/03-new-session.jpg)

---

## 5. The session screen and consent

Three panes: the AI lane on the left, the canvas in the middle, and the human-only side pane on the right with tabs for the side channel, proposals, decisions and history. The top bar shows provider, model pin, payer mode, policy, a live indicator, and the avatars of everyone present.

Before anyone can address the AI they accept a one-line consent: everything in the session is sent to the provider account that funds each turn.

![Empty session with the consent banner](guide/04-consent.jpg)

Click **Invite** to copy an invite link. After Bob joins, the header reads "2 participants" and his avatar appears.

![Session after consent with two participants](guide/05-two-participants.jpg)

---

## 6. Two people, one turn

Alice types "Service A publishes an OrderPlaced event to Kafka." and Bob, a second later, "Service B subscribes to OrderPlaced and writes to the orders table in Postgres." Messages sent within about 1.5 seconds of each other are batched into one speaker-labelled prompt, so the AI answers both people in a single turn.

![First AI turn with the architecture diagram](guide/06-first-turn.jpg)

What to notice:

- Messages carry the author's colour (amber for Alice, teal for Bob).
- The AI reply is badged **ran on alice's fake (sponsor)**: whose credential funded the turn, and which model answered.
- The reply says "Recorded D-01 for alice. Recorded D-02 for Bob": one decision per speaker, attributed to the person who stated it.
- The diagram card's footer reads **AI for alice · from 2 msgs**. Clicking "from 2 msgs" highlights the messages the card was derived from.

---

## 7. Editing someone else's work becomes a proposal

Bob edits the diagram directly (the **edit** button on the card opens a versioned editor). Because Alice's turn created the card, under the hybrid policy Bob's change does not apply at once. It appears in Alice's **Proposals** tab with a badge, the risk label *cross owner edit*, a diff, and a countdown: if nobody responds within 60 seconds it auto-applies so whiteboarding never stalls.

![Proposal awaiting Alice's approval](guide/07-proposal.jpg)

Alice clicks **Approve**. The card becomes v2, now attributed to Bob in teal, and the version dropdown lets anyone view or compare earlier versions.

![Diagram at v2 after approval](guide/08-approved-v2.jpg)

---

## 8. A contradiction raises a decision point

Alice changes her mind: "Drop Kafka. Service A should write the OrderPlaced event straight to Postgres instead." This contradicts D-01, which both participants agreed to earlier. The AI does not pick a winner. It leaves the diagram untouched, marks it **blocked**, and raises a decision point card with options and trade-offs. Bob has already voted for "Combine both".

![Decision point card with the diagram blocked](guide/09-decision-point.png)

What to notice: the diagram's **edit** button is disabled while it is blocked, and any attempt to change it through the API is refused until the decision point resolves.

Alice votes too. A majority of editors resolves the point. The AI then runs a resolution turn on its own: it records D-03 as agreed by both voters, marks D-01 superseded, and updates the diagram to v3.

![Resolved decision point and diagram v3](guide/10-resolved.png)

The **Decisions** tab is the registry the AI checks on every turn. D-01 is struck through, D-02 stands, and D-03 shows both voters and "supersedes D-01". Clicking a decision highlights the messages that are its evidence.

![Decisions tab after resolution](guide/11-decisions.png)

---

## 9. Talking without the AI listening

The **Side channel** tab is human-only. Bob asks whether they should request a data model. Nothing here reaches the AI unless someone clicks **promote to AI**.

![Side channel with Bob's note](guide/12-side-channel.png)

Alice promotes the note. It enters the AI lane labelled "Bob · promoted from side channel", keeping Bob as the author, and the AI answers it as a normal turn (here it captured the question as a notes card and recorded D-04 for Bob).

![Promoted note answered by the AI](guide/13-promoted.png)

---

## 10. History and rollback

Every AI turn and every applied edit writes a commit. The **History** tab lists them with the acting person and the number of artifacts pinned.

![History tab listing commits](guide/14-history.png)

Clicking **revert to** on the first commit restores the diagram to its original content as a new version (v4) and a new commit. Nothing is deleted: the decision point and notes cards are soft-deleted and every version stays in the ledger.

![Canvas after reverting to the first commit](guide/15-reverted.png)

---

## 11. Uploads and the compiled design document

**Upload** in the composer accepts screenshots, Markdown, text and `.mmd` Mermaid files. A `.mmd` file becomes a diagram card directly; everything else becomes a **source** card showing the extracted text (or the image) with an "open" link. Source material reaches the AI wrapped as untrusted data, so instructions hidden inside a document (the "ignore previous instructions" line in this example) are treated as content, never as commands.

**Compile design doc** in the top bar asks the AI to assemble everything on the canvas into a **design document** card: overview, architecture with every diagram embedded, data model, sources, the decision log with supersessions, and open questions. The request appears in the AI lane as a compact note. Re-running it updates the same card as a new version.

![Source card, uploaded diagram, and the compiled design document](guide/16-uploads-and-design-doc.jpg)

---

## 12. Data model and forking a v2

Ask the AI to "draft the data model" and a **data model** card appears with the entities it can infer from the tables and events named so far (rendered as tables with primary and foreign keys, plus a relations line). Like every card it is versioned, attributed, and governed: someone else's edit to it becomes a proposal, and a proposal nobody answers auto-applies after the timeout.

**Fork as v2** in the top bar starts a new session from the current canvas: every live card is carried over as v1, agreed decisions are copied, superseded ones and resolved decision points are left behind, participants are carried over but must consent again, and the new session shows a "forked from" link back to the original, which stays intact.

![Forked v2 session with the data model card](guide/17-fork-and-data-model.jpg)

---

## 13. Export

**Export .md** in the top bar produces a Markdown document with the artifacts, the decision log, and the commit history. Provenance travels along as HTML comments, so attribution survives leaving the app. An excerpt from this run:

````markdown
# Order platform v1

<!-- tandem session 01M1NAKN...; head commit 01M1NAWF... -->

## Artifacts

### System architecture

<!-- artifact 01M1NAN0... v4; author user:alice; provenance [{"sectionId":"msg-7GF5BQ","derivedFrom":["01M1NAMY..."]}, ...] -->
*mermaid · v4 · alice*

```mermaid
flowchart LR
  Service_A["Service A"] -->|publishes| Kafka["Kafka"]
  Service_B["Service B"] -->|subscribes| Postgres["Postgres"]
```

## Decision log

- **D-01** [superseded] Service A publishes an OrderPlaced event to Kafka — alice (superseded by D-03)
- **D-02** [agreed] Service B subscribes to OrderPlaced and writes to the orders table in Postgres — Bob
- **D-03** [agreed] Resolved: Combine both — Bob, alice
````

`?format=json` on the same URL returns the raw ledger for audit.

---

## 14. What happened underneath

The session is an append-only ledger. This run produced about 45 events; the important kinds are:

| Event | Written when |
|---|---|
| `message.posted` | a person posts to the AI lane or side channel |
| `turn.started` / `turn.completed` | the broker runs one serialized AI turn for a batch of messages |
| `artifact.applied` | a version of a card is created, by the AI or a person |
| `proposal.created` / `proposal.approved` | a change needs and receives approval |
| `decision.recorded` | the AI records a settled statement in the registry |
| `conflict.flagged` and a `decision_point` artifact | a directive contradicts an agreed decision |
| `decision.voted` / `decision.resolved` | participants vote; a majority resolves |
| `commit.created` / `commit.reverted_to` | a snapshot of all current versions; rollback |

Every event carries who caused it, and every artifact section carries the message ids it was derived from. The browser and the server run the same reducer over the same events, which is why a reconnecting participant sees exactly the same state.

---

## 15. Running with a real Copilot seat

1. On the credentials page choose **copilot** and paste a GitHub token (`gho_`, `ghu_`, or a fine-grained `github_pat_`) from an account with an active Copilot seat, or configure a GitHub OAuth App and sign in with GitHub.
2. Validation lists the models your plan allows. Create the session with `copilot` as the provider; the model pin defaults to `claude-opus-5` when available, otherwise the first model in the list.
3. Each AI turn creates one throwaway Copilot session funded by the payer's token and counts as one premium request times the model multiplier. In sponsor mode only the creator's seat is used.

The system prompt asks the model to record decisions, check directives against the registry, and raise decision points through the same tools the offline provider used, so the governance flow above is what to expect.

---

## 16. Troubleshooting

- **"Connect a fake credential first"** when creating a session: sponsor mode needs a credential on the creator. Connect one on the credentials page.
- **Consent banner stays**: each participant accepts consent once per session before addressing the AI.
- **Turn failed: no participant has a credential**: in speaker mode, the person who triggered the turn (or anyone in the session) needs a credential for the session's provider.
- **Nothing moves after Send**: check the top-bar indicator says *live*. The client reconnects and replays automatically.
- **Reset everything**: stop the server and delete `server/data` (or the directory `DATA_DIR` points at).
