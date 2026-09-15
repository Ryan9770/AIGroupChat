import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const testDir = path.resolve('test');
const files = fs.readdirSync(testDir)
  .filter(f => f.endsWith('.test.js'))
  .map(f => path.join('test', f));

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
