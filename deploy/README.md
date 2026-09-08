# Deploying archloom to Cloud Foundry

Two scripts and one file you fill in.

| | |
|---|---|
| `deploy/.env.pcf` | Where your client IDs and secrets go. Copy `deploy/.env.pcf.example`, fill it in. Gitignored, and `.cfignore` keeps it out of the upload. |
| `deploy/push.ps1` | Build here, back up what is running, `cf push`, put the data back. |
| `deploy/backup.ps1` | A dated backup on its own, for a schedule or before you touch anything. |
| `manifest.yml` | Everything that is not a secret: one instance, memory, buildpack, health check, `DATA_DIR`. |

## Before the first push

**1. Fill in `deploy/.env.pcf`.** Copy the example and set at least these six:

```
APP_URL=https://archloom.apps.example.com
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
SESSION_SECRET=<32+ random bytes>
TANDEM_MASTER_KEY=<64 hex characters>
TANDEM_ADMIN_TOKEN=<long random string>
```

Generate the two random ones with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

Every key in that file is set on the app with `cf set-env`, so anything else the app takes — `GITHUB_OAUTH_SCOPES`, `HTTPS_PROXY`, `NODE_EXTRA_CA_CERTS`, `TANDEM_MAX_CONCURRENT_TURNS` — goes in the same place without touching the script.

**2. Register the GitHub OAuth App** (github.com → Settings → Developer settings → OAuth Apps, or your enterprise instance). Homepage `{APP_URL}`, authorization callback `{APP_URL}/auth/github/callback`. The callback is built from `APP_URL` at runtime, so the two have to agree exactly — a trailing slash or `http` where the route is `https` is the usual cause of a login that returns to a blank page. `docs/brand/archloom-oauth-*.png` is the logo for that page.

**3. Decide the route** and make `APP_URL` match it. Uncomment the `routes:` block in `manifest.yml`, or let `cf push` create the default route from the app name and read it back with `cf app archloom`.

**4. Check two things about the foundation** before you spend an afternoon on it:

- **Egress.** Staging reaches `registry.npmjs.org` (and, for `better-sqlite3`'s prebuilt binary, GitHub release assets). The running app reaches GitHub and the Copilot API. The README's outbound section has the detail.
- **The buildpack.** This is a pnpm workspace. `nodejs_buildpack` needs to be recent enough to install with pnpm; an older one runs `npm install`, which the repo's `preinstall` check refuses with an explanation rather than a puzzling failure. If that happens, the Dockerfile at the repo root builds the same app in one container and `cf push archloom --docker-image <your registry>/archloom` deploys it, if the foundation allows Docker.

## Pushing

```powershell
.\deploy\push.ps1 -Fresh      # first deploy: nothing to back up yet
.\deploy\push.ps1             # after that: backup, push, restore
```

What it does, in order: `pnpm install --frozen-lockfile && pnpm build` here (the SPA is built locally and pushed, so staging only installs); exports every session from the running app; `cf push --no-start`; sets the environment; `cf start`; polls `/api/health`; imports the sessions back.

Useful flags: `-SkipBuild` when you just built, `-Yes` to skip the confirmation, `-Fresh` when a volume service makes the backup pointless, `-NoRestore` to keep the bundle and import it yourself, `-App` for a different app name.

## Why the backup is part of the push

Everything the app keeps is under `DATA_DIR`: `tandem.db` and `files/`. On Cloud Foundry every push, restage and restart begins with a fresh filesystem, so without one of these two arrangements a deploy loses every session:

- **A volume service mounted at `DATA_DIR`.** Uncomment `services:` in the manifest and bind an NFS volume. One instance only, and read the note in the root README first: SQLite over NFS wants `journal_mode=DELETE`, which is not what the app sets.
- **Backup and restore around the push**, which is what `push.ps1` does by default and needs nothing from the platform.

The bundle carries each session whole — ledger, people, uploads with their bytes, layout, published pages — and the accounts that took part. It does not carry people's Copilot credentials or their registered tool servers; they connect those again after the deploy. `archloom.db` in the same backup folder does carry them, sealed with `TANDEM_MASTER_KEY`, but there is no route that puts a database file back: it is there to read with a SQLite client or to restore by hand onto a volume. Keep `TANDEM_MASTER_KEY` the same for the life of the install or nothing sealed with the old one opens again.

## Backups on their own

```powershell
.\deploy\backup.ps1                       # reads APP_URL and the admin token from deploy/.env.pcf
.\deploy\backup.ps1 -Keep 30              # keep the newest 30 folders
.\deploy\backup.ps1 -BundleOnly           # skip the database copy
.\deploy\backup.ps1 -Url https://... -Token $env:TANDEM_ADMIN_TOKEN
```

Each run writes `deploy/backups/<timestamp>Z/` with `bundle.json` and `archloom.db`, prunes older folders, and fails before creating anything if the app is not answering — an unreachable app never looks like an empty backup. For a nightly copy, point Task Scheduler at the same command; the underlying `server/scripts/backup.mjs` works on any machine that can reach the app and holds the admin token.

To put a bundle back at any time:

```powershell
node server\scripts\backup.mjs import --url https://archloom.apps.example.com --token $env:TANDEM_ADMIN_TOKEN --in deploy\backups\<stamp>Z\bundle.json --mode replace
```

`--mode copy` brings the sessions in as new ones instead of replacing the sessions with the same ids.

## One instance, always

SQLite, the event bus and the Yjs document server all live in the app process. A second instance is a second writer with its own copy of the state, so `instances: 1` in the manifest is not a starting point to scale from, and `cf push --strategy rolling` — which runs the old and new instances at once — must not be used. `cf scale -i 2` would corrupt sessions rather than share them.
