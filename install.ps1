#Requires -Version 5.0
<#
.SYNOPSIS
  octerse — install GitHub Copilot terse-mode into the current repo.
.DESCRIPTION
  Drops .github/copilot-instructions.md, .octerse/skills/, and merges
  .vscode/settings.json. Optionally writes AGENTS.md.
.PARAMETER Mode
  lite | full | ultra | enterprise (default: full)
.PARAMETER DryRun
  Preview file writes without touching anything.
.PARAMETER Force
  Overwrite existing files without prompting.
.PARAMETER WithAgents
  Also write AGENTS.md.
.PARAMETER WithShrink
  Append a commented octerse-shrink example to .vscode/mcp.json (never overwrites).
.PARAMETER SkipVscode
  Skip .vscode/settings.json.
.PARAMETER Uninstall
  Remove all octerse-managed files.
#>
[CmdletBinding()]
param(
  [ValidateSet('lite','full','ultra','enterprise')]
  [string]$Mode = 'full',
  [switch]$DryRun,
  [switch]$Force,
  [switch]$WithAgents,
  [switch]$WithShrink,
  [switch]$SkipVscode,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$Version = '0.4.0'
$RepoRaw = if ($env:OCTERSE_RAW) { $env:OCTERSE_RAW } else { 'https://raw.githubusercontent.com/heisenberg-alt/octerse/main' }

function Say  ($m) { Write-Host "  $m" }
function OK   ($m) { Write-Host "  " -NoNewline; Write-Host "✓ " -ForegroundColor Green -NoNewline; Write-Host $m }
function Warn ($m) { Write-Host "  " -NoNewline; Write-Host "! " -ForegroundColor Yellow -NoNewline; Write-Host $m }

function Run-Action($desc, $sb) {
  if ($DryRun) { Say "[dry-run] $desc" } else { & $sb }
}

# ---- repo detection --------------------------------------------------------
try { $repoRoot = (git rev-parse --show-toplevel) 2>$null } catch { $repoRoot = $null }
if (-not $repoRoot) { Write-Error "octerse: not inside a git repo. Run from the repo root."; exit 1 }
Set-Location $repoRoot

function Fetch-File($src, $dst) {
  if ((Test-Path $dst) -and -not $Force -and -not $Uninstall) {
    Warn "exists, keeping: $dst (use -Force to overwrite)"; return
  }
  $dir = Split-Path -Parent $dst
  if ($dir) { Run-Action "mkdir $dir" { New-Item -ItemType Directory -Force -Path $dir | Out-Null } }
  $localBase = $env:OCTERSE_LOCAL_SRC
  if ($localBase -and (Test-Path (Join-Path $localBase $src))) {
    Run-Action "copy $src" { Copy-Item -Path (Join-Path $localBase $src) -Destination $dst -Force }
  } else {
    Run-Action "fetch $src" {
      Invoke-WebRequest -Uri "$RepoRaw/$src" -OutFile $dst -UseBasicParsing
    }
  }
  OK "wrote $dst"
}

function Merge-VscodeSettings {
  $target = '.vscode/settings.json'
  $snippetSrc = 'templates/vscode-settings.json'
  $localBase = $env:OCTERSE_LOCAL_SRC
  if ($localBase -and (Test-Path (Join-Path $localBase $snippetSrc))) {
    $snippet = Get-Content (Join-Path $localBase $snippetSrc) -Raw
  } else {
    $snippet = (Invoke-WebRequest -Uri "$RepoRaw/$snippetSrc" -UseBasicParsing).Content
  }

  if ($DryRun) { Say "[dry-run] merge octerse keys into $target"; return }

  if (-not (Test-Path .vscode)) { New-Item -ItemType Directory -Path .vscode | Out-Null }
  if (-not (Test-Path $target)) {
    Set-Content -Path $target -Value $snippet -NoNewline
    OK "wrote $target"; return
  }

  try {
    $existing  = Get-Content $target -Raw | ConvertFrom-Json -AsHashtable
    $additions = $snippet | ConvertFrom-Json -AsHashtable
    foreach ($k in $additions.Keys) { $existing[$k] = $additions[$k] }
    ($existing | ConvertTo-Json -Depth 20) | Set-Content -Path $target
    OK "merged octerse keys into $target"
  } catch {
    Copy-Item $target "$target.octerse.bak" -Force
    Set-Content -Path $target -Value $snippet
    Warn "could not parse existing settings — backed up to $target.octerse.bak and replaced"
  }
}

# ---- uninstall -------------------------------------------------------------
if ($Uninstall) {
  Write-Host "`n  octerse uninstall`n"
  foreach ($p in @('.github/copilot-instructions.md', '.octerse', 'AGENTS.md')) {
    if (Test-Path $p) { Run-Action "remove $p" { Remove-Item -Recurse -Force $p }; OK "removed $p" }
  }
  if (Test-Path '.vscode/settings.json.octerse.bak') {
    Run-Action 'restore vscode settings' {
      Move-Item -Force '.vscode/settings.json.octerse.bak' '.vscode/settings.json'
    }
    OK "restored .vscode/settings.json from backup"
  } else {
    Warn ".vscode/settings.json was not auto-restored — remove octerse keys manually if you don't want them"
  }
  Write-Host "`n  done.`n"
  exit 0
}

# ---- install ---------------------------------------------------------------
$dryTag = if ($DryRun) { ' (dry-run)' } else { '' }
Write-Host "`n  octerse v$Version — mode: $Mode$dryTag`n"

Fetch-File "instructions/$Mode.md" '.github/copilot-instructions.md'

foreach ($skill in 'octerse-commit','octerse-review','octerse-help') {
  Fetch-File "skills/$skill.prompt.md" ".octerse/skills/$skill.prompt.md"
}

if (-not $SkipVscode) { Merge-VscodeSettings }
if ($WithAgents)      { Fetch-File 'templates/AGENTS.md' 'AGENTS.md' }

if ($WithShrink) {
  $mcpTarget = '.vscode/mcp.json'
  $marker    = 'octerse-shrink: example wrapper'
  if ((Test-Path $mcpTarget) -and (Select-String -Path $mcpTarget -Pattern $marker -Quiet)) {
    Say "$marker already present in $mcpTarget — keeping"
  } elseif ($DryRun) {
    Say "[dry-run] append octerse-shrink example to $mcpTarget"
  } else {
    if (-not (Test-Path .vscode)) { New-Item -ItemType Directory -Path .vscode | Out-Null }
    if (-not (Test-Path $mcpTarget)) { Set-Content -Path $mcpTarget -Value "{`n  `"servers`": {}`n}`n" -NoNewline }
    $snippet = @'

// ───────────────────────────────────────────────────────────────────────────
// octerse-shrink: example wrapper. Wrap any stdio MCP server like this to
// compress tools/list descriptions in flight. Tool calls are NOT touched.
// Default OFF — copy this snippet into the "servers" object above to enable.
//
// "filesystem-shrunk": {
//   "type": "stdio",
//   "command": "npx",
//   "args": ["-y", "octerse-shrink", "--",
//            "npx", "-y", "@modelcontextprotocol/server-filesystem", "${workspaceFolder}"]
// }
//
// Set OCTERSE_SHRINK=0 in env to bypass at runtime without changing config.
// ───────────────────────────────────────────────────────────────────────────
'@
    Add-Content -Path $mcpTarget -Value $snippet
    OK "appended octerse-shrink example to $mcpTarget (commented; copy to enable)"
  }
}

if (-not $DryRun) {
  if (-not (Test-Path .octerse)) { New-Item -ItemType Directory -Path .octerse | Out-Null }
  Set-Content -Path '.octerse/mode'       -Value $Mode -NoNewline
  $stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  $state = @{ version = $Version; mode = $Mode; installed_at = $stamp } | ConvertTo-Json -Compress
  Set-Content -Path '.octerse/state.json' -Value $state
}

if (-not $DryRun -and (Test-Path .gitignore)) {
  $gi = Get-Content .gitignore -Raw
  if ($gi -notmatch '\.octerse/state\.json') {
    Add-Content .gitignore "`n# octerse`n.octerse/state.json`n.octerse/stats.jsonl"
    OK 'appended octerse rules to .gitignore'
  }
}

$vsLine = if ($SkipVscode) { 'skipped' } else { '.vscode/settings.json' }
@"

  octerse installed.

    Mode:                 $Mode
    Instructions file:    .github/copilot-instructions.md
    Skills directory:     .octerse/skills/
    VS Code settings:     $vsLine

  Next:
    1. Open this repo in VS Code (reload the window if it was already open).
    2. In Copilot Chat, try /octerse-help for a quick reference.
    3. Switch modes any time:  gh octerse mode lite

  ROI calculator:  https://heisenberg-alt.github.io/usage-based-billing/
  Uninstall:       irm $RepoRaw/install.ps1 | iex; octerse-install -Uninstall

"@ | Write-Host
