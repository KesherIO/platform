#Requires -Version 5.1
<#
.SYNOPSIS
  Changes the API address (and optionally the token) of an ALREADY INSTALLED connector, without reinstalling and
  without editing connector.json by hand. Double-click update-config.bat, or run in an elevated PowerShell:
    powershell -ExecutionPolicy Bypass -File .\update-config.ps1 [-Name vh30] [-ApiUrl https://...] [-ReplaceToken]

.DESCRIPTION
  - Only the address (and, with -ReplaceToken, the token) changes. Saved messages, logs, the service definition,
    firewall rule and everything else are left alone.
  - The token is read from a hidden prompt (or KESHERIO_CONNECTOR_TOKEN, removed afterwards); it is never a parameter.
  - The file is rewritten atomically as UTF-8 without a byte-order mark (what Node needs).
  - The service is restarted so it picks the change up, then the new address is checked.
#>
[CmdletBinding()]
param(
  [string]$Name = 'vh30',
  [string]$ApiUrl,
  [switch]$ReplaceToken,
  [switch]$Unattended
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here 'common.ps1')
Assert-Administrator

if (-not (Test-ServiceName $Name)) { Fail "-Name must be lowercase letters, digits and dashes (got '$Name')." }
$serviceId  = "KesherIOConnector-$Name"
$dataDir    = Join-Path $env:ProgramData "KesherIO\Connector\$Name"
$configFile = Join-Path $dataDir 'connector.json'
if (-not (Test-Path $configFile)) { Fail "No connector named '$Name' is configured here ($configFile not found). Run install.bat first." }

$state = Get-ConfigState $configFile
if (-not $state.Valid) { Fail "The saved configuration is not usable ($($state.Problem)). Re-run install.ps1 -Reconfigure." }
Step "Connector '$Name'"
Info "Current API address: $($state.ApiUrl)"

# --- new address
$newUrl = $state.ApiUrl
if ($ApiUrl) {
  try { $newUrl = ConvertTo-ApiUrl $ApiUrl } catch { Fail $_.Exception.Message }
} elseif (-not $Unattended -and -not $ReplaceToken) {
  $newUrl = ConvertTo-ApiUrl (Read-Valid 'New API address (https://...)' $state.ApiUrl { param($v) try { [void](ConvertTo-ApiUrl $v); $true } catch { $false } } 'Enter an https:// address with no trailing /api.')
}

# --- new token (optional)
$newToken = $state.Token
if ($ReplaceToken) {
  $plain = $env:KESHERIO_CONNECTOR_TOKEN
  Remove-Item Env:\KESHERIO_CONNECTOR_TOKEN -ErrorAction SilentlyContinue
  if (-not $plain) {
    if ($Unattended) { Fail 'Unattended token replacement needs KESHERIO_CONNECTOR_TOKEN.' }
    for ($try = 0; $try -lt 3 -and -not (Test-ConnectorToken $plain); $try++) {
      $secure = Read-Host 'New connector token (kvc_..., typing is hidden)' -AsSecureString
      $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
      try { $plain = ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)).Trim() }
      finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
      if (-not (Test-ConnectorToken $plain)) { Warn 'That is not a connector token. Paste it again.' }
    }
  }
  if (-not (Test-ConnectorToken $plain)) { Fail 'No valid connector token was given. Nothing was changed.' }
  $newToken = $plain
  $plain = $null
}

# --- check before saving
$health = Test-ApiHealth $newUrl
if ($health.Ok) { Ok "$newUrl answers" } else { Warn "$newUrl does not answer right now: $($health.Message)" }
if ($health.Ok) {
  $t = Test-ApiToken $newUrl $newToken
  if ($t.Ok) { Ok "Token accepted (analyzer '$($t.Analyzer)')" }
  elseif ($ReplaceToken -and ($t.Status -eq 401 -or $t.Status -eq 403)) { Fail 'The API refused the new token, so it was NOT saved. The old token is still in place.' }
  else { Warn $t.Message }
}

# --- save + restart
$changed = $false
if ($newToken -ne $state.Token) { Write-ConnectorConfig $configFile $newUrl $newToken; $changed = $true }
elseif ($newUrl -ne $state.ApiUrl -or $state.HasBom) { $changed = Set-ConfigApiUrl $configFile $newUrl }
$newToken = $null
if (-not $changed) { Ok 'Nothing to change: the configuration is already as requested.'; exit 0 }
Ok "Saved $configFile"

$svc = Get-Service -Name $serviceId -ErrorAction SilentlyContinue
if ($svc) {
  Restart-Service -Name $serviceId -Force
  Start-Sleep -Seconds 3
  if ((Get-Service -Name $serviceId).Status -eq 'Running') { Ok 'Service restarted and running (queued messages upload with the new settings)' }
  else { Show-ServiceDiagnostics $serviceId $dataDir; exit 2 }
} else { Warn "No service '$serviceId' is installed; the new settings apply when it is." }
