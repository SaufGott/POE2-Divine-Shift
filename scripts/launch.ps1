# Starts the local server if it is not already running, then opens the dashboard.
#
#   powershell -NoProfile -File scripts/launch.ps1
#
# The app cannot run from file:// (Web Workers are blocked there and getDisplayMedia
# needs a secure context), so a local server is always required. This script reuses
# one that is already up instead of starting a second.

param([switch]$Check)

$Root = Split-Path -Parent $PSScriptRoot
$Port = 8090
$Url = "http://127.0.0.1:$Port/index.html"

function Test-Server {
  try {
    Invoke-WebRequest "http://127.0.0.1:$Port/index.html" -UseBasicParsing -TimeoutSec 2 | Out-Null
    return $true
  } catch {
    return $false
  }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error 'node is not on PATH — install Node.js or run the app from a machine that has it.'
  exit 1
}

if (Test-Server) {
  Write-Output 'server already running'
} else {
  Start-Process -FilePath 'node' -ArgumentList 'serve.mjs', $Port -WorkingDirectory $Root
  for ($i = 0; $i -lt 20 -and -not (Test-Server); $i += 1) { Start-Sleep -Milliseconds 250 }
  if (-not (Test-Server)) {
    Write-Error "could not start the server on port $Port"
    exit 1
  }
}

if ($Check) {
  Write-Output "ok: $Url"
  exit 0
}

Start-Process $Url
