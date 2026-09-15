/**
 * tsc는 .html을 복사하지 않는다. 빌드 후 웹 UI 자산을 dist로 옮긴다.
 */
import { copyFile, cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const from = join(root, 'src', 'ui', 'web');
const to = join(root, 'dist', 'ui', 'web');

await mkdir(dirname(to), { recursive: true });
await cp(from, to, { recursive: true });
console.log(`copied ${from} -> ${to}`);

const workerShimFrom = join(root, 'src', 'orchestration', 'worker-shim.cjs');
const workerShimTo = join(root, 'dist', 'orchestration', 'worker-shim.cjs');
await mkdir(dirname(workerShimTo), { recursive: true });
await copyFile(workerShimFrom, workerShimTo);
console.log(`copied ${workerShimFrom} -> ${workerShimTo}`);
