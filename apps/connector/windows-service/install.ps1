#Requires -Version 5.1
<#
.SYNOPSIS
  Installs (or upgrades) the KesherIO analyzer connector as a Windows service. Double-click install.bat, or run in an
  elevated PowerShell:   powershell -ExecutionPolicy Bypass -File .\install.ps1

.DESCRIPTION
  - One service per analyzer: "KesherIO Connector - <Name>", own port, own data folder, own token.
  - The connector token is NEVER a command-line argument, parameter or log line. It is read from a hidden
    prompt (or, for unattended installs, from the KESHERIO_CONNECTOR_TOKEN environment variable, which is
    removed again) and written only to <data>\connector.json, in a folder only SYSTEM, Administrators and the
    service account can read.
  - Program files:  %ProgramFiles%\KesherIO\Connector\            (replaced on upgrade)
    Data per analyzer: %ProgramData%\KesherIO\Connector\<Name>\    (messages, config, logs: kept on upgrade and uninstall)
  - Re-running for an existing <Name> upgrades the program files and keeps the saved settings, API address and
    token unless you pass -Reconfigure. To change only the API address use update-config.bat.
  - An API address that is wrong, expired or offline does not stop the installation: results are saved locally and
    upload once the address works.
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
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here 'common.ps1')

Assert-Administrator

# ---------------------------------------------------------------- the package must be whole and unaltered
$integrity = Test-PackageIntegrity $here
if ($integrity.Present) {
  if ($integrity.Problems.Count -gt 0) { Fail "This package is damaged or has been altered:`n   - $($integrity.Problems -join "`n   - ")" }
  Ok "Package verified (fingerprint $($integrity.Fingerprint) - compare it with the one you were sent)"
} else { Warn 'No SHA256SUMS.txt: this is not a built package, so its files were not verified.' }

# ---------------------------------------------------------------- validate everything passed in, before touching anything
if (-not (Test-ServiceName $Name)) { Fail "-Name must be lowercase letters, digits and dashes, starting with a letter or digit (got '$Name')." }
$src = @{
  Node = Join-Path $here 'bin\node.exe'
  Cjs  = Join-Path $here 'bin\vh30-receiver.cjs'
  Wrap = Join-Path $here 'bin\WinSW-x64.exe'
  Xml  = Join-Path $here 'KesherIOConnector.xml.template'
}
foreach ($k in $src.Keys) { if (-not (Test-Path $src[$k])) { Fail "Package is incomplete: missing $($src[$k])" } }

$serviceId   = "KesherIOConnector-$Name"
$progRoot    = Join-Path $env:ProgramFiles 'KesherIO\Connector'
$appDir      = Join-Path $progRoot 'app'
$svcDir      = Join-Path $progRoot "services\$Name"
$dataDir     = Join-Path $env:ProgramData "KesherIO\Connector\$Name"
$configFile  = Join-Path $dataDir 'connector.json'
$xmlFile     = Join-Path $svcDir "$serviceId.xml"
$wrapperExe  = Join-Path $svcDir "$serviceId.exe"
$existing    = Get-Service -Name $serviceId -ErrorAction SilentlyContinue

$saved = $null
if ((Test-Path $configFile) -and -not $Reconfigure) {
  $state = Get-ConfigState $configFile
  if ($state.Valid) { $saved = $state } else { Warn "$configFile exists but is not usable ($($state.Problem)); a new token will be asked for." }
}
$keepConfig  = [bool]$saved                          # token + API address already saved
$keepNetwork = $keepConfig -and (Test-Path $xmlFile)  # ...and so are the analyzer/IP/port settings

# ---------------------------------------------------------------- inputs
Step "Settings (service $serviceId)"
$interactive = -not $Unattended
$bound = $PSBoundParameters
if ($keepNetwork) {
  Ok 'Existing installation found: keeping its analyzer name, IPs, port, API address and token (use -Reconfigure to change them, update-config.bat to change only the API address).'
  $current = Get-Content $xmlFile -Raw
  if ($current -match 'VH30_HOST" value="([^"]+)"')       { $ListenIp   = $Matches[1] }
  if ($current -match 'VH30_PORT" value="(\d+)"')         { $ListenPort = [int]$Matches[1] }
  if ($current -match 'VH30_ALLOW_FROM" value="([^"]+)"') { $AnalyzerIp = $Matches[1] }
  if ($current -match '<description>Receives HL7 results from the (.+?) analyzer') { $AnalyzerName = $Matches[1] }
} elseif ($interactive) {
  if (-not $bound.ContainsKey('AnalyzerName') -or -not (Test-AnalyzerName $AnalyzerName)) {
    $AnalyzerName = Read-Valid 'Analyzer name' $AnalyzerName { param($v) Test-AnalyzerName $v } 'Use letters, digits, spaces and . ( ) + _ - only (max 60).'
  }
  if (-not $bound.ContainsKey('ListenIp') -or -not (Test-ListenIp $ListenIp)) {
    $ListenIp = Read-Valid 'IP address of THIS computer on the analyzer network' $ListenIp { param($v) Test-ListenIp $v } 'Enter an IPv4 address such as 192.168.5.13.'
  }
  if (-not $bound.ContainsKey('ListenPort') -or -not (Test-Port $ListenPort)) {
    $ListenPort = [int](Read-Valid 'TCP port to listen on' "$ListenPort" { param($v) Test-Port $v } 'Enter a number from 1 to 65535.')
  }
  if (-not $bound.ContainsKey('AnalyzerIp') -or -not (Test-AnalyzerIp $AnalyzerIp)) {
    $AnalyzerIp = Read-Valid 'IP address of the ANALYZER (the only address allowed through the firewall)' $AnalyzerIp { param($v) Test-AnalyzerIp $v } 'Enter the analyzer''s IPv4 address, such as 192.168.5.14 (not 0.0.0.0 or a broadcast/multicast address).'
  }
}
if (-not (Test-AnalyzerName $AnalyzerName)) { Fail "-AnalyzerName: letters, digits, spaces and . ( ) + _ - only, up to 60 characters (got '$AnalyzerName')." }
if (-not (Test-ListenIp $ListenIp)) { Fail "-ListenIp is not a usable IPv4 address: $ListenIp" }
if (-not (Test-Port $ListenPort)) { Fail "-ListenPort must be 1-65535 (got $ListenPort)." }
if (-not (Test-AnalyzerIp $AnalyzerIp)) { Fail "-AnalyzerIp must be the analyzer's own IPv4 address (not 0.0.0.0, broadcast or multicast): $AnalyzerIp" }
$displayName = "KesherIO Connector $([char]0x2013) $AnalyzerName ($Name)"

if ($ListenIp -ne '0.0.0.0') {
  $mine = @(Get-NetIPAddress -AddressFamily IPv4 | ForEach-Object { $_.IPAddress })
  if ($mine -notcontains $ListenIp) {
    Fail "$ListenIp is not assigned to this computer (found: $($mine -join ', ')). Plug in / configure the analyzer network adapter first."
  }
} else { Warn 'Listening on every network adapter (0.0.0.0). The firewall still only admits the analyzer''s IP.' }
if (-not $existing) {
  $busy = Get-NetTCPConnection -State Listen -LocalPort $ListenPort -ErrorAction SilentlyContinue
  if ($busy) { Fail "TCP port $ListenPort is already in use on this computer." }
}

# API address: validated, but a wrong/expired/offline one never aborts the installation
$apiUrlFinal = $null
$updateUrl = $false
if ($keepConfig) {
  Ok "Keeping the token and API address saved in $configFile ($($saved.ApiUrl))"
  $apiUrlFinal = $saved.ApiUrl
  if ($ApiUrl) {
    try { $new = ConvertTo-ApiUrl $ApiUrl } catch { Fail $_.Exception.Message }
    if ($new -ne $saved.ApiUrl) { $apiUrlFinal = $new; $updateUrl = $true; Ok "API address will change to $new (token kept)" }
  }
} else {
  if (-not $ApiUrl -and $interactive) {
    $ApiUrl = Read-Valid 'KesherIO API address (https://...)' '' { param($v) try { [void](ConvertTo-ApiUrl $v); $true } catch { $false } } 'Enter an https:// address with no trailing /api, for example https://api.example.com'
  }
  if (-not $ApiUrl) { Fail 'The API address is required: pass -ApiUrl https://...' }
  try { $apiUrlFinal = ConvertTo-ApiUrl $ApiUrl } catch { Fail $_.Exception.Message }
}
$health = Test-ApiHealth $apiUrlFinal
if ($health.Ok) { Ok "API address answers: $apiUrlFinal" }
else {
  Warn "$apiUrlFinal does not answer right now."
  Info $health.Message
  Info 'The installation continues. Results are saved on this PC and upload once the address works;'
  Info 'fix it any time with update-config.bat (no reinstall needed).'
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
Ok "$dataDir (readable only by SYSTEM, Administrators and the service account; existing messages, config and logs are kept)"

if (-not $keepConfig) {
  $plain = $env:KESHERIO_CONNECTOR_TOKEN
  Remove-Item Env:\KESHERIO_CONNECTOR_TOKEN -ErrorAction SilentlyContinue
  if (-not $plain) {
    if (-not $interactive) { Fail 'Unattended install needs the token in the KESHERIO_CONNECTOR_TOKEN environment variable.' }
    for ($try = 0; $try -lt 3 -and -not (Test-ConnectorToken $plain); $try++) {
      $secure = Read-Host 'Connector token (kvc_..., typing is hidden)' -AsSecureString
      $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
      try { $plain = ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)).Trim() }
      finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
      if (-not (Test-ConnectorToken $plain)) { Warn 'That is not a connector token (expected kvc_<8 hex>_<43 characters>). Paste it again.' }
    }
  }
  if (-not (Test-ConnectorToken $plain)) { Fail 'No valid connector token was given.' }
  Write-ConnectorConfig $configFile $apiUrlFinal $plain
  $plain = $null
  Ok "Saved $configFile"
} elseif ($updateUrl) {
  [void](Set-ConfigApiUrl $configFile $apiUrlFinal)
  Ok "Updated the API address in $configFile (token unchanged)"
} elseif ((Repair-ConfigEncoding $configFile)) {
  Ok "Rewrote $configFile without a byte-order mark (Node could not read it as it was)"
}
$saved = $null

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
$left = [regex]::Matches($xml, '\{\{[A-Z_]+\}\}') | ForEach-Object { $_.Value } | Select-Object -Unique
if ($left) { Fail "Internal error: unfilled placeholder(s) in the service definition: $($left -join ', ')" }
[IO.File]::WriteAllText($xmlFile, $xml, $script:Utf8NoBom)
New-Item -ItemType Directory -Force -Path (Join-Path $dataDir 'logs') | Out-Null
& $wrapperExe install
if ($LASTEXITCODE -ne 0) { Fail 'Service installation failed (see the message above).' }
$acct = (Get-CimInstance Win32_Service -Filter "Name='$serviceId'").StartName
if ($acct -notmatch 'LocalService$') { Fail "The service was registered to run as '$acct', not LocalService. Not starting it; uninstall.ps1 -Name $Name removes it." }
Ok "$displayName installed (automatic start at boot, restarts itself after a crash, account $acct)"

# ---------------------------------------------------------------- firewall: this port, only from the analyzer
Step 'Firewall'
$ruleName = "KesherIO Connector - $Name"
Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $ListenPort `
  -RemoteAddress $AnalyzerIp -Profile Any | Out-Null
$rule = Get-NetFirewallRule -DisplayName $ruleName
$remote = (Get-NetFirewallAddressFilter -AssociatedNetFirewallRule $rule).RemoteAddress
$ports = (Get-NetFirewallPortFilter -AssociatedNetFirewallRule $rule).LocalPort
if ("$remote" -ne $AnalyzerIp -or "$ports" -ne "$ListenPort") { Fail "The firewall rule did not come out as intended (remote '$remote', port '$ports'). Remove it with uninstall.ps1 and retry." }
Ok "Inbound TCP $ListenPort allowed only from $AnalyzerIp (verified)"

# ---------------------------------------------------------------- power
if (-not $DisableSleep -and $interactive) {
  $a = Read-Host 'Turn off automatic sleep/hibernate on this PC while plugged in (recommended for a lab PC)? [Y/n]'
  $sleepOff = ($a -eq '' -or $a -match '^[Yy]')
} else { $sleepOff = [bool]$DisableSleep }
if ($sleepOff) {
  & powercfg.exe /change standby-timeout-ac 0 | Out-Null
  & powercfg.exe /change hibernate-timeout-ac 0 | Out-Null
  Ok 'Sleep and hibernate are off while plugged in'
} else { Warn 'Sleep not changed: a sleeping PC cannot receive results.' }

# ---------------------------------------------------------------- start + self-check
Step 'Starting'
Start-Service -Name $serviceId -ErrorAction SilentlyContinue
$svc = $null
for ($i = 0; $i -lt 10; $i++) {   # a crash-looping service flaps; give it a moment to show its state
  Start-Sleep -Seconds 1
  $svc = Get-Service -Name $serviceId
  if ($svc.Status -ne 'StartPending') { break }
}
Start-Sleep -Seconds 2
$svc = Get-Service -Name $serviceId
$bad = 0
if ($svc.Status -eq 'Running') { Ok 'Service is running' } else { Show-ServiceDiagnostics $serviceId $dataDir; $bad++ }
$listening = Get-NetTCPConnection -State Listen -LocalPort $ListenPort -ErrorAction SilentlyContinue
if ($listening) { Ok "Listening on $ListenIp`:$ListenPort" }
elseif ($svc.Status -eq 'Running') { Warn "Running, but nothing is listening on port $ListenPort yet - see $dataDir\logs"; $bad++ }

if (-not $SkipSelfCheck) {
  $c = Get-ConfigState $configFile
  # The token is only ever sent to an address that has first answered the API's public health check.
  $hh = Test-ApiHealth $c.ApiUrl
  if ($hh.Ok) { $r = Test-ApiToken $c.ApiUrl $c.Token }
  else { $r = [pscustomobject]@{ Ok = $false; Status = $hh.Status; Analyzer = $null; Credential = $null; Message = $hh.Message } }
  if ($r.Ok) { Ok "API reachable and token accepted (analyzer '$($r.Analyzer)', credential '$($r.Credential)')" }
  else {
    Warn $r.Message
    if ($r.Status -eq 401 -or $r.Status -eq 403) { Info 'Replace the token with: update-config.bat (choose to replace the token).' }
    else { Info 'Results are saved locally and upload when the connection returns. Change the address with update-config.bat.' }
    $bad++
  }
  $c = $null
}
Write-Host ''
if ($bad -eq 0) { Write-Host "Done. Run status.bat any time to see the connector's state." -ForegroundColor Green }
else { Write-Host "Installed, but $bad check(s) need attention (above). Run status.bat for details." -ForegroundColor Yellow; exit 2 }
