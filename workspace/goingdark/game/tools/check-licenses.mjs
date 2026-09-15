// ============================================================================
// 에셋 라이선스 감사 도구 (tools/check-licenses.mjs)
// 14_antigravity_production_brief.md P6-05 & §7.1 준수:
// public/assets/ 내의 모든 에셋 파일이 public/assets/LICENSES.md에
// 누락 없이 등록되어 있는지 검증한다 (미등록 파일 0개 보장).
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_ASSETS_DIR = path.resolve(__dirname, '../public/assets');
const LICENSES_FILE = path.join(PUBLIC_ASSETS_DIR, 'LICENSES.md');

if (!fs.existsSync(LICENSES_FILE)) {
  console.error(`[ERROR] LICENSES.md not found at ${LICENSES_FILE}`);
  process.exit(1);
}

const licensesContent = fs.readFileSync(LICENSES_FILE, 'utf-8');

function getAssetFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const res = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAssetFiles(res));
    } else {
      files.push(res);
    }
  }
  return files;
}

const allAssetFiles = getAssetFiles(PUBLIC_ASSETS_DIR);
const unverifiedFiles = [];
let checkedCount = 0;

for (const file of allAssetFiles) {
  const relPath = path.relative(PUBLIC_ASSETS_DIR, file).replace(/\\/g, '/');
  const basename = path.basename(file);

  // Skip license and manifest metadata documents themselves
  if (basename === 'LICENSES.md' || basename === 'manifest.json') {
    continue;
  }

  checkedCount++;

  // Check if filename or relative path is mentioned in LICENSES.md
  const isMentioned = licensesContent.includes(basename) || licensesContent.includes(relPath);

  if (!isMentioned) {
    unverifiedFiles.push(relPath);
  }
}

console.log(`[check-licenses] Auditing ${checkedCount} files in public/assets/ against LICENSES.md...`);

if (unverifiedFiles.length > 0) {
  console.error(`❌ Found ${unverifiedFiles.length} unregistered asset file(s) in public/assets/:`);
  for (const f of unverifiedFiles) {
    console.error(`  - ${f}`);
  }
  console.error('All assets must be registered with provenance, author, and license in LICENSES.md.');
  process.exit(1);
} else {
  console.log(`✓ All ${checkedCount} asset files in public/assets/ are verified and registered in LICENSES.md.`);
  process.exit(0);
}
