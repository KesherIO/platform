/**
 * Region move: copies every Storage file from one Supabase project to another
 * (docs/REGION_MIGRATION_PLAN.md, step 4).
 *
 * Run it AFTER the database restore (step 3). The restore already brings the
 * bucket list and each file's metadata row (storage.buckets / storage.objects)
 * but not the file contents, so the new project lists files it doesn't have
 * yet. That's why this script always uploads with upsert and never skips a
 * file because it "already exists" in the target.
 *
 * Source is only read. Target must not be the project the production clinic
 * app points to (environment.production.ts) — i.e. run this before step 5.
 *
 * Prints counts only, plus the path of any file that fails.
 *
 * Environment (not read from .env, so dev values can't be picked up by mistake):
 *   SOURCE_SUPABASE_URL, SOURCE_SERVICE_ROLE_KEY   — old project (Ireland)
 *   TARGET_SUPABASE_URL, TARGET_SERVICE_ROLE_KEY   — new project (us-east-1)
 *
 * Run from the repo root (Node 22+):
 *   node apps/api/prisma/seeds/copy-storage.mjs             # dry run: what would be copied
 *   node apps/api/prisma/seeds/copy-storage.mjs --confirm   # copy
 *
 * Optional: --bucket=<name> copies one bucket only. A dry run without the
 * TARGET_* variables only lists the source.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');

/** Buckets the API uses — same list as bootstrap-dev-project.mjs. */
const BUCKETS = [
  'clinic-logos',
  'vet-credentials',
  'lab-reports',
  'release-assets',
];
const PAGE_SIZE = 1000;
const PARALLEL_UPLOADS = 4;

const arg = (name) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const CONFIRM = process.argv.includes('--confirm');
const ONLY_BUCKET = arg('bucket');

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

const refOf = (url) =>
  url.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co/)?.[1] ?? null;

// ── Configuration and guards ────────────────────────────────────────────────
const {
  SOURCE_SUPABASE_URL = '',
  SOURCE_SERVICE_ROLE_KEY = '',
  TARGET_SUPABASE_URL = '',
  TARGET_SERVICE_ROLE_KEY = '',
} = process.env;

if (!SOURCE_SUPABASE_URL || !SOURCE_SERVICE_ROLE_KEY) {
  fail('Set SOURCE_SUPABASE_URL and SOURCE_SERVICE_ROLE_KEY.');
}
const hasTarget = !!(TARGET_SUPABASE_URL && TARGET_SERVICE_ROLE_KEY);
if (CONFIRM && !hasTarget) {
  fail('Set TARGET_SUPABASE_URL and TARGET_SERVICE_ROLE_KEY to copy.');
}

const sourceRef = refOf(SOURCE_SUPABASE_URL);
const targetRef = hasTarget ? refOf(TARGET_SUPABASE_URL) : null;
if (!sourceRef)
  fail('Could not read the project ref from SOURCE_SUPABASE_URL.');
if (hasTarget && !targetRef) {
  fail('Could not read the project ref from TARGET_SUPABASE_URL.');
}
if (hasTarget && sourceRef === targetRef) {
  fail('Source and target are the same project.');
}

const prodEnv = readFileSync(
  join(repoRoot, 'apps/frontend/src/environments/environment.production.ts'),
  'utf8'
);
const liveRef = refOf(prodEnv.match(/supabaseUrl:\s*'([^']+)'/)?.[1] ?? '');
if (!liveRef)
  fail('Could not read the project ref from environment.production.ts.');
if (targetRef === liveRef) {
  fail(
    `Refusing to write to ${targetRef}: it's the project the live clinic app ` +
      'points to (environment.production.ts). Run this before switching the apps.'
  );
}

const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false },
};
const source = createClient(
  SOURCE_SUPABASE_URL,
  SOURCE_SERVICE_ROLE_KEY,
  clientOptions
);
const target = hasTarget
  ? createClient(TARGET_SUPABASE_URL, TARGET_SERVICE_ROLE_KEY, clientOptions)
  : null;

console.log(`Source: ${sourceRef}  (read only)`);
console.log(`Target: ${targetRef ?? '— (not set, listing the source only)'}`);
console.log(CONFIRM ? 'Mode: COPY' : 'Mode: dry run (nothing is written)');

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Every file in a bucket, walking folders. Folders come back with id null. */
async function listFiles(client, bucket, prefix = '') {
  const files = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client.storage
      .from(bucket)
      .list(prefix, {
        limit: PAGE_SIZE,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);

    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) {
        files.push(...(await listFiles(client, bucket, path)));
      } else if (entry.name !== '.emptyFolderPlaceholder') {
        files.push({
          path,
          size: entry.metadata?.size ?? 0,
          contentType: entry.metadata?.mimetype,
          cacheControl: entry.metadata?.cacheControl,
        });
      }
    }
    if (data.length < PAGE_SIZE) return files;
  }
}

/** Creates the bucket in the target if the restore didn't, with the same settings. */
async function ensureTargetBucket(bucket) {
  const { data: src, error: srcError } = await source.storage.getBucket(bucket);
  if (srcError) throw new Error(`source bucket ${bucket}: ${srcError.message}`);

  const { data: dst } = await target.storage.getBucket(bucket);
  if (dst) {
    if (dst.public !== src.public) {
      console.warn(
        `  ⚠ ${bucket} is ${dst.public ? 'public' : 'private'} in the target ` +
          `but ${
            src.public ? 'public' : 'private'
          } in the source — fix it in the dashboard.`
      );
    }
    return 'exists';
  }
  if (!CONFIRM) return 'missing (would be created)';

  const { error } = await target.storage.createBucket(bucket, {
    public: src.public,
    fileSizeLimit: src.file_size_limit ?? undefined,
    allowedMimeTypes: src.allowed_mime_types ?? undefined,
  });
  if (error) throw new Error(`create bucket ${bucket}: ${error.message}`);
  return 'created';
}

async function copyFile(bucket, file) {
  const { data: blob, error: downloadError } = await source.storage
    .from(bucket)
    .download(file.path);
  if (downloadError) throw new Error(`download: ${downloadError.message}`);

  const { error: uploadError } = await target.storage
    .from(bucket)
    .upload(file.path, blob, {
      upsert: true, // the restored metadata row already exists
      contentType: file.contentType || blob.type || undefined,
      cacheControl: file.cacheControl?.replace(/^max-age=/, '') ?? undefined,
    });
  if (uploadError) throw new Error(`upload: ${uploadError.message}`);
}

/** Runs fn over items, a few at a time. */
async function inBatches(items, size, fn) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const buckets = ONLY_BUCKET ? [ONLY_BUCKET] : BUCKETS;
  if (ONLY_BUCKET && !BUCKETS.includes(ONLY_BUCKET)) {
    console.warn(`  ⚠ ${ONLY_BUCKET} is not one of the API's buckets.`);
  }

  let totalFiles = 0;
  let totalBytes = 0;
  let totalFailed = 0;

  for (const bucket of buckets) {
    console.log(`\n${bucket}`);
    console.log('─'.repeat(50));

    const files = await listFiles(source, bucket);
    const bytes = files.reduce((sum, f) => sum + f.size, 0);
    totalFiles += files.length;
    totalBytes += bytes;
    console.log(`  Source: ${files.length} files, ${mb(bytes)}`);

    if (!target) continue;
    console.log(`  Target bucket: ${await ensureTargetBucket(bucket)}`);
    if (!CONFIRM) {
      console.log(`  Would copy: ${files.length} files`);
      continue;
    }

    let copied = 0;
    const failed = [];
    await inBatches(files, PARALLEL_UPLOADS, async (file) => {
      try {
        await copyFile(bucket, file);
        copied++;
      } catch (e) {
        failed.push(`${file.path} (${e.message})`);
      }
    });
    totalFailed += failed.length;

    // Re-list the target: every source path should be there with the same size.
    const copiedFiles = new Map(
      (await listFiles(target, bucket)).map((f) => [f.path, f.size])
    );
    const mismatched = files.filter(
      (f) => copiedFiles.get(f.path) !== f.size
    ).length;

    console.log(`  Copied: ${copied}`);
    console.log(`  Missing or different size in target: ${mismatched}`);
    for (const line of failed) console.log(`  ✖ ${line}`);
  }

  console.log('\n' + '═'.repeat(50));
  console.log(`Total: ${totalFiles} files, ${mb(totalBytes)}`);
  if (CONFIRM) {
    console.log(
      totalFailed === 0 ? 'All files copied ✔' : `Failed: ${totalFailed}`
    );
    if (totalFailed > 0) console.log('Re-running is safe: uploads overwrite.');
  } else if (target) {
    console.log('Re-run with --confirm to copy.');
  }
}

main().catch((e) => fail(e.message));
