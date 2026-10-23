#Requires -Version 5.1
<#
.SYNOPSIS
  Shows every KesherIO connector on this PC: service state, the API address it uploads to and whether that address
  answers, and the receiver's own status file. Never prints a token. Double-click status.bat.
#>
[CmdletBinding()]
param([string]$Root = (Join-Path $env:ProgramData 'KesherIO\Connector'))
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here 'common.ps1')

if (-not (Test-Path -LiteralPath $Root)) { Warn "No connector is installed (nothing under $Root)."; exit 0 }
$dirs = @(Get-ChildItem -LiteralPath $Root -Directory -ErrorAction SilentlyContinue)
if ($dirs.Count -eq 0) { Warn "No connector is installed (nothing under $Root)."; exit 0 }

foreach ($d in $dirs) {
  Step "Connector '$($d.Name)'"
  $serviceId = "KesherIOConnector-$($d.Name)"
  if (Get-Command Get-Service -ErrorAction SilentlyContinue) {
    $svc = Get-Service -Name $serviceId -ErrorAction SilentlyContinue
    if (-not $svc) { Warn "Service $serviceId is not installed." }
    elseif ($svc.Status -eq 'Running') { Ok "Service $serviceId is running" }
    else { Warn "Service $serviceId is $($svc.Status)" }
  }

  $cfg = Get-ConfigState (Join-Path $d.FullName 'connector.json')
  if (-not $cfg.Exists) { Warn 'No connector.json: uploads are off (messages are only saved on this PC).' }
  elseif (-not $cfg.Valid) { Warn "connector.json is not usable: $($cfg.Problem). Run update-config.bat." }
  else {
    Info "API address: $($cfg.ApiUrl)"
    if ($cfg.HasBom) { Warn 'connector.json has a byte-order mark; run update-config.bat to rewrite it.' }
    $h = Test-ApiHealth $cfg.ApiUrl
    if ($h.Ok) { Ok 'The API address answers' } else { Warn "The API address does not answer: $($h.Message)" }
  }

  $statusFile = Join-Path $d.FullName 'status.json'
  if (Test-Path -LiteralPath $statusFile) {
    Info "Receiver status ($((Get-Item -LiteralPath $statusFile).LastWriteTime)):"
    Get-Content -LiteralPath $statusFile | ForEach-Object { Info "  $_" }
  } else { Info 'No status file yet - the receiver has not started or has not written one.' }
  Info "Logs: $(Join-Path $d.FullName 'logs')"
}
