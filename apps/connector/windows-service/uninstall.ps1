#Requires -Version 5.1
<#
.SYNOPSIS
  Removes one analyzer connector service (and its firewall rule). The data folder
  (%ProgramData%\KesherIO\Connector\<Name>: saved messages, connector.json, logs) is ALWAYS kept, so a
  reinstall picks up where it left off and nothing received is lost. Delete that folder by hand if you
  really want it gone.
#>
[CmdletBinding()]
param([string]$Name = 'vh30')
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here 'common.ps1')
Assert-Administrator
if (-not (Test-ServiceName $Name)) { Fail "-Name must be lowercase letters, digits and dashes (got '$Name')." }

$serviceId = "KesherIOConnector-$Name"
$progRoot  = Join-Path $env:ProgramFiles 'KesherIO\Connector'
$svcDir    = Join-Path $progRoot "services\$Name"
$dataDir   = Join-Path $env:ProgramData "KesherIO\Connector\$Name"
$wrapper   = Join-Path $svcDir "$serviceId.exe"

$svc = Get-Service -Name $serviceId -ErrorAction SilentlyContinue
if ($svc) {
  if ($svc.Status -ne 'Stopped') { Stop-Service -Name $serviceId -Force; $svc.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30)) }
  if (Test-Path $wrapper) { & $wrapper uninstall | Out-Null } else { & sc.exe delete $serviceId | Out-Null }
  Write-Host "Service $serviceId removed."
} else { Write-Host "No service named $serviceId (nothing to stop)." }

Get-NetFirewallRule -DisplayName "KesherIO Connector - $Name" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
if (Test-Path $svcDir) { Remove-Item -Recurse -Force $svcDir }
# Shared program files go only when no other analyzer still uses them.
$left = @(Get-ChildItem (Join-Path $progRoot 'services') -Directory -ErrorAction SilentlyContinue)
if ($left.Count -eq 0 -and (Test-Path $progRoot)) { Remove-Item -Recurse -Force $progRoot }
Write-Host "Kept your data: $dataDir"
