#Requires -Version 5.1
<#
.SYNOPSIS
  Installs (or upgrades) the KesherIO analyzer connector as a Windows service. Run once per analyzer,
  in an elevated PowerShell:   powershell -ExecutionPolicy Bypass -File .\install.ps1

.DESCRIPTION
  - One service per analyzer: "KesherIO Connector - <Name>", own port, own data folder, own token.
  - The connector token is NEVER a command-line argument, parameter or log line. It is read from a hidden
    prompt (or, for unattended installs, from the KESHERIO_CONNECTOR_TOKEN environment variable, which is
    removed again) and written only to <data>\connector.json, in a folder only SYSTEM, Administrators and the
    service account can read.
  - Program files:  %ProgramFiles%\KesherIO\Connector\            (replaced on upgrade)
    Data per analyzer: %ProgramData%\KesherIO\Connector\<Name>\    (kept on upgrade and uninstall)
  - Re-running for an existing <Name> upgrades the program files and keeps the saved settings, API address and
    token unless you pass -Reconfigure.
#>
[CmdletBinding()]
param(
  [string]$Name = 'vh30',
  [string]$AnalyzerName = 'VH-30',
  [string]$ListenIp = '192.168.5.13',
  [int]$ListenPort = 8001,
  [string]$AnalyzerIp = '192.168.5.14',
  [string]$ApiUrl,
  [switch]$Reconfigure,
  [switch]$DisableSleep,
  [switch]$Unattended,
  [switch]$SkipSelfCheck
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function Fail($m) { Write-Host "ERROR: $m" -ForegroundColor Red; exit 1 }
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "   OK  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "   !!  $m" -ForegroundColor Yellow }

# ---------------------------------------------------------------- preconditions
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Fail 'Run this from an elevated PowerShell (right-click > Run as administrator).'
}
if ($Name -notmatch '^[a-z0-9][a-z0-9-]{0,30}$') { Fail "-Name must be lowercase letters, digits and dashes (got '$Name')." }
if ($AnalyzerName -notmatch '^[\w .()+-]{1,60}$') { Fail "-AnalyzerName has unusual characters: '$AnalyzerName'." }
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = @{
  Node = Join-Path $here 'bin\node.exe'
  Cjs  = Join-Path $here 'bin\vh30-receiver.cjs'
  Wrap = Join-Path $here 'bin\WinSW-x64.exe'
  Xml  = Join-Path $here 'KesherIOConnector.xml.template'
}
foreach ($k in $src.Keys) { if (-not (Test-Path $src[$k])) { Fail "Package is incomplete: missing $($src[$k])" } }

$serviceId   = "KesherIOConnector-$Name"
$displayName = "KesherIO Connector $([char]0x2013) $AnalyzerName ($Name)"
$progRoot    = Join-Path $env:ProgramFiles 'KesherIO\Connector'
$appDir      = Join-Path $progRoot 'app'
$svcDir      = Join-Path $progRoot "services\$Name"
$dataDir     = Join-Path $env:ProgramData "KesherIO\Connector\$Name"
$configFile  = Join-Path $dataDir 'connector.json'
$wrapperExe  = Join-Path $svcDir "$serviceId.exe"
$existing    = Get-Service -Name $serviceId -ErrorAction SilentlyContinue
$xmlFile     = Join-Path $svcDir "$serviceId.xml"
$keepConfig  = (Test-Path $configFile) -and -not $Reconfigure   # token + API address already saved
$keepNetwork = $keepConfig -and (Test-Path $xmlFile)             # ...and so are IP/port settings

function Ask($prompt, $default) {
  if ($Unattended) { return $default }
  $a = Read-Host "$prompt [$default]"
  if ([string]::IsNullOrWhiteSpace($a)) { $default } else { $a.Trim() }
}

# ---------------------------------------------------------------- inputs
Step "Settings for analyzer '$AnalyzerName' (service $serviceId)"
if (-not $keepNetwork) {
  if (-not $PSBoundParameters.ContainsKey('ListenIp'))   { $ListenIp   = Ask 'IP address of THIS computer on the analyzer network' $ListenIp }
  if (-not $PSBoundParameters.ContainsKey('ListenPort')) { $ListenPort = [int](Ask 'TCP port to listen on' $ListenPort) }
  if (-not $PSBoundParameters.ContainsKey('AnalyzerIp')) { $AnalyzerIp = Ask 'IP address of the analyzer' $AnalyzerIp }
} else {
  Ok 'Existing installation found: keeping its settings, API address and token (use -Reconfigure to change them).'
  $current = Get-Content $xmlFile -Raw
  if ($current -match 'VH30_HOST" value="([^"]+)"')       { $ListenIp   = $Matches[1] }
  if ($current -match 'VH30_PORT" value="(\d+)"')         { $ListenPort = [int]$Matches[1] }
  if ($current -match 'VH30_ALLOW_FROM" value="([^"]+)"') { $AnalyzerIp = $Matches[1] }
}
$parsed = $null
if (-not [Net.IPAddress]::TryParse($ListenIp, [ref]$parsed) -or $parsed.AddressFamily -ne 'InterNetwork') { Fail "Not an IPv4 address: $ListenIp" }
if (-not [Net.IPAddress]::TryParse($AnalyzerIp, [ref]$parsed) -or $parsed.AddressFamily -ne 'InterNetwork') { Fail "Not an IPv4 address: $AnalyzerIp" }
if ($ListenPort -lt 1 -or $ListenPort -gt 65535) { Fail "Port out of range: $ListenPort" }
if ($ListenIp -ne '0.0.0.0') {
  $mine = @(Get-NetIPAddress -AddressFamily IPv4 | ForEach-Object { $_.IPAddress })
  if ($mine -notcontains $ListenIp) {
    Fail "$ListenIp is not assigned to this computer (found: $($mine -join ', ')). Plug in / configure the analyzer network adapter first."
  }
}
if (-not $existing) {
  $busy = Get-NetTCPConnection -State Listen -LocalPort $ListenPort -ErrorAction SilentlyContinue
  if ($busy) { Fail "TCP port $ListenPort is already in use on this computer." }
}

$apiUrlFinal = $null
if (-not $keepConfig) {
  if (-not $ApiUrl) { $ApiUrl = Read-Host 'KesherIO API address (https://...)' }
  try { $u = [Uri]$ApiUrl } catch { Fail "Not a valid URL: $ApiUrl" }
  if ($u.Scheme -ne 'https') { Fail 'The API address must start with https://' }
  $apiUrlFinal = $u.GetLeftPart([UriPartial]::Path).TrimEnd('/')
}

# ---------------------------------------------------------------- program files
Step 'Copying program files'
if ($existing -and $existing.Status -ne 'Stopped') {
  Stop-Service -Name $serviceId -Force
  $existing.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
}
New-Item -ItemType Directory -Force -Path $appDir, $svcDir | Out-Null
Copy-Item $src.Node, $src.Cjs -Destination $appDir -Force
$replay = Join-Path $here 'bin\vh30-replay.cjs'
if (Test-Path $replay) { Copy-Item $replay -Destination $appDir -Force }
Ok $appDir

# ---------------------------------------------------------------- data folder + token (token never touches argv)
Step 'Preparing the data folder'
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
# SIDs, not names, so this works on any Windows language: SYSTEM, Administrators, LocalService (the service account).
& icacls.exe $dataDir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-19:(OI)(CI)M' | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "Could not restrict access to $dataDir" }
Ok "$dataDir (readable only by SYSTEM, Administrators and the service account)"

if (-not $keepConfig) {
  $plain = $env:KESHERIO_CONNECTOR_TOKEN
  Remove-Item Env:\KESHERIO_CONNECTOR_TOKEN -ErrorAction SilentlyContinue
  if (-not $plain) {
    if ($Unattended) { Fail 'Unattended install needs the token in the KESHERIO_CONNECTOR_TOKEN environment variable.' }
    $secure = Read-Host 'Connector token (kvc_..., typing is hidden)' -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  }
  if ($plain -notmatch '^kvc_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$') { Fail 'That is not a connector token (expected kvc_<8 hex>_<43 characters>).' }
  $json = [ordered]@{ apiUrl = $apiUrlFinal; token = $plain } | ConvertTo-Json
  $plain = $null
  $tmp = "$configFile.tmp"
  [IO.File]::WriteAllText($tmp, $json, (New-Object Text.UTF8Encoding($false)))   # inherits the folder ACL above
  Move-Item -Force $tmp $configFile
  $json = $null
  Ok "Saved $configFile"
}

# ---------------------------------------------------------------- service
Step 'Installing the service'
if ($existing) {
  if (Test-Path $wrapperExe) { & $wrapperExe uninstall | Out-Null } else { & sc.exe delete $serviceId | Out-Null }
}
Copy-Item $src.Wrap -Destination $wrapperExe -Force
function XmlEsc($s) { [Security.SecurityElement]::Escape([string]$s) }
$xml = Get-Content $src.Xml -Raw
$map = @{
  SERVICE_ID = $serviceId; SERVICE_NAME = $displayName; ANALYZER_NAME = $AnalyzerName
  NODE_EXE = (Join-Path $appDir 'node.exe'); RECEIVER_CJS = (Join-Path $appDir 'vh30-receiver.cjs')
  DATA_DIR = $dataDir; LISTEN_IP = $ListenIp; LISTEN_PORT = "$ListenPort"; ANALYZER_IP = $AnalyzerIp
}
foreach ($k in $map.Keys) { $xml = $xml.Replace("{{$k}}", (XmlEsc $map[$k])) }
if ($xml -match '\{\{') { Fail 'Internal error: unfilled placeholder in the service definition.' }
[IO.File]::WriteAllText((Join-Path $svcDir "$serviceId.xml"), $xml, (New-Object Text.UTF8Encoding($false)))
New-Item -ItemType Directory -Force -Path (Join-Path $dataDir 'logs') | Out-Null
& $wrapperExe install
if ($LASTEXITCODE -ne 0) { Fail 'Service installation failed (see the message above).' }
Ok "$displayName installed (automatic start at boot, restarts itself after a crash)"

# ---------------------------------------------------------------- firewall: this port, only from the analyzer
Step 'Firewall'
$ruleName = "KesherIO Connector - $Name"
Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $ListenPort `
  -RemoteAddress $AnalyzerIp -Profile Any | Out-Null
Ok "Inbound TCP $ListenPort allowed only from $AnalyzerIp"

# ---------------------------------------------------------------- power
if (-not $DisableSleep -and -not $Unattended) {
  $a = Read-Host 'Turn off automatic sleep/hibernate on this PC while plugged in (recommended for a lab PC)? [Y/n]'
  $DisableSleep = ($a -eq '' -or $a -match '^[Yy]')
}
if ($DisableSleep) {
  & powercfg.exe /change standby-timeout-ac 0 | Out-Null
  & powercfg.exe /change hibernate-timeout-ac 0 | Out-Null
  Ok 'Sleep and hibernate are off while plugged in'
} else { Warn 'Sleep not changed: a sleeping PC cannot receive results.' }

# ---------------------------------------------------------------- start + self-check
Step 'Starting'
Start-Service -Name $serviceId
Start-Sleep -Seconds 3
$bad = 0
$svc = Get-Service -Name $serviceId
if ($svc.Status -eq 'Running') { Ok 'Service is running' } else { Warn "Service state: $($svc.Status) - see $dataDir\logs"; $bad++ }
$listening = Get-NetTCPConnection -State Listen -LocalPort $ListenPort -ErrorAction SilentlyContinue
if ($listening) { Ok "Listening on $ListenIp`:$ListenPort" } else { Warn "Nothing is listening on port $ListenPort yet - see $dataDir\logs"; $bad++ }

if (-not $SkipSelfCheck) {
  try {
    $cfg = Get-Content $configFile -Raw | ConvertFrom-Json
    $r = Invoke-RestMethod -Uri "$($cfg.apiUrl)/api/instrument-ingest/ping" -Method Get -TimeoutSec 20 `
      -Headers @{ Authorization = "Bearer $($cfg.token)" }
    Ok "API reachable and token accepted (analyzer '$($r.analyzer)', credential '$($r.credential)')"
  } catch {
    $resp = $_.Exception.PSObject.Properties['Response']
    $code = if ($resp -and $resp.Value) { [int]$resp.Value.StatusCode } else { 0 }
    if ($code -eq 401 -or $code -eq 403) { Warn 'The API refused the token (revoked, wrong analyzer, or typed wrongly). Re-run with -Reconfigure.' }
    elseif ($code -gt 0) { Warn "The API answered HTTP $code." }
    else { Warn "Could not reach the API: $($_.Exception.Message). Results are saved locally and upload when the connection returns." }
    $bad++
  } finally { $cfg = $null }
}
Write-Host ''
if ($bad -eq 0) { Write-Host "Done. Run status.bat any time to see the connector's state." -ForegroundColor Green }
else { Write-Host "Installed, but $bad check(s) need attention (above). Run status.bat for details." -ForegroundColor Yellow; exit 2 }
