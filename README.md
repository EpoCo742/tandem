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

Requirements: **Node 22.12 or newer** (24 is what this is developed on) and **pnpm 10**. Only pnpm works: the packages link to each other with `workspace:*`, which npm and yarn cannot resolve, and only pnpm reads `pnpm-lock.yaml`, which pins the Copilot SDK to a version whose runtime is bundled. An install with anything else is refused by a preinstall check.

```
npm install -g pnpm@10.34.5         # once; goes to your user profile, no admin rights needed
pnpm install --frozen-lockfile      # exactly what the lockfile says, nothing newer
node tools/make-env.mjs             # writes .env and server/.env with fresh secrets (dev auth on, offline provider)
pnpm dev                            # server on :3000, Vite on :5173 (proxies /api, /ws, /collab, /auth)
```

For a single-process run instead of `pnpm dev`: `pnpm build` then `pnpm --filter @tandem/server start`, and open http://localhost:3000.

### If a card says "This version of the card cannot be shown"

A version was stored whose content does not fit the card type (older builds let the model do this). The rest of the session keeps working. To restore the card as a forward version, stop the server and run, from `server/`:

```
npx tsx scripts/repair-card.ts <sessionId> <artifactId> [--resolve <optionId> --decision <decisionId>]
```

The ids are in the card's tooltip and the History tab. `--resolve` closes a decision point with the given option when the decision was already recorded.

## If the install or build fails

The one failure that has actually bitten: **the server cannot find or start `@github/copilot-sdk`**, often after a coding agent has "helpfully" edited `server/src/providers/copilot.ts` to resolve the SDK by hand. The cause is a version drift, not the code. On 2026-09-04 the SDK moved its runtime out of the package into per-platform optional packages; the lockfile pins the earlier version that bundles the runtime, and anything that installs without honouring the lockfile picks up the new one and then has no runtime.

Do these steps in order, in the repo root, and do not skip the first two:

1. Throw away the agent's edits to the adapter, if any:
   ```
   git checkout -- server/src/providers/copilot.ts
   git status                      # should show no changes under server/src
   ```
2. Remove every `node_modules` so nothing installed by npm, yarn or an older pnpm survives:
   ```
   Remove-Item -Recurse -Force node_modules, server/node_modules, web/node_modules, shared/node_modules -ErrorAction SilentlyContinue   # PowerShell
   rm -rf node_modules server/node_modules web/node_modules shared/node_modules                                                      # bash
   ```
3. Make sure it is pnpm 10 that runs the install. `corepack enable` needs an administrator shell on Windows (it writes into Program Files); use npm's global install instead, which needs no elevation:
   ```
   npm install -g pnpm@10.34.5
   pnpm --version                  # 10.x
   ```
   If global installs are blocked, `npx pnpm@10.34.5 install --frozen-lockfile` works without installing anything.
4. Install exactly what the lockfile says:
   ```
   pnpm install --frozen-lockfile
   ```
   If this errors with "lockfile is out of date", someone has changed a `package.json` without pnpm; run `git status`, restore those files, and try again. Do not run `pnpm add @github/copilot-sdk` or `npm install @github/copilot-sdk` to "fix" it: both upgrade to the latest SDK and cause exactly this problem.
5. Confirm the SDK that is installed is the pinned one and that it starts:
   ```
   node -e "console.log(require('./server/node_modules/@github/copilot-sdk/package.json').version)"   # 1.0.11
   pnpm typecheck
   ```
6. Build and run: `pnpm build`, then `pnpm --filter @tandem/server start`.

**"Could not resolve a @github/copilot platform package (tried @github/copilot-win32-x64)"** on sign-in or when connecting a credential is the same family of problem from the other side: the SDK finds the Copilot runtime by resolving a `sdk` subpath inside the platform package, and runtime versions from 1.0.81 stopped exporting it. The repo pins the runtime to 1.0.80 through a pnpm override in the root `package.json`, so a lockfile-honouring install gets a matching pair. If you see this message, someone installed without the lockfile, or the override was removed: run `pnpm install --frozen-lockfile` from a clean `node_modules` and check that `node_modules/.pnpm` contains `@github+copilot@1.0.80`. When moving to a newer SDK, drop or update the override together with the SDK pin and verify the runtime starts before committing.

Node too old is the other thing that produces confusing SDK errors: `node --version` must be 22.12 or newer (or 20.19+). The preinstall check tells you if not.

Moving to a newer SDK is a deliberate change: bump the exact version in `server/package.json`, run `pnpm install` (not frozen) to update the lockfile, check that the platform runtime package `@github/copilot-sdk-<os>-<arch>` installed under `server/node_modules/@github/`, and commit the lockfile with it. If the runtime has to live elsewhere, `COPILOT_CLI_PATH` points the SDK at it; set it in the environment rather than editing the adapter.

Open http://localhost:5173. With `TANDEM_DEV_AUTH=1` you can log in with any handle; open a private window and log in with a second handle to be the other participant.

**Without a Copilot seat:** set `TANDEM_PROVIDER=fake`, connect the `fake` provider under credentials, and create a session. The offline provider is a scripted architect that draws diagrams, records decisions, and raises decision points on contradictions. It exists so the collaboration loop can be demoed without spending premium requests.

**With Copilot:** under credentials pick `copilot` and paste a GitHub token (`gho_`, `ghu_`, or fine-grained `github_pat_`) from an account with an active Copilot seat. For a fine-grained token: resource owner is your personal account (not an organization), account permission **Copilot Requests: Read**, no repository access; classic `ghp_` tokens are not accepted by Copilot. Validation starts the bundled Copilot runtime and lists the models your plan allows. Or configure a GitHub OAuth App (`GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`, callback `{APP_URL}/auth/github/callback`) and sign in with GitHub; the OAuth token is stored as a Copilot credential automatically.

Sponsor mode (default) funds every turn with the session creator's credential, so only the creator needs a seat.

**External tools:** under credentials → External tools, paste the server entry from your editor's `mcp.json` (VS Code, Claude Desktop and Cursor shapes all work; `gallery` and `version` are ignored, `${input:…}` placeholders must be replaced with real values) or fill in the fields by hand (stdio command or HTTP URL, with your own tokens in the environment or headers). The AI can use them on turns you direct; reads run at once, writes are proposed to you in the session's Proposals tab and denied if nobody answers. `node server/scripts/mcp-demo-server.mjs` is a stand-in for Atlassian for demos. Stdio servers run as child processes of the Tandem server, so only register commands you trust on the machine it runs on.

**Long sessions:** once more than `TANDEM_COMPACT_AFTER` messages (default 8) have fallen out of the model's transcript window, the server folds them into a running brief that keeps who said what and the message ids, and the AI reads the brief instead. That summary is one extra provider request on the sponsor's plan each time it runs. The Brief tab shows it and can refresh it by hand.

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
