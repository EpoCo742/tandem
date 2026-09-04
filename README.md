# Tandem

Working name for a shared AI session product: two to five software architects share one AI conversation and one versioned artifact canvas, each funding their turns with their own AI credentials, and compile the result into a design document.

This repository holds the research, the design package, and the proof-of-concept.

## Layout

| Path | Contents |
|---|---|
| `research-prompt.txt` | The original brief |
| `docs/` | Design package: research findings, architecture, technical spec, executive deck, POC plan. See `docs/README.md` |
| `shared/` | Ledger event types, canvas tool schemas, and the pure reducer shared by server and browser |
| `server/` | Fastify server: auth, encrypted credentials, session ledger, turn broker, governance, provider adapters (Copilot, offline fake), embedded Hocuspocus, SQLite |
| `web/` | Vite + React SPA: conversation lane, React Flow canvas, side channel, proposals, decisions, history |
| `tools/build-docs.py` | Regenerates `docs/html/` from the Markdown |

## Run the POC locally

Requirements: Node 22+, pnpm 10.

```
pnpm install
cp .env.example .env        # then edit: SESSION_SECRET, TANDEM_MASTER_KEY, optionally GitHub OAuth
cp .env server/.env         # the server reads .env from its own directory in dev
pnpm dev                    # server on :3000, Vite on :5173 (proxies /api, /ws, /collab, /auth)
```

Open http://localhost:5173. With `TANDEM_DEV_AUTH=1` you can log in with any handle; open a private window and log in with a second handle to be the other participant.

**Without a Copilot seat:** set `TANDEM_PROVIDER=fake`, connect the `fake` provider under credentials, and create a session. The offline provider is a scripted architect that draws diagrams, records decisions, and raises decision points on contradictions. It exists so the collaboration loop can be demoed without spending premium requests.

**With Copilot:** under credentials pick `copilot` and paste a GitHub token (`gho_`, `ghu_`, or fine-grained `github_pat_`) from an account with an active Copilot seat. Validation starts the bundled Copilot runtime and lists the models your plan allows. Or configure a GitHub OAuth App (`GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`, callback `{APP_URL}/auth/github/callback`) and sign in with GitHub; the OAuth token is stored as a Copilot credential automatically.

Sponsor mode (default) funds every turn with the session creator's credential, so only the creator needs a seat.

## One container

```
cp .env.example .env   # fill in secrets
docker compose up --build
```

Serves the built SPA and API on http://localhost:3000 with SQLite and uploads under `./data`.

## Tests

```
pnpm typecheck
TANDEM_DEV_AUTH=1 TANDEM_PROVIDER=fake DATA_DIR=./data-smoke PORT=3011 APP_URL=http://localhost:3011 pnpm --filter @tandem/server start &
node server/scripts/smoke.mjs http://localhost:3011
```

`node server/scripts/demo.mjs --until <stage>` seeds a demo session through the API up to a named stage (see `docs/07-demo-script.md`) so a live demo can start from there.

The smoke script drives two users through the full demo: batched directives, streaming to both, a cross-owner edit that becomes a proposal, approval, a contradiction that raises a decision point, votes, the resolution turn, revert, side channel with promotion, Markdown export, and replay.

## Status

2026-09-03: POC steps P0-P3 implemented (sessions, batched turns, governance, versions, uploads and source cards, AI-drafted data model, compile to design document, fork to v2, export) and passing the smoke test and manual browser runs. See `docs/06-demo-guide.md` for a screenshot walkthrough. Remaining: real-Copilot validation on an account with a seat, GitHub OAuth App configuration.
