const fs = require('fs');
const path = require('path');

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

function findJsFiles(dir) {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results = results.concat(findJsFiles(full));
    else if (entry.name.endsWith('.js')) results.push(full);
  }
  return results;
}

const PATTERN = /Promise\.resolve\(\)\.then\(.*__importStar\(require\(/;
const files = findJsFiles(BASE).filter(f => {
  try { return PATTERN.test(fs.readFileSync(f, 'utf8')); } catch { return false; }
});

if (files.length === 0) {
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