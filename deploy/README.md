# Deploying archloom to Cloud Foundry

Steps 1 to 5 are once. After that a deploy is one command.

## First deploy

**1. Log in to the foundation.**

```powershell
cf login -a <your api endpoint>
cf target                        # confirm the org and space
```

**2. Generate three secrets.** Run this three times and keep the outputs:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

They become `SESSION_SECRET`, `TANDEM_MASTER_KEY` and `TANDEM_ADMIN_TOKEN`.

**3. Work out the URL.** `cf domains` lists them; the app will be at `https://archloom.<that domain>`.

**4. Create the GitHub OAuth App.** github.com → Settings → Developer settings → OAuth Apps → New OAuth App. Homepage `https://archloom.<domain>`, authorization callback `https://archloom.<domain>/auth/github/callback`. Copy the client ID and generate a client secret. (`docs/brand/archloom-oauth-*.png` is the logo for that page.)

**5. Fill in one file.**

```powershell
copy deploy\.env.pcf.example deploy\.env.pcf
notepad deploy\.env.pcf
```

The URL from step 3, the two GitHub values from step 4, the three secrets from step 2. Nothing else is required. The file is gitignored and never uploaded.

**6. Push.**

```powershell
.\deploy\push.ps1 -Fresh
```

It shows the target and every variable it will set, asks once, then builds, pushes and waits until the app answers.

**7. Open the URL and sign in with GitHub,** then connect your Copilot seat in the app.

## After that

```powershell
.\deploy\push.ps1        # every later deploy: backs up, pushes, puts the data back
.\deploy\backup.ps1      # a backup on its own, any time
```

Useful flags on `push.ps1`: `-SkipBuild` when you just built, `-Yes` to skip the confirmation, `-App` for a different app name, `-NoRestore` to keep the bundle and import it yourself. On `backup.ps1`: `-Keep 30`, `-BundleOnly`, and `-Url`/`-Token` to point at an install without using the env file.

---

# When something goes wrong

## The push fails at staging

Two likely causes.

**The buildpack installed with npm.** This is a pnpm workspace; an older `nodejs_buildpack` runs `npm install`, which the repo's preinstall check refuses with an explanation in the log. Ask for a newer buildpack, or build the container yourself — the `Dockerfile` at the repo root is the same app in one image, and `cf push archloom --docker-image <registry>/archloom` deploys it where the foundation allows Docker.

**Staging could not reach the internet.** It needs `registry.npmjs.org` and, for `better-sqlite3`'s prebuilt binary, GitHub release assets. The running app needs GitHub and the Copilot API. The root README's outbound section has the full list.

## Sign-in returns to a blank page

`APP_URL` and the OAuth App's callback have to agree exactly — same scheme, same host, no trailing slash — because the callback is built from `APP_URL` at runtime. Check the app's real route with `cf app archloom`.

## The data

Everything the app keeps is under `DATA_DIR`: `tandem.db` and `files/`. On Cloud Foundry every push, restage and restart begins with a fresh filesystem, so `push.ps1` exports the sessions before the push and imports them after — that is why a deploy takes a minute and why it refuses to push over a live install whose backup failed.

The bundle carries each session whole: ledger, people, uploads with their bytes, layout, published pages, and the accounts that took part. It does not carry people's Copilot credentials or their registered tool servers, so everyone connects those again after a deploy. The `archloom.db` beside it in each backup folder does carry them, sealed with `TANDEM_MASTER_KEY`, but no route puts a database file back: it is there to read with a SQLite client or to restore by hand onto a volume. **Keep `TANDEM_MASTER_KEY` the same for the life of the install** or nothing sealed with the old one opens again.

If the foundation offers an NFS volume service, mounting it at `DATA_DIR` keeps the data across pushes and makes the export and import unnecessary (`push.ps1 -Fresh`). Uncomment `services:` in `manifest.yml` first, and know that SQLite over NFS wants `journal_mode=DELETE`, which is not what the app sets.

To put any bundle back by hand:

```powershell
node server\scripts\backup.mjs import --url https://archloom.<domain> --token $env:TANDEM_ADMIN_TOKEN --in deploy\backups\<stamp>Z\bundle.json --mode replace
```

`--mode copy` brings the sessions in as new ones instead of replacing the ones with the same ids.

## One instance, always

SQLite, the event bus and the Yjs document server all live in the app process. A second instance is a second writer with its own copy of the state, so `instances: 1` in the manifest is not a starting point to scale from: no `cf scale -i 2`, and never `cf push --strategy rolling`, which runs the old and new instances at once.

## Where the settings live

`deploy/.env.pcf` — every key in it is set on the app with `cf set-env`, so anything else the app takes goes in the same file: `GITHUB_OAUTH_SCOPES`, `TANDEM_MAX_CONCURRENT_TURNS`, `HTTPS_PROXY`, `NODE_EXTRA_CA_CERTS`. Both scripts print the values masked. `manifest.yml` holds everything that is not a secret.
