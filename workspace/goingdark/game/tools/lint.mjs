// ============================================================================
// 프로젝트 통합 린터 (tools/lint.mjs)
// 14_antigravity_production_brief.md P6-01 & D-14 준수
// 1. node --check 문법 검사
// 2. ESLint (flat config) 정적 분석 및 미사용 import 검사
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ESLint } from 'eslint';

function getFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const res = path.resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getFiles(res));
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) {
      files.push(res);
    }
  }
  return files;
}

const targetDirs = ['src', 'tools', 'test'];
let syntaxErrors = 0;
let totalCheckedFiles = 0;

console.log('[1/2] Running syntax check (node --check)...');
for (const dirName of targetDirs) {
  const dirPath = path.resolve(dirName);
  if (!fs.existsSync(dirPath)) continue;
  const files = getFiles(dirPath);
  for (const file of files) {
    totalCheckedFiles++;
    const result = spawnSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    if (result.status !== 0) {
      console.error(`Syntax error in ${file}:\n${result.stderr.toString()}`);
      syntaxErrors++;
    }
  }
}

if (syntaxErrors > 0) {
  console.error(`❌ Syntax check failed with ${syntaxErrors} errors.`);
  process.exit(1);
} else {
  console.log(`✓ All ${totalCheckedFiles} JS/MJS files passed syntax check.`);
}

console.log('\n[2/2] Running ESLint static analysis...');
try {
  const eslint = new ESLint();
  const results = await eslint.lintFiles(['src/**/*.js', 'tools/**/*.mjs', 'test/**/*.js']);
  const formatter = await eslint.loadFormatter('stylish');
  const resultText = await formatter.format(results);

  if (resultText && resultText.trim().length > 0) {
    console.log(resultText);
  }

  const errorCount = results.reduce((sum, r) => sum + r.errorCount, 0);
  const warningCount = results.reduce((sum, r) => sum + r.warningCount, 0);

  if (errorCount > 0) {
    console.error(`❌ ESLint failed with ${errorCount} error(s) and ${warningCount} warning(s).`);
    process.exit(1);
  } else {
    console.log(`✓ ESLint passed with 0 errors (${warningCount} warning(s)).`);
  }
} catch (err) {
  console.error('Failed to run ESLint:', err);
  process.exit(1);
}

console.log('\n[3/3] Auditing public asset licenses...');
const licenseCheck = spawnSync(process.execPath, [path.resolve('tools/check-licenses.mjs')], { stdio: 'inherit' });
if (licenseCheck.status !== 0) {
  console.error('❌ License audit failed.');
  process.exit(1);
}

