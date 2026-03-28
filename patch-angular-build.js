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

const BASE = '/Users/karina.martinez/WebstormProjects/vet-ai/node_modules/@angular/build/src';

const files = execSync(`grep -rl "Promise.resolve().then.*__importStar(require(" ${BASE} --include="*.js"`)
  .toString().trim().split('\n').filter(Boolean);

let patchedFiles = 0;

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  const original = content;

  for (const pkg of ESM_PACKAGES) {
    const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const quoted = `'${pkg}'`;

    // Pattern with await prefix
    content = content.replace(
      new RegExp(`await Promise\\.resolve\\(\\)\\.then\\(\\(\\) => __importStar\\(require\\('${escaped}'\\)\\)\\)`, 'g'),
      `await import(${quoted})`
    );

    // Pattern without await (used as a Promise in larger expressions)
    content = content.replace(
      new RegExp(`Promise\\.resolve\\(\\)\\.then\\(\\(\\) => __importStar\\(require\\('${escaped}'\\)\\)\\)`, 'g'),
      `import(${quoted})`
    );
  }

  if (content !== original) {
    fs.writeFileSync(file, content);
    console.log('Patched:', path.relative(BASE, file));
    patchedFiles++;
  }
}

console.log(`\nTotal files patched: ${patchedFiles}`);