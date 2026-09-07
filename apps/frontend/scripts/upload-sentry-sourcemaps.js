/**
 * Post-build script: uploads Angular source maps to Sentry, then deletes them
 * so they are never served to browsers.
 *
 * Required env vars (all set in Vercel project settings):
 *   SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT, VERCEL_GIT_COMMIT_SHA
 *
 * Skips silently when any var is missing — the build still succeeds without
 * source maps in Sentry.
 *
 * Usage: node apps/frontend/scripts/upload-sentry-sourcemaps.js
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const token = process.env.SENTRY_AUTH_TOKEN || '';
const org = process.env.SENTRY_ORG || '';
const project = process.env.SENTRY_PROJECT || '';
const release = process.env.VERCEL_GIT_COMMIT_SHA || '';

if (!token || !org || !project || !release) {
  console.log('[sentry] Skipping clinic source-map upload (missing env vars)');
  process.exit(0);
}

const distDir = path.resolve(__dirname, '..', '..', '..', 'dist', 'apps', 'frontend', 'browser');

if (!fs.existsSync(distDir)) {
  console.error(`[sentry] Build output not found at ${distDir}`);
  process.exit(1);
}

const env = { ...process.env, SENTRY_AUTH_TOKEN: token };
const run = (cmd) => {
  console.log(`[sentry] ${cmd}`);
  execSync(cmd, { stdio: 'inherit', env });
};

try {
  run(`npx sentry-cli releases new "${release}" --org "${org}" --project "${project}"`);
  run(`npx sentry-cli releases files "${release}" upload-sourcemaps "${distDir}" --org "${org}" --project "${project}"`);
  run(`npx sentry-cli releases finalize "${release}" --org "${org}" --project "${project}"`);
} catch (err) {
  console.error('[sentry] Source-map upload failed — build continues without mapped stacks');
  console.error(err.message);
}

// Delete .map files so they're never served
const mapFiles = fs.readdirSync(distDir, { recursive: true })
  .filter((f) => f.toString().endsWith('.map'))
  .map((f) => path.join(distDir, f.toString()));

for (const f of mapFiles) {
  fs.unlinkSync(f);
}

console.log(`[sentry] Deleted ${mapFiles.length} source-map file(s) from build output`);
