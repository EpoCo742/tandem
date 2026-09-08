#Requires -Version 5.1
<#
.SYNOPSIS
  Build archloom, back up what is running, push it to Cloud Foundry, put the data back.

.DESCRIPTION
  A push replaces the container's filesystem, and everything the app keeps - the SQLite
  database and the uploaded files - lives on it. So an ordinary deploy is four steps, and
  this script is those four steps in order:

    1. build the SPA here, so staging only has to install dependencies
    2. export the running install through its admin route
    3. cf push, with the secrets from deploy/.env.pcf set before the app starts
    4. import the export back into the new container

  The first deploy has nothing to back up: use -Fresh. If the foundation gives you a volume
  service mounted at DATA_DIR, steps 2 and 4 are unnecessary; use -Fresh then too.

  Secrets are never in the repository or on the command line: every key in deploy/.env.pcf
  becomes an environment variable on the app, and this script prints them masked.

.EXAMPLE
  .\deploy\push.ps1 -Fresh        # first deploy
  .\deploy\push.ps1               # every deploy after that
  .\deploy\push.ps1 -SkipBuild -Yes
#>
[CmdletBinding()]
param(
  [string]$App = "archloom",
  [string]$EnvFile = "",
  [string]$Manifest = "",
  [switch]$Fresh,
  [switch]$NoRestore,
  [switch]$SkipBuild,
  [switch]$Yes,
  [int]$Keep = 10
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
if (-not $EnvFile) { $EnvFile = Join-Path $PSScriptRoot ".env.pcf" }
if (-not $Manifest) { $Manifest = Join-Path $repo "manifest.yml" }

function Read-EnvFile([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) {
    throw "No $path. Copy deploy\.env.pcf.example to deploy\.env.pcf and fill it in."
  }
  $map = [ordered]@{}
  foreach ($line in (Get-Content -LiteralPath $path)) {
    $t = $line.Trim()
    if (-not $t) { continue }
    if ($t.StartsWith("#")) { continue }
    $i = $t.IndexOf("=")
    if ($i -lt 1) { continue }
    $k = $t.Substring(0, $i).Trim()
    $v = $t.Substring($i + 1).Trim()
    if ($v.Length -ge 2) {
      $quoted = ($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'"))
      if ($quoted) { $v = $v.Substring(1, $v.Length - 2) }
    }
    if ($v -ne "") { $map[$k] = $v }
  }
  return $map
}

function Mask([string]$v) {
  if (-not $v) { return "(empty)" }
  if ($v.Length -le 8) { return ("*" * $v.Length) }
  return ($v.Substring(0, 3) + ("*" * ($v.Length - 6)) + $v.Substring($v.Length - 3))
}

$secretish = @("SECRET", "TOKEN", "KEY", "PASSWORD")
function Is-Secret([string]$name) {
  foreach ($s in $secretish) { if ($name.ToUpperInvariant().Contains($s)) { return $true } }
  return $false
}

# ---- 0. what we are about to do, and to which foundation -------------------------------

if (-not (Get-Command cf -ErrorAction SilentlyContinue)) { throw "The cf CLI is not on PATH." }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "node is not on PATH." }
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { throw "pnpm is not on PATH. corepack enable, or npm install -g pnpm@10.34.5" }
if (-not (Test-Path -LiteralPath $Manifest)) { throw "No manifest at $Manifest." }

$target = & cf target 2>&1
if ($LASTEXITCODE -ne 0) { throw "cf target failed. Run cf login first.`n$target" }

$vars = Read-EnvFile $EnvFile
$appUrl = [string]$vars["APP_URL"]
if ($appUrl) { $appUrl = $appUrl.TrimEnd("/"); $vars["APP_URL"] = $appUrl }
$adminToken = [string]$vars["TANDEM_ADMIN_TOKEN"]

$required = @("APP_URL", "SESSION_SECRET", "TANDEM_MASTER_KEY", "TANDEM_ADMIN_TOKEN", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET")
$missing = @()
foreach ($k in $required) { if (-not $vars[$k]) { $missing += $k } }
if ($missing.Count -gt 0) { throw ("Missing in ${EnvFile}: " + ($missing -join ", ")) }

# Refuse the values that look like the example rather than a deployment.
$masterKey = [string]$vars["TANDEM_MASTER_KEY"]
if ($masterKey -notmatch "^[0-9a-fA-F]{64}$") { throw "TANDEM_MASTER_KEY must be 64 hex characters." }
if ($masterKey -eq ("0" * 64)) { throw "TANDEM_MASTER_KEY is the all-zero development key. Generate one: node -e `"console.log(require('crypto').randomBytes(32).toString('hex'))`"" }
if (([string]$vars["SESSION_SECRET"]).Length -lt 32) { throw "SESSION_SECRET is shorter than 32 characters." }
if ($adminToken.Length -lt 16) { throw "TANDEM_ADMIN_TOKEN is short; it is the key to every session on the install." }
if (([string]$vars["TANDEM_DEV_AUTH"]) -eq "1") { throw "TANDEM_DEV_AUTH=1 lets anyone sign in as any handle. Remove it from $EnvFile." }
if (-not $appUrl.StartsWith("https://")) { Write-Warning "APP_URL is not https. GitHub sign-in and secure cookies expect https." }

Write-Host ""
Write-Host "archloom -> Cloud Foundry"
Write-Host $target
Write-Host ("  app        " + $App)
Write-Host ("  manifest   " + $Manifest)
Write-Host ("  env file   " + $EnvFile + "  (" + $vars.Count + " variables)")
foreach ($k in $vars.Keys) {
  $shown = $vars[$k]
  if (Is-Secret $k) { $shown = Mask $shown }
  Write-Host ("               " + $k.PadRight(22) + $shown)
}
Write-Host ("  data       " + $(if ($Fresh) { "not backed up (-Fresh)" } else { "exported before the push, imported after it" }))
Write-Host ""

if (-not $Yes) {
  $answer = Read-Host "Push to the target above? (y/N)"
  if ($answer -ne "y" -and $answer -ne "Y") { Write-Host "Nothing pushed."; exit 1 }
}

# ---- 1. build here ---------------------------------------------------------------------

if (-not $SkipBuild) {
  Write-Host "`n1. building"
  Push-Location $repo
  try {
    & pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw "pnpm install failed." }
    & pnpm build
    if ($LASTEXITCODE -ne 0) { throw "pnpm build failed." }
  } finally { Pop-Location }
}
if (-not (Test-Path -LiteralPath (Join-Path $repo "web\dist\index.html"))) {
  throw "web\dist\index.html is missing. Run without -SkipBuild: the SPA is built here and pushed, staging only installs."
}

# ---- 2. back up what is running --------------------------------------------------------

$bundle = ""
if (-not $Fresh) {
  Write-Host "`n2. backing up the running install"
  & cf app $App 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "There is no app called $App in this space. Use -Fresh for the first deploy."
  }
  # Deliberately fatal: a push over a live install with no backup loses every session.
  $bundle = & (Join-Path $PSScriptRoot "backup.ps1") -Url $appUrl -Token $adminToken -Keep $Keep | Select-Object -Last 1
  if (-not $bundle -or -not (Test-Path -LiteralPath $bundle)) { throw "The backup produced no bundle; not pushing." }
} else {
  Write-Host "`n2. skipping the backup (-Fresh)"
}

# ---- 3. push ---------------------------------------------------------------------------

Write-Host "`n3. pushing"
Push-Location $repo
try {
  # --no-start so the secrets are in place before the process starts. Never --strategy
  # rolling: it runs two instances at once, and two of this app is two writers.
  & cf push $App -f $Manifest --no-start
  if ($LASTEXITCODE -ne 0) { throw "cf push failed." }
} finally { Pop-Location }

Write-Host "   setting environment"
foreach ($k in $vars.Keys) {
  & cf set-env $App $k $vars[$k] | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "cf set-env $k failed." }
  $shown = $vars[$k]
  if (Is-Secret $k) { $shown = Mask $shown }
  Write-Host ("     " + $k.PadRight(22) + $shown)
}

& cf start $App
if ($LASTEXITCODE -ne 0) { throw "cf start failed. cf logs $App --recent" }

Write-Host "   waiting for $appUrl/api/health"
$ok = $false
for ($i = 0; $i -lt 60; $i++) {
  try {
    $health = Invoke-RestMethod -Uri "$appUrl/api/health" -Method Get -TimeoutSec 10
    if ($health.ok) { $ok = $true; break }
  } catch { Start-Sleep -Seconds 5 }
}
if (-not $ok) { throw "The app started but $appUrl/api/health never answered. Check the route against APP_URL, then cf logs $App --recent." }
Write-Host ("   healthy, provider " + $health.provider + ", dev auth " + $health.devAuth)

# ---- 4. put the data back --------------------------------------------------------------

if ($bundle -and -not $NoRestore) {
  Write-Host "`n4. restoring the sessions"
  & node (Join-Path $repo "server\scripts\backup.mjs") import --url $appUrl --token $adminToken --in $bundle --mode replace
  if ($LASTEXITCODE -ne 0) { throw "The restore failed. The bundle is still at $bundle - run the import again by hand." }
} elseif ($bundle) {
  Write-Host "`n4. not restoring (-NoRestore). The bundle is at $bundle"
} else {
  Write-Host "`n4. nothing to restore"
}

Write-Host ""
Write-Host "Done. $appUrl"
Write-Host "  The GitHub OAuth App's callback must be $appUrl/auth/github/callback"
Write-Host "  People connect their own Copilot seat again: credentials and tool servers are not in the bundle."
