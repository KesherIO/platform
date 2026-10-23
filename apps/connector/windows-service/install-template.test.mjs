// Run: node --test apps/connector/windows-service/install-template.test.mjs
// Renders the WinSW template the way install.ps1 does and checks it. (PowerShell itself cannot run in CI here, so
// the substitution is mirrored in JS and install.ps1 is checked statically for the things that broke or could break.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const template = readFileSync(
  join(here, 'KesherIOConnector.xml.template'),
  'utf8'
);
const ps1 = readFileSync(join(here, 'install.ps1'), 'utf8');

const xmlEsc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
// the same keys install.ps1 puts in $map
const mapBlock = /\$map = @\{([\s\S]*?)\n\}/.exec(ps1)?.[1] ?? '';
const psKeys = [...mapBlock.matchAll(/\b([A-Z][A-Z_]+)\s*=/g)].map((m) => m[1]);
const values = {
  SERVICE_ID: 'KesherIOConnector-test',
  SERVICE_NAME: 'KesherIO Connector \u2013 VH-30 Test (test)',
  ANALYZER_NAME: 'VH-30 Test',
  NODE_EXE: 'C:\\Program Files\\KesherIO\\Connector\\app\\node.exe',
  RECEIVER_CJS:
    'C:\\Program Files\\KesherIO\\Connector\\app\\vh30-receiver.cjs',
  DATA_DIR: 'C:\\ProgramData\\KesherIO\\Connector\\test',
  LISTEN_IP: '127.0.0.1',
  LISTEN_PORT: '8011',
  ANALYZER_IP: '127.0.0.1',
};
const render = (vals) =>
  Object.entries(vals).reduce(
    (x, [k, v]) => x.split(`{{${k}}}`).join(xmlEsc(v)),
    template
  );

test('every placeholder in the template is supplied by install.ps1, and vice versa', () => {
  const inTemplate = [
    ...new Set([...template.matchAll(/\{\{([A-Z_]+)\}\}/g)].map((m) => m[1])),
  ].sort();
  assert.deepEqual([...new Set(psKeys)].sort(), inTemplate);
  assert.deepEqual(Object.keys(values).sort(), inTemplate);
});

test('no brace marker is left anywhere after rendering - comments included (the 2026-10-22 failure)', () => {
  const out = render(values);
  assert.doesNotMatch(out, /\{\{|\}\}/);
  // and the raw template contains nothing that merely looks like a marker, outside the real ones
  assert.doesNotMatch(template.replace(/\{\{[A-Z_]+\}\}/g, ''), /\{\{|\}\}/);
});

test('install.ps1 only flags real, complete markers as unfilled', () => {
  assert.match(ps1, /\\\{\\\{\[A-Z_\]\+\\\}\\\}/);
  assert.doesNotMatch(ps1, /-match '\\\{\\\{'/);
});

test('rendered XML is well-formed and has the expected values', () => {
  const out = render(values);
  const dir = mkdtempSync(join(tmpdir(), 'svcxml-'));
  const file = join(dir, 'svc.xml');
  writeFileSync(file, out);
  const lint = spawnSync('xmllint', ['--noout', file], { encoding: 'utf8' });
  if (lint.error) {
    // no xmllint: at least require a single root and balanced tags
    assert.match(out, /<service>[\s\S]*<\/service>\s*$/);
  } else assert.equal(lint.status, 0, lint.stderr);
  assert.match(out, /<id>KesherIOConnector-test<\/id>/);
  assert.match(out, /name="VH30_PORT" value="8011"/);
  assert.match(out, /name="VH30_ACK" value="off"/);
  assert.match(
    out,
    /<logpath>C:\\ProgramData\\KesherIO\\Connector\\test\\logs<\/logpath>/
  );
});

test('values with XML-special characters are escaped, not injected', () => {
  const out = render({ ...values, ANALYZER_NAME: 'A&B <x> "q"' });
  assert.match(out, /A&amp;B &lt;x&gt; &quot;q&quot;/);
});

test('the service runs as LocalService using WinSW 2.x element names', () => {
  assert.match(
    template,
    /<domain>NT AUTHORITY<\/domain>\s*<user>LocalService<\/user>/
  );
  assert.doesNotMatch(template.replace(/<!--[\s\S]*?-->/g, ''), /<username>/); // a 3.x name; 2.x ignores it -> LocalSystem
});

test('no secret in the template and the token is never an argument', () => {
  assert.doesNotMatch(template, /kvc_|VH30_API_TOKEN|--token/);
  assert.doesNotMatch(
    ps1.replace(/^\s*#.*$/gm, '').replace(/<#[\s\S]*?#>/, ''),
    /--token/
  );
});

test('PowerShell 5.1 hygiene: scripts are pure ASCII (BOM-less files are read as ANSI)', () => {
  for (const f of ['install.ps1', 'uninstall.ps1'])
    assert.doesNotMatch(readFileSync(join(here, f), 'utf8'), /[^\x00-\x7F]/, f);
});
