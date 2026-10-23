# Tests for common.ps1. Runs anywhere PowerShell runs (Windows PowerShell 5.1 and PowerShell 7), no modules needed:
#   powershell -ExecutionPolicy Bypass -File .\run-tests.ps1
# Exit code = number of failures. Network checks are not exercised here (they need a live API).
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'common.ps1')

$script:failed = 0; $script:passed = 0
function Check($name, $cond) { if ($cond) { $script:passed++ } else { $script:failed++; Write-Host "FAIL: $name" -ForegroundColor Red } }
function Throws($name, [scriptblock]$code, $like) {
  $msg = $null; try { & $code } catch { $msg = $_.Exception.Message }
  Check $name ($msg -and ((-not $like) -or $msg -like $like))
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("kio-tests-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
$goodToken = 'kvc_0123abcd_' + ('A' * 43)
$otherToken = 'kvc_89abcdef_' + ('B' * 43)
function Bytes($p) { , [IO.File]::ReadAllBytes($p) }
function HasBom($p) { $b = Bytes $p; $b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF }

try {
  # ---- validators
  foreach ($ip in '192.168.5.14', '10.0.0.1', '127.0.0.1', '0.0.0.0', '255.255.255.255') { Check "IPv4 ok: $ip" (Test-IPv4 $ip) }
  foreach ($ip in '1', '192.168.5', '192.168.5.256', '192.168.5.1.1', 'a.b.c.d', '', '192.168.05.1', '1.2.3.4; calc') { Check "IPv4 rejected: '$ip'" (-not (Test-IPv4 $ip)) }
  Check 'analyzer IP ok' (Test-AnalyzerIp '192.168.5.14')
  foreach ($ip in '0.0.0.0', '255.255.255.255', '224.0.0.1', '239.1.1.1') { Check "analyzer IP rejected: $ip" (-not (Test-AnalyzerIp $ip)) }
  Check 'listen IP may be 0.0.0.0' (Test-ListenIp '0.0.0.0')
  Check 'listen IP not multicast' (-not (Test-ListenIp '224.0.0.1'))
  Check 'port 8001' (Test-Port 8001); Check 'port 1' (Test-Port 1); Check 'port 65535' (Test-Port 65535)
  foreach ($p in 0, 65536, -1, 'abc', '', '80;x') { Check "port rejected: '$p'" (-not (Test-Port $p)) }
  Check 'service name' (Test-ServiceName 'vh30'); Check 'service name dash' (Test-ServiceName 'chem-2')
  foreach ($n in 'VH30', '-x', 'a b', 'a/b', 'a;b', '', ('a' * 32), '..\x') { Check "service name rejected: '$n'" (-not (Test-ServiceName $n)) }
  Check 'analyzer name' (Test-AnalyzerName 'VH-30 Test (lab 1)')
  foreach ($n in '', ' x', 'a<b>', 'a&b', 'a"b', "a'b", 'x;y', ('a' * 61), 'a%b', 'a$b', 'a`b') { Check "analyzer name rejected: '$n'" (-not (Test-AnalyzerName $n)) }
  Check 'token ok' (Test-ConnectorToken $goodToken)
  foreach ($t in '', 'kvc_', 'kvc_0123abcd_short', ('kvc_0123ABCD_' + ('A' * 43)), ('xxx_0123abcd_' + ('A' * 43))) { Check "token rejected: '$t'" (-not (Test-ConnectorToken $t)) }

  # ---- API address
  Check 'url normal' ((ConvertTo-ApiUrl 'https://api.example.com') -eq 'https://api.example.com')
  Check 'url trims and drops trailing slash' ((ConvertTo-ApiUrl '  https://api.example.com/  ') -eq 'https://api.example.com')
  Check 'url keeps a path prefix' ((ConvertTo-ApiUrl 'https://x.io/kesher/') -eq 'https://x.io/kesher')
  Check 'url keeps a port' ((ConvertTo-ApiUrl 'https://x.io:8443') -eq 'https://x.io:8443')
  Throws 'url http refused' { ConvertTo-ApiUrl 'http://api.example.com' } '*https*'
  Throws 'url empty refused' { ConvertTo-ApiUrl '' } '*empty*'
  Throws 'url garbage refused' { ConvertTo-ApiUrl 'not a url' }
  Throws 'url with credentials refused' { ConvertTo-ApiUrl 'https://user:pw@api.example.com' } '*user name*'
  Throws 'url with query refused' { ConvertTo-ApiUrl 'https://api.example.com/?x=1' } '*? or #*'
  Throws 'url with trailing /api refused' { ConvertTo-ApiUrl 'https://api.example.com/api' } '*WITHOUT*'
  Throws 'url with odd host refused' { ConvertTo-ApiUrl 'https://a_b$c.example.com' }

  # ---- connector.json: write, read, Node-compatible encoding
  $cfg = Join-Path $tmp 'connector.json'
  Check 'missing file state' (-not (Get-ConfigState $cfg).Exists)
  Write-ConnectorConfig $cfg 'https://one.example.com/' $goodToken
  Check 'written without BOM' (-not (HasBom $cfg))
  Check 'no temp file left' (-not (Test-Path "$cfg.tmp"))
  $s = Get-ConfigState $cfg
  Check 'round trip' ($s.Valid -and $s.ApiUrl -eq 'https://one.example.com' -and $s.Token -eq $goodToken -and -not $s.HasBom)
  Throws 'write refuses a bad token' { Write-ConnectorConfig $cfg 'https://x.io' 'nope' } '*connector token*'
  Check 'bad write left the file intact' ((Get-ConfigState $cfg).Token -eq $goodToken)
  Throws 'write refuses http' { Write-ConnectorConfig $cfg 'http://x.io' $goodToken } '*https*'

  # ---- updating only the address
  Check 'update changes the address' (Set-ConfigApiUrl $cfg 'https://two.example.com')
  $s = Get-ConfigState $cfg
  Check 'update keeps the token' ($s.ApiUrl -eq 'https://two.example.com' -and $s.Token -eq $goodToken)
  Check 'update with the same address is a no-op' (-not (Set-ConfigApiUrl $cfg 'https://two.example.com/'))
  Throws 'update refuses a bad address' { Set-ConfigApiUrl $cfg 'http://x.io' } '*https*'
  Check 'a refused update changed nothing' ((Get-ConfigState $cfg).ApiUrl -eq 'https://two.example.com')
  $bad = Join-Path $tmp 'bad.json'; [IO.File]::WriteAllText($bad, '{ nope', (New-Object Text.UTF8Encoding($false)))
  Throws 'update refuses an unusable file' { Set-ConfigApiUrl $bad 'https://x.io' } '*not usable*'
  Check 'unusable file untouched' ([IO.File]::ReadAllText($bad) -eq '{ nope')

  # ---- a hand-edited file with a BOM is readable and gets repaired; nothing else changes
  $bomFile = Join-Path $tmp 'bom.json'
  $body = [Text.Encoding]::UTF8.GetBytes("{`"apiUrl`":`"https://three.example.com`",`"token`":`"$otherToken`"}")
  [IO.File]::WriteAllBytes($bomFile, (@(0xEF, 0xBB, 0xBF) + $body))
  $s = Get-ConfigState $bomFile
  Check 'BOM file is read' ($s.Valid -and $s.HasBom -and $s.Token -eq $otherToken)
  Check 'repair reports it fixed the file' (Repair-ConfigEncoding $bomFile)
  Check 'BOM gone' (-not (HasBom $bomFile))
  $s = Get-ConfigState $bomFile
  Check 'repair kept address and token' ($s.Valid -and $s.ApiUrl -eq 'https://three.example.com' -and $s.Token -eq $otherToken)
  Check 'repair of a clean file is a no-op' (-not (Repair-ConfigEncoding $bomFile))
  [IO.File]::WriteAllBytes($bomFile, (@(0xEF, 0xBB, 0xBF) + $body))
  Check 'an address update also removes the BOM' (Set-ConfigApiUrl $bomFile 'https://three.example.com')
  Check 'BOM gone after update' (-not (HasBom $bomFile))

  # ---- plain-language API problems
  Check 'dns, dev tunnel' ((Get-ApiProblem 0 'The remote name could not be resolved' 'https://x.trycloudflare.com') -like '*trycloudflare*expires*')
  Check 'dns, normal' ((Get-ApiProblem 0 'No such host is known' 'https://api.example.com') -like '*DNS*')
  Check '530' ((Get-ApiProblem 530 '' 'https://x.io') -like '*nothing is behind*')
  Check '401' ((Get-ApiProblem 401 '' 'https://x.io') -like '*refused the token*')
  Check '404' ((Get-ApiProblem 404 '' 'https://x.io') -like '*not the KesherIO API*')
  Check 'tls' ((Get-ApiProblem 0 'The SSL connection could not be established' 'https://x.io') -like '*certificate*')
  Check 'dropped, dev tunnel' ((Get-ApiProblem 0 'An error occurred | The response ended prematurely.' 'https://x.trycloudflare.com') -like '*tunnel*')
  Check 'timeout' ((Get-ApiProblem 0 'The operation has timed out' 'https://x.io') -like '*timed out*')

  $inner = New-Object System.Exception('An error occurred while sending the request.', (New-Object System.Exception('No such host is known.')))
  Check 'exception chain is flattened' ((Get-ExceptionText $inner) -like '*sending the request*No such host*')

  # ---- startup hints
  Check 'hint: adapter' ((Get-StartupHint 'listen EADDRNOTAVAIL: address not available 192.168.5.13:8001') -like '*not assigned*')
  Check 'hint: port busy' ((Get-StartupHint 'Error: listen EADDRINUSE: address already in use') -like '*already used*')
  Check 'hint: bad json' ((Get-StartupHint 'SyntaxError: Unexpected token in JSON at position 0') -like '*BOM*')
  Check 'hint: none' ($null -eq (Get-StartupHint 'all fine'))

  # ---- package integrity
  $pkg = Join-Path $tmp 'pkg'; New-Item -ItemType Directory -Path (Join-Path $pkg 'bin') | Out-Null
  [IO.File]::WriteAllText((Join-Path $pkg 'bin/a.txt'), 'alpha'); [IO.File]::WriteAllText((Join-Path $pkg 'b.txt'), 'beta')
  $h = { param($p) (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLower() }
  [IO.File]::WriteAllText((Join-Path $pkg 'SHA256SUMS.txt'), ((& $h (Join-Path $pkg 'bin/a.txt')) + '  bin/a.txt' + "`n" + (& $h (Join-Path $pkg 'b.txt')) + '  b.txt' + "`n"))
  $r = Test-PackageIntegrity $pkg
  Check 'intact package passes' ($r.Present -and $r.Problems.Count -eq 0 -and $r.Fingerprint.Length -eq 12)
  [IO.File]::WriteAllText((Join-Path $pkg 'b.txt'), 'tampered')
  Check 'a changed file is caught' ((Test-PackageIntegrity $pkg).Problems -contains 'changed: b.txt')
  Remove-Item (Join-Path $pkg 'bin/a.txt')
  Check 'a missing file is caught' ((Test-PackageIntegrity $pkg).Problems -contains 'missing: bin/a.txt')
  Remove-Item (Join-Path $pkg 'SHA256SUMS.txt')
  Check 'no checksum file = not verified, not an error' (-not (Test-PackageIntegrity $pkg).Present)
}
finally { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }

Write-Host "$($script:passed) passed, $($script:failed) failed"
exit $script:failed
