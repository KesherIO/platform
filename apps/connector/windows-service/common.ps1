# Shared helpers for install.ps1 / update-config.ps1 / uninstall.ps1 (dot-sourced; never run on its own).
# Everything here is free of Windows-only cmdlets except where noted, so run-tests.ps1 can exercise it anywhere
# and it stays compatible with Windows PowerShell 5.1. Keep this file ASCII-only (5.1 reads BOM-less files as ANSI).

$script:TokenPattern = '^kvc_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$'
$script:Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# ------------------------------------------------------------------ console
function Fail($m) { Write-Host "ERROR: $m" -ForegroundColor Red; exit 1 }
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "   OK  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "   !!  $m" -ForegroundColor Yellow }
function Info($m) { Write-Host "       $m" }

function Assert-Administrator {
  $p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Fail 'Run this as administrator (use install.bat, or right-click PowerShell > Run as administrator).'
  }
}

# ------------------------------------------------------------------ validators (pure)
function Test-IPv4([string]$s) {
  return [bool]($s -match '^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$')
}
# The IP the analyzer connects FROM. It becomes the firewall's only allowed remote address, so "any"
# style values are refused: 0.0.0.0, broadcast, multicast.
function Test-AnalyzerIp([string]$s) {
  if (-not (Test-IPv4 $s)) { return $false }
  $first = [int]($s.Split('.')[0])
  return -not ($s -eq '0.0.0.0' -or $s -eq '255.255.255.255' -or $first -ge 224)
}
function Test-ListenIp([string]$s) { return (Test-IPv4 $s) -and ([int]($s.Split('.')[0]) -lt 224) }
function Test-Port($v) {
  $n = 0
  return [int]::TryParse([string]$v, [ref]$n) -and $n -ge 1 -and $n -le 65535
}
# -cmatch: PowerShell's -match ignores case, and these patterns are case-sensitive on purpose
function Test-ServiceName([string]$s) { return [bool]($s -cmatch '^[a-z0-9][a-z0-9-]{0,30}$') }
function Test-AnalyzerName([string]$s) { return [bool]($s -match '^[A-Za-z0-9][A-Za-z0-9 .()+_-]{0,59}$') }
function Test-ConnectorToken([string]$s) { return [bool]($s -cmatch $script:TokenPattern) }

# https://host[/path] only. Returns the normalised address, or throws a message a person can act on.
function ConvertTo-ApiUrl([string]$text) {
  $t = ([string]$text).Trim()
  if (-not $t) { throw 'The API address is empty.' }
  $u = $null
  if (-not [Uri]::TryCreate($t, [UriKind]::Absolute, [ref]$u)) { throw "Not a valid address: $t (expected https://host)." }
  if ($u.Scheme -ne 'https') { throw 'The API address must start with https://' }
  if ($u.UserInfo) { throw 'The API address must not contain a user name or password.' }
  if ($u.Query -or $u.Fragment) { throw 'The API address must not contain ? or # parts.' }
  if (-not $u.Host -or $u.Host -notmatch '^[A-Za-z0-9.-]+$') { throw "Unusual host name in the API address: $($u.Host)" }
  $path = $u.AbsolutePath.TrimEnd('/')
  if ($path -match '(?i)/api$') { throw 'Give the address WITHOUT the trailing /api (the connector adds it).' }
  return $u.GetLeftPart([UriPartial]::Authority) + $path
}

# Asks until the answer passes $validate (a scriptblock taking the text). Unattended callers must not use this.
function Read-Valid([string]$prompt, [string]$default, [scriptblock]$validate, [string]$hint) {
  for ($i = 0; $i -lt 5; $i++) {
    $label = if ($default) { "$prompt [$default]" } else { $prompt }
    $a = Read-Host $label
    if ([string]::IsNullOrWhiteSpace($a)) { $a = $default }
    $a = ([string]$a).Trim()
    if ($a -and (& $validate $a)) { return $a }
    Warn $hint
  }
  Fail "Too many invalid answers for: $prompt"
}

# ------------------------------------------------------------------ connector.json (Node reads it: UTF-8, NO BOM)
function Get-ConfigState([string]$path) {
  $s = [ordered]@{ Exists = $false; Valid = $false; HasBom = $false; ApiUrl = $null; Token = $null; Problem = $null }
  if (-not (Test-Path -LiteralPath $path)) { return [pscustomobject]$s }
  $s.Exists = $true
  try {
    $bytes = [IO.File]::ReadAllBytes($path)
    $s.HasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
    $text = $script:Utf8NoBom.GetString($bytes)
    if ($text.Length -gt 0 -and $text[0] -eq [char]0xFEFF) { $text = $text.Substring(1) }
    $c = $text | ConvertFrom-Json
    $url = $null
    try { $url = ConvertTo-ApiUrl ([string]$c.apiUrl) } catch { $s.Problem = "apiUrl: $($_.Exception.Message)" }
    if ($url -and -not (Test-ConnectorToken ([string]$c.token))) { $s.Problem = 'token is not a connector token' }
    elseif ($url) { $s.Valid = $true; $s.ApiUrl = $url; $s.Token = [string]$c.token }
  } catch { $s.Problem = "not readable JSON: $($_.Exception.Message)" }
  return [pscustomobject]$s
}

# Atomic write (temp file in the same folder, then rename). The folder's ACL is inherited by the temp file, so the
# token is never readable by anyone the folder does not already allow.
function Write-ConnectorConfig([string]$path, [string]$apiUrl, [string]$token) {
  $url = ConvertTo-ApiUrl $apiUrl
  if (-not (Test-ConnectorToken $token)) { throw 'That is not a connector token (expected kvc_<8 hex>_<43 characters>).' }
  $json = ([ordered]@{ apiUrl = $url; token = $token } | ConvertTo-Json)
  $tmp = "$path.tmp"
  [IO.File]::WriteAllText($tmp, $json, $script:Utf8NoBom)
  Move-Item -LiteralPath $tmp -Destination $path -Force
}

# Changes ONLY the address; the token, and everything else in the data folder, stay as they are.
function Set-ConfigApiUrl([string]$path, [string]$newUrl) {
  $url = ConvertTo-ApiUrl $newUrl
  $s = Get-ConfigState $path
  if (-not $s.Valid) { throw "Cannot update: the saved configuration is not usable ($($s.Problem)). Re-run install.ps1 -Reconfigure." }
  if ($s.ApiUrl -eq $url -and -not $s.HasBom) { return $false }
  Write-ConnectorConfig $path $url $s.Token
  return $true
}

# A hand-edited connector.json often gains a UTF-8 BOM; Node's JSON.parse chokes on it. Rewrites it clean.
function Repair-ConfigEncoding([string]$path) {
  $s = Get-ConfigState $path
  if ($s.Valid -and $s.HasBom) { Write-ConnectorConfig $path $s.ApiUrl $s.Token; return $true }
  return $false
}

# ------------------------------------------------------------------ talking to the API
function Get-HttpStatus($err) {
  $r = $err.Exception.PSObject.Properties['Response']
  if ($r -and $r.Value -and $r.Value.PSObject.Properties['StatusCode']) { return [int]$r.Value.StatusCode }
  return 0
}

# The messages of an exception and everything inside it (PowerShell 7 puts the DNS/TLS detail in the inner one).
function Get-ExceptionText($ex) {
  $parts = @()
  while ($ex) { $parts += $ex.Message; $ex = $ex.InnerException }
  return ($parts -join ' | ')
}

# A plain-language reason for a failed request. Pure: takes the status code and the exception message.
function Get-ApiProblem([int]$status, [string]$message, [string]$url) {
  $dev = $url -match '\.trycloudflare\.com'
  if ($status -eq 401 -or $status -eq 403) { return 'The API refused the token (revoked, for another analyzer, or typed wrongly).' }
  if ($status -eq 530 -or $status -eq 502 -or $status -eq 503 -or $status -eq 504) {
    return "The address answers but nothing is behind it (HTTP $status). If this is a development tunnel, it has expired or the API is not running."
  }
  if ($status -eq 404) { return 'The address answers but is not the KesherIO API (HTTP 404). Check for a typo or an extra path.' }
  if ($status -gt 0) { return "The API answered HTTP $status." }
  if ($message -match '(?i)could not be resolved|name or service not known|no such host|nodename nor servname|resolve') {
    if ($dev) { return 'The address does not exist (DNS). A trycloudflare.com development tunnel expires when it is restarted - get the new address.' }
    return 'The address does not exist (DNS lookup failed). Check the spelling and this PC''s internet connection.'
  }
  if ($message -match '(?i)ssl|tls|certificate|trust') { return 'A secure connection could not be made (certificate/TLS problem). Check the address and the PC''s date and time.' }
  if ($message -match '(?i)ended prematurely|connection was (closed|forcibly)|reset by peer|closed unexpectedly') {
    if ($dev) { return 'The connection was dropped. A trycloudflare.com development tunnel that has expired or stopped looks like this - get the new address.' }
    return 'The connection was dropped by the other side. The API may be down or restarting; try again shortly.'
  }
  if ($message -match '(?i)timed out|timeout|canceled') { return 'The request timed out. The internet connection may be down or blocked by a firewall/proxy.' }
  if ($message -match '(?i)refused|unreachable|connect') { return 'Could not connect. The internet connection may be down or blocked.' }
  return "Could not reach the API: $message"
}

# Never throws. { Ok; Status; Message }
function Test-ApiHealth([string]$url) {
  try {
    $r = Invoke-WebRequest -Uri "$url/api/health/live" -Method Get -UseBasicParsing -TimeoutSec 15
    return [pscustomobject]@{ Ok = ([int]$r.StatusCode -eq 200); Status = [int]$r.StatusCode; Message = 'API reachable' }
  } catch {
    $st = Get-HttpStatus $_
    return [pscustomobject]@{ Ok = $false; Status = $st; Message = (Get-ApiProblem $st (Get-ExceptionText $_.Exception) $url) }
  }
}

# Never throws. Sends the token only as an HTTPS Authorization header, from inside this process.
function Test-ApiToken([string]$url, [string]$token) {
  try {
    $r = Invoke-RestMethod -Uri "$url/api/instrument-ingest/ping" -Method Get -TimeoutSec 20 -Headers @{ Authorization = "Bearer $token" }
    return [pscustomobject]@{ Ok = $true; Status = 200; Analyzer = [string]$r.analyzer; Credential = [string]$r.credential; Message = 'token accepted' }
  } catch {
    $st = Get-HttpStatus $_
    return [pscustomobject]@{ Ok = $false; Status = $st; Analyzer = $null; Credential = $null; Message = (Get-ApiProblem $st (Get-ExceptionText $_.Exception) $url) }
  }
}

# ------------------------------------------------------------------ package integrity
# build-package.sh writes SHA256SUMS.txt ("<hash>  <relative/path>"). A copy that was altered or damaged after it
# was built is refused. Returns the problems (empty = fine) and the short fingerprint to compare with the sender's.
function Test-PackageIntegrity([string]$root) {
  $sums = Join-Path $root 'SHA256SUMS.txt'
  if (-not (Test-Path -LiteralPath $sums)) { return [pscustomobject]@{ Present = $false; Problems = @(); Fingerprint = $null } }
  $problems = @()
  foreach ($line in (Get-Content -LiteralPath $sums)) {
    if ($line -notmatch '^([0-9a-f]{64})  (.+)$') { if ($line.Trim()) { $problems += "bad line in SHA256SUMS.txt: $line" }; continue }
    $rel = $Matches[2]
    $file = Join-Path $root ($rel.Replace('/', [string][IO.Path]::DirectorySeparatorChar))
    if (-not (Test-Path -LiteralPath $file)) { $problems += "missing: $rel"; continue }
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLower() -ne $Matches[1]) { $problems += "changed: $rel" }
  }
  $fp = (Get-FileHash -LiteralPath $sums -Algorithm SHA256).Hash.ToLower().Substring(0, 12)
  return [pscustomobject]@{ Present = $true; Problems = $problems; Fingerprint = $fp }
}

# ------------------------------------------------------------------ why a service did not start
# Pure: turns log text into a likely cause.
function Get-StartupHint([string]$text) {
  if ($text -match 'EADDRNOTAVAIL') { return 'The listening IP is not assigned to this PC. Plug in / configure the analyzer network adapter, or re-run install.ps1 -Reconfigure with the right IP.' }
  if ($text -match 'EADDRINUSE') { return 'The port is already used by another program (or a second copy of the receiver). Stop it, or install on another port.' }
  if ($text -match 'EACCES|EPERM') { return 'The service account was refused access to the data folder or port. Check the folder permissions.' }
  if ($text -match 'Invalid API URL|API URL must|Token is not a connector token') { return 'connector.json is not valid. Run update-config.bat, or install.ps1 -Reconfigure.' }
  if ($text -match 'Unexpected token|JSON') { return 'connector.json could not be read (damaged, or saved with a BOM). Run update-config.bat to rewrite it.' }
  if ($text -match 'Cannot find module|ENOENT') { return 'A program file is missing. Re-run install.ps1 from a complete package.' }
  return $null
}

# Windows only (service, event log).
function Show-ServiceDiagnostics([string]$serviceId, [string]$dataDir) {
  Warn "The service '$serviceId' is not running."
  $svc = Get-Service -Name $serviceId -ErrorAction SilentlyContinue
  if ($svc) { Info "State: $($svc.Status)" }
  $logDir = Join-Path $dataDir 'logs'
  $all = ''
  foreach ($f in @(Get-ChildItem -LiteralPath $logDir -Filter '*.log' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 3)) {
    $tail = (Get-Content -LiteralPath $f.FullName -Tail 15 -ErrorAction SilentlyContinue) -join "`n"
    $all += "`n$tail"
    Info "--- last lines of $($f.Name) ---"
    Info $tail
  }
  try {
    $ev = Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'Service Control Manager'; StartTime = (Get-Date).AddMinutes(-10) } -ErrorAction Stop |
      Where-Object { $_.Message -like "*$serviceId*" -or $_.Message -like '*KesherIO*' } | Select-Object -First 3
    foreach ($e in $ev) { Info "--- Windows event: $($e.Message)"; $all += "`n$($e.Message)" }
  } catch { }
  $hint = Get-StartupHint $all
  if ($hint) { Warn "Likely cause: $hint" } else { Info "Full logs: $logDir" }
}
