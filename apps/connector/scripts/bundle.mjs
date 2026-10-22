// Bundles the receiver + replay tool into single, dependency-free .cjs files
// (Node >= 18 only, no node_modules) and copies the Windows launchers next to them.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const out = 'dist';
mkdirSync(out, { recursive: true });
for (const [entry, name] of [
  ['src/cli.ts', 'vh30-receiver.cjs'],
  ['src/replay.ts', 'vh30-replay.cjs'],
  // dev tooling only — NOT copied into the Windows package (see packaging notes in README)
  ['src/ingest-proxy-cli.ts', 'dev-ingest-proxy.cjs'],
]) {
  await build({
    entryPoints: [entry],
    outfile: join(out, name),
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    logLevel: 'info',
  });
}
for (const file of readdirSync('windows'))
  copyFileSync(join('windows', file), join(out, file));
