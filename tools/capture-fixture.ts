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
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { getAdapter, isProvider } from '../src/adapters/registry.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    output: { type: 'string' },
    cwd: { type: 'string' },
    resume: { type: 'string' },
    model: { type: 'string' },
  },
});
const name = positionals[0];
const prompt = positionals[1] ?? 'Reply with exactly: PONG';

if (!name || !isProvider(name)) {
  console.error(`usage: capture-fixture <claude|antigravity|gemini|codex> [prompt]`);
  process.exit(2);
}

const adapter = getAdapter(name);
const cwd = resolve(values.cwd ?? process.cwd());
const { bin, args, env } = adapter.buildArgv({
  prompt, mode: 'plan', cwd,
  ...(values.resume ? { resumeId: values.resume } : {}),
  ...(values.model ? { model: values.model } : {}),
});

console.log(`RUN  ${bin} ${args.join(' ')}\n`);

const started = Date.now();
const result = await execa(bin, args, {
  reject: false,
  shell: false,
  windowsHide: true,
  cwd,
  env,
  ...(adapter.capability.promptDelivery === 'stdin' ? { input: prompt } : { stdin: 'ignore' as const }),
  timeout: 180_000,
});

const elapsed = ((Date.now() - started) / 1000).toFixed(1);
console.log(`exit=${result.exitCode} timedOut=${result.timedOut} elapsed=${elapsed}s\n`);

const out = resolve(values.output ?? `.conductor/captures/${name}-${Date.now()}.jsonl`);
await mkdir(dirname(out), { recursive: true });
await writeFile(out, result.stdout ?? '', { encoding: 'utf8', flag: 'wx' });
await writeFile(`${out}.stderr`, result.stderr ?? '', { encoding: 'utf8', flag: 'wx' });
console.log(`\nwrote ${out}`);
process.exitCode = result.exitCode === 0 && !result.timedOut ? 0 : 1;
