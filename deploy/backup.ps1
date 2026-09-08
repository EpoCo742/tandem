#Requires -Version 5.1
<#
.SYNOPSIS
  Take a dated backup of a running archloom install through its operator routes.

.DESCRIPTION
  Writes two things into deploy/backups/<timestamp>/:

    bundle.json  every session whole - ledger, people, uploads with their bytes, canvas
                 layout, published pages - and the accounts that took part. This is the
                 one that can be put back, with backup.mjs import or push.ps1.
    archloom.db  the SQLite file itself, copied consistently while the app runs. Carries
                 what the bundle does not (sealed credentials, tool servers, notification
                 rules) but not the uploaded files, and there is no route to put it back:
                 it is for reading with a SQLite client, or for restoring by hand onto a
                 volume. Keep TANDEM_MASTER_KEY unchanged or its credentials stay sealed.

  Needs TANDEM_ADMIN_TOKEN set on the app. Both are read from deploy/.env.pcf unless -Url
  and -Token are given.

.EXAMPLE
  .\deploy\backup.ps1
  .\deploy\backup.ps1 -Url https://archloom.apps.example.com -Token $env:TANDEM_ADMIN_TOKEN -Keep 30
#>
[CmdletBinding()]
param(
  [string]$Url = "",
  [string]$Token = "",
  [string]$EnvFile = "",
  [string]$OutDir = "",
  [int]$Keep = 10,
  [switch]$DbOnly,
  [switch]$BundleOnly
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
if (-not $EnvFile) { $EnvFile = Join-Path $PSScriptRoot ".env.pcf" }
if (-not $OutDir) { $OutDir = Join-Path $PSScriptRoot "backups" }

function Read-EnvFile([string]$path) {
  $map = @{}
  if (-not (Test-Path -LiteralPath $path)) { return $map }
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
    $map[$k] = $v
  }
  return $map
}

function Mask([string]$v) {
  if (-not $v) { return "(empty)" }
  if ($v.Length -le 8) { return ("*" * $v.Length) }
  return ($v.Substring(0, 3) + ("*" * ($v.Length - 6)) + $v.Substring($v.Length - 3))
}

$fileEnv = Read-EnvFile $EnvFile
if (-not $Url) { $Url = [string]$fileEnv["APP_URL"] }
if (-not $Token) { $Token = [string]$fileEnv["TANDEM_ADMIN_TOKEN"] }
if (-not $Token) { $Token = [string]$env:TANDEM_ADMIN_TOKEN }
$Url = $Url.TrimEnd("/")

if (-not $Url) { throw "No app URL. Set APP_URL in $EnvFile or pass -Url." }
if (-not $Token) { throw "No admin token. Set TANDEM_ADMIN_TOKEN in $EnvFile or pass -Token. Without it the admin routes are off and there is nothing to back up." }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "node is not on PATH; the backup runs through server/scripts/backup.mjs." }

Write-Host "archloom backup"
Write-Host ("  app    " + $Url)
Write-Host ("  token  " + (Mask $Token))

# Fail before making a directory if the install is not answering, so an unreachable app never
# looks like an empty backup.
try {
  $health = Invoke-RestMethod -Uri "$Url/api/health" -Method Get -TimeoutSec 30
} catch {
  throw "No answer from $Url/api/health - $($_.Exception.Message)"
}
if (-not $health.ok) { throw "$Url/api/health did not say ok." }

$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss") + "Z"
$dest = Join-Path $OutDir $stamp
New-Item -ItemType Directory -Path $dest -Force | Out-Null
$script = Join-Path $repo "server\scripts\backup.mjs"
$bundle = Join-Path $dest "bundle.json"
$dbFile = Join-Path $dest "archloom.db"

if (-not $DbOnly) {
  & node $script export --url $Url --token $Token --out $bundle
  if ($LASTEXITCODE -ne 0) { throw "The session bundle export failed." }
}
if (-not $BundleOnly) {
  & node $script db --url $Url --token $Token --out $dbFile
  if ($LASTEXITCODE -ne 0) { throw "The database copy failed." }
}

# Keep the newest $Keep folders; a backup nobody prunes eventually fills the disk it is on.
if ($Keep -gt 0) {
  $old = Get-ChildItem -LiteralPath $OutDir -Directory | Sort-Object Name -Descending | Select-Object -Skip $Keep
  foreach ($d in $old) {
    Remove-Item -LiteralPath $d.FullName -Recurse -Force
    Write-Host ("  pruned " + $d.Name)
  }
}

$size = (Get-ChildItem -LiteralPath $dest -File | Measure-Object -Property Length -Sum).Sum
Write-Host ("  wrote  " + $dest + "  (" + [math]::Round($size / 1MB, 1) + " MB)")

# The bundle path is this script's output so push.ps1 can hand it straight to the restore.
if (-not $DbOnly) { $bundle }
