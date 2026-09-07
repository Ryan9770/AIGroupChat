/**
 * 어댑터의 buildArgv()가 만든 커맨드를 실제로 실행해 원시 출력을 fixtures/에 덤프한다.
 *
 *   pnpm tsx tools/capture-fixture.ts <provider> [prompt]
 *
 * 손으로 옮겨적은 argv가 아니라 **실제 어댑터 코드 경로**를 태우는 게 요점이다.
 * 여기서 모은 JSONL이 M2 정규화 골든 테스트의 입력이 된다.
 * 실제 구독 사용량을 소모하므로 프롬프트는 최소로 유지할 것.
 */
import { execa } from 'execa';
import { mkdir, writeFile } from 'node:fs/promises';
import { getAdapter, isProvider } from '../src/adapters/registry.ts';

const name = process.argv[2];
const prompt = process.argv[3] ?? 'Reply with exactly: PONG';

if (!name || !isProvider(name)) {
  console.error(`usage: capture-fixture <claude|antigravity|gemini|codex> [prompt]`);
  process.exit(2);
}

const adapter = getAdapter(name);
const { bin, args } = adapter.buildArgv({ prompt, mode: 'plan', cwd: process.cwd() });

console.log(`RUN  ${bin} ${args.join(' ')}\n`);

const started = Date.now();
const result = await execa(bin, args, {
  reject: false,
  shell: false,
  windowsHide: true,
  stdin: 'ignore', // claude의 3초 stdin 대기 방지
  timeout: 180_000,
});

const elapsed = ((Date.now() - started) / 1000).toFixed(1);
console.log(`exit=${result.exitCode} timedOut=${result.timedOut} elapsed=${elapsed}s\n`);

console.log('--- STDOUT (first 3000 chars) ---');
console.log((result.stdout ?? '').slice(0, 3000));

if (result.stderr) {
  console.log('\n--- STDERR (first 1500 chars) ---');
  console.log(result.stderr.slice(0, 1500));
}

await mkdir('fixtures', { recursive: true });
const out = `fixtures/${name}.smoke.jsonl`;
await writeFile(out, result.stdout ?? '', 'utf8');
console.log(`\nwrote ${out}`);
