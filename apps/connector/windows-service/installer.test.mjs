// Run: node --test apps/connector/windows-service/installer.test.mjs
// Static checks on the wrappers and the security properties of the installer, plus - when PowerShell (pwsh or
// Windows PowerShell) is available - the real behaviour of common.ps1, including that the config file Node reads
// is UTF-8 without a BOM. The Windows-only parts (service, ACL, firewall, UAC) need a Windows machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync,
  readdirSync,
  existsSync,
  mkdtempSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(here, f), 'utf8');
const scripts = readdirSync(here).filter((f) => f.endsWith('.ps1'));
const bats = ['install.bat', 'update-config.bat', 'status.bat'];

function findPwsh() {
  const candidates = [process.env.PWSH, 'pwsh', 'powershell'];
  const cache = join(homedir(), '.cache', 'kesherio-tools');
  if (existsSync(cache))
    for (const d of readdirSync(cache)) candidates.push(join(cache, d, 'pwsh'));
  for (const c of candidates.filter(Boolean)) {
    const r = spawnSync(
      c,
      ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'],
      { encoding: 'utf8' }
    );
    if (r.status === 0) return c;
  }
  return null;
}
const pwsh = findPwsh();
const needPwsh = { skip: pwsh ? false : 'PowerShell is not installed here' };
const run = (args, env = {}) =>
  spawnSync(pwsh, ['-NoProfile', ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    cwd: here,
  });

test('every PowerShell/batch file is ASCII (Windows PowerShell 5.1 reads BOM-less files as ANSI)', () => {
  for (const f of [...scripts, ...bats])
    assert.doesNotMatch(read(f), /[^\t\n\r -~]/, f);
});

test('batch files have CRLF line endings, as cmd.exe expects', () => {
  for (const f of bats) {
    const t = read(f);
    assert.ok(t.includes('\r\n'), f);
    assert.doesNotMatch(t, /[^\r]\n/, `${f} has a bare LF`);
  }
});

for (const [bat, ps1] of [
  ['install.bat', 'install.ps1'],
  ['update-config.bat', 'update-config.ps1'],
]) {
  test(`${bat}: double-click wrapper that elevates and runs ${ps1}`, () => {
    const t = read(bat);
    assert.match(t, /fltmc >nul 2>&1/); // admin check
    assert.match(t, /Start-Process -FilePath \$env:KESHERIO_SELF -Verb RunAs/); // UAC prompt
    assert.match(
      t,
      new RegExp(
        `-NoProfile -ExecutionPolicy Bypass -File "%~dp0${ps1.replace(
          '.',
          '\\.'
        )}"`
      )
    );
    assert.match(t, /\bpause\b/i);
    assert.match(t, /if not exist "%~dp0/); // refuses to run from a half-unzipped folder
  });
  test(`${bat}: nothing from the path or the command line is pasted into a PowerShell command`, () => {
    const t = read(bat);
    assert.doesNotMatch(t, /%\*/); // no argument forwarding
    const commands = t.split(/\r?\n/).filter((l) => /^\s*powershell/i.test(l));
    assert.ok(commands.length >= 2);
    // the only interpolation allowed is the quoted %~dp0 in the -File form; the elevation form uses an env var
    for (const l of commands.filter((l) => /-Command/.test(l)))
      assert.doesNotMatch(l, /%/);
    assert.doesNotMatch(t, /token/i);
  });
}

test('the token is never a script parameter, a command-line argument or a log line', () => {
  for (const f of scripts) {
    const code = read(f)
      .replace(/<#[\s\S]*?#>/g, '')
      .replace(/^\s*#.*$/gm, '');
    assert.doesNotMatch(code, /--token\b/i, f);
    assert.doesNotMatch(code, /Write-Host[^\n]*\$(plain|newToken|token)\b/i, f);
    assert.doesNotMatch(
      code,
      /(Info|Ok|Warn|Fail)\s+["'][^\n]*\$(plain|newToken|token|c\.Token|s\.Token)\b/i,
      f
    );
  }
  // the entry points take no token parameter at all
  for (const f of ['install.ps1', 'update-config.ps1', 'uninstall.ps1']) {
    const params =
      /\[CmdletBinding\(\)\]\s*param\(([\s\S]*?)\n\)/.exec(read(f))?.[1] ?? '';
    assert.doesNotMatch(
      params,
      /\[(string|securestring|object)\]\s*\$\w*token/i,
      f
    ); // a switch like -ReplaceToken is fine
  }
  // it arrives by hidden prompt or an environment variable that is removed again
  assert.match(read('install.ps1'), /-AsSecureString/);
  assert.match(
    read('install.ps1'),
    /Remove-Item Env:\\KESHERIO_CONNECTOR_TOKEN/
  );
});

test('no dynamic code execution or shell-outs in the PowerShell scripts', () => {
  for (const f of scripts.filter((f) => f !== 'run-tests.ps1')) {
    const code = read(f)
      .replace(/<#[\s\S]*?#>/g, '')
      .replace(/^\s*#.*$/gm, '');
    assert.doesNotMatch(
      code,
      /Invoke-Expression|\biex\b|cmd(\.exe)?\s+\/c|Start-Process|\[scriptblock\]::Create/i,
      f
    );
  }
});

test('install.ps1 validates every input before it changes anything', () => {
  const t = read('install.ps1');
  const firstChange = t.indexOf("Step 'Copying program files'");
  for (const check of [
    'Test-ServiceName $Name',
    'Test-AnalyzerName $AnalyzerName',
    'Test-ListenIp $ListenIp',
    'Test-Port $ListenPort',
    'Test-AnalyzerIp $AnalyzerIp',
    'ConvertTo-ApiUrl',
  ]) {
    const i = t.indexOf(check);
    assert.ok(
      i > -1 && i < firstChange,
      `${check} must run before the first change`
    );
  }
  assert.ok(t.indexOf('Test-PackageIntegrity') < firstChange);
});

test('the firewall rule is limited to the analyzer IP and verified afterwards', () => {
  const t = read('install.ps1');
  assert.match(t, /New-NetFirewallRule[\s\S]*?-RemoteAddress \$AnalyzerIp/);
  assert.match(t, /Get-NetFirewallAddressFilter[\s\S]*?-ne \$AnalyzerIp/);
  assert.doesNotMatch(t, /RemoteAddress\s+(Any|'?\*|0\.0\.0\.0)/i);
});

test('an unreachable API address warns but does not abort; a refused new token is not saved', () => {
  const i = read('install.ps1');
  const h = i.slice(
    i.indexOf('$health = Test-ApiHealth'),
    i.indexOf("Step 'Copying program files'")
  );
  assert.match(h, /The installation continues/);
  assert.doesNotMatch(h, /\bFail\b/);
  const u = read('update-config.ps1');
  assert.match(u, /NOT saved\. The old token is still in place/);
  assert.ok(
    u.indexOf('Test-ApiToken') < u.indexOf('Write-ConnectorConfig'),
    'check before saving'
  );
});

test('the token is only sent to an address that first answered the public health check', () => {
  for (const f of ['install.ps1', 'update-config.ps1']) {
    const t = read(f);
    const send = t.indexOf('Test-ApiToken ');
    assert.ok(
      send > -1 && t.lastIndexOf('Test-ApiHealth', send) > -1,
      `${f}: health check must come before the token is sent`
    );
  }
});

test('the installer never deletes data (messages, config, logs)', () => {
  for (const f of ['install.ps1', 'uninstall.ps1', 'update-config.ps1']) {
    const code = read(f)
      .replace(/<#[\s\S]*?#>/g, '')
      .replace(/^\s*#.*$/gm, '');
    for (const l of code.split('\n').filter((l) => /Remove-Item/.test(l)))
      assert.doesNotMatch(
        l,
        /\$dataDir|ProgramData|connector\.json|\\logs|inbox/i,
        `${f}: ${l.trim()}`
      );
  }
});

test('the package script ships the wrapper, the updater and a checksum list', () => {
  const t = read('build-package.sh');
  for (const f of [
    'install.ps1',
    'common.ps1',
    'update-config.ps1',
    'install.bat',
    'update-config.bat',
    'uninstall.ps1',
    'status.bat',
  ])
    assert.match(t, new RegExp(f.replace('.', '\\.')));
  assert.match(t, /SHA256SUMS\.txt/);
});

test('every script parses', needPwsh, () => {
  for (const f of scripts) {
    const r = run(
      [
        '-Command',
        `$e=$null;$t=$null;[void][System.Management.Automation.Language.Parser]::ParseFile($env:KIO_FILE,[ref]$t,[ref]$e); if($e){ $e | ForEach-Object { Write-Output $_.Message }; exit 1 }`,
      ],
      { KIO_FILE: join(here, f) }
    );
    assert.equal(r.status, 0, `${f}: ${r.stdout}${r.stderr}`);
  }
});

test('common.ps1 behaves: run-tests.ps1 passes', needPwsh, () => {
  const r = run(['-File', join(here, 'run-tests.ps1')]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /\d+ passed, 0 failed/);
});

test(
  'connector.json written or repaired by the installer is plain UTF-8 that Node parses',
  needPwsh,
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'kio-cfg-'));
    const file = join(dir, 'connector.json');
    const token = 'kvc_0123abcd_' + 'A'.repeat(43);
    const ps = (cmd) =>
      run(['-Command', `. ./common.ps1; ${cmd}`], {
        KIO_FILE: file,
        KIO_TOKEN: token,
      });
    // a hand-edited file with a BOM: Node cannot parse it
    const body = JSON.stringify({ apiUrl: 'https://old.example.com', token });
    writeFileSync(
      file,
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(body)])
    );
    assert.throws(() => JSON.parse(readFileSync(file, 'utf8')));
    // update only the address
    let r = ps(
      `if (-not (Set-ConfigApiUrl $env:KIO_FILE 'https://new.example.com')) { exit 3 }`
    );
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const bytes = readFileSync(file);
    assert.notDeepEqual(
      [...bytes.subarray(0, 3)],
      [0xef, 0xbb, 0xbf],
      'no BOM'
    );
    assert.deepEqual(JSON.parse(bytes.toString('utf8')), {
      apiUrl: 'https://new.example.com',
      token,
    });
    // the receiver's own loader accepts it too
    r = ps(
      `Write-ConnectorConfig $env:KIO_FILE 'https://again.example.com/' $env:KIO_TOKEN`
    );
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {
      apiUrl: 'https://again.example.com',
      token,
    });
  }
);
