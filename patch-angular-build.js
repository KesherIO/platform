const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ESM_PACKAGES = [
  'vite',
  '@angular/compiler-cli',
  '@angular/compiler',
  '@angular/compiler-cli/private/tooling',
  '@angular/compiler-cli/linker/babel',
  'vitest/config',
  'vitest/node',
  '@vitejs/plugin-basic-ssl',
  'undici',
  '@angular/localize/tools',
];

const BASE = path.join(process.cwd(), 'node_modules', '@angular', 'build', 'src');

if (!fs.existsSync(BASE)) {
  console.log(`[patch-angular-build] Skipping: ${BASE} not found`);
  process.exit(0);
}

let files = [];
try {
  const result = execSync(
    `grep -rl "Promise.resolve().then.*__importStar(require(" "${BASE}" --include="*.js"`,
    { encoding: 'utf8' }
  );
  files = result.trim().split('\n').filter(Boolean);
} catch {
  console.log('[patch-angular-build] No matching files found, skipping');
  process.exit(0);
}

let patchedFiles = 0;

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  const original = content;

  for (const pkg of ESM_PACKAGES) {
    const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const quoted = `'${pkg}'`;

    content = content.replace(
      new RegExp(
        `await Promise\\.resolve\\(\\)\\.then\\(\\(\\) => __importStar\\(require\\('${escaped}'\\)\\)\\)`,
        'g'
      ),
      `await import(${quoted})`
    );

    content = content.replace(
      new RegExp(
        `Promise\\.resolve\\(\\)\\.then\\(\\(\\) => __importStar\\(require\\('${escaped}'\\)\\)\\)`,
        'g'
      ),
      `import(${quoted})`
    );
  }

  if (content !== original) {
    fs.writeFileSync(file, content, 'utf8');
    console.log('Patched:', path.relative(BASE, file));
    patchedFiles++;
  }
}

console.log(`\nTotal files patched: ${patchedFiles}`);