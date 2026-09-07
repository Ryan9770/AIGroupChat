/**
 * 워커 컨텍스트 격리 플래그의 실제 효과를 측정한다.
 *
 *   pnpm tsx tools/measure-isolation.ts
 *
 * M0 스모크 테스트에서 claude 워커 1회 호출에 캐시 생성 토큰 46,277개가 발생했다.
 * 워커가 프로젝트의 CLAUDE.md·MCP 서버·훅·스킬을 전부 상속하기 때문이다.
 * 어떤 플래그 조합이 실제로 이걸 줄이는지 추측하지 말고 재본다.
 *
 * 주의: --bare는 쓸 수 없다. OAuth/키체인을 절대 읽지 않아 구독 인증이 깨진다.
 */
import { execa } from 'execa';

const PROMPT = 'Reply with exactly: PONG';
const BASE = [
  '-p',
  '--output-format',
  'stream-json',
  '--verbose',
  '--permission-prompts',
  'none',
  '--permission-mode',
  'plan',
];

const VARIANTS: Array<{ name: string; extra: string[] }> = [
  { name: 'A baseline', extra: [] },
  { name: 'B +strict-mcp', extra: ['--strict-mcp-config'] },
  {
    name: 'C +strict-mcp +no-settings +no-skills',
    extra: ['--strict-mcp-config', '--setting-sources', '', '--disable-slash-commands'],
  },
];

interface Row {
  name: string;
  ok: boolean;
  cacheCreate: number;
  cacheRead: number;
  input: number;
  output: number;
  costUsd: number;
  ms: number;
  tools: number;
  note: string;
}

async function run(name: string, extra: string[]): Promise<Row> {
  const args = [...BASE, ...extra, PROMPT];
  const r = await execa('claude', args, {
    reject: false,
    shell: false,
    windowsHide: true,
    stdin: 'ignore',
    timeout: 180_000,
  });

  const empty: Row = {
    name,
    ok: false,
    cacheCreate: 0,
    cacheRead: 0,
    input: 0,
    output: 0,
    costUsd: 0,
    ms: 0,
    tools: 0,
    note: '',
  };

  if (r.exitCode !== 0) {
    return { ...empty, note: `exit=${r.exitCode} ${(r.stderr ?? '').slice(0, 120)}` };
  }

  let toolCount = 0;
  let result: Record<string, unknown> | undefined;

  for (const line of (r.stdout ?? '').split('\n')) {
    if (!line.trim()) continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (o['type'] === 'system' && o['subtype'] === 'init' && Array.isArray(o['tools'])) {
      toolCount = o['tools'].length;
    }
    if (o['type'] === 'result') result = o;
  }

  if (!result) return { ...empty, note: 'result 이벤트 없음' };

  const u = (result['usage'] ?? {}) as Record<string, number>;
  return {
    name,
    ok: result['is_error'] !== true,
    cacheCreate: u['cache_creation_input_tokens'] ?? 0,
    cacheRead: u['cache_read_input_tokens'] ?? 0,
    input: u['input_tokens'] ?? 0,
    output: u['output_tokens'] ?? 0,
    costUsd: (result['total_cost_usd'] as number) ?? 0,
    ms: (result['duration_ms'] as number) ?? 0,
    tools: toolCount,
    note: String(result['result'] ?? '').trim().slice(0, 20),
  };
}

const rows: Row[] = [];
for (const v of VARIANTS) {
  process.stdout.write(`running ${v.name} ...\n`);
  rows.push(await run(v.name, v.extra));
}

const pad = (s: string | number, w: number) => String(s).padStart(w);
console.log('\nVARIANT                              TOOLS  CACHE_CREATE  COST_USD    MS  RESULT');
console.log('-----------------------------------  -----  ------------  --------  ----  ------');
for (const r of rows) {
  console.log(
    `${r.name.padEnd(35)}  ${pad(r.tools, 5)}  ${pad(r.cacheCreate, 12)}  ${pad(
      r.costUsd.toFixed(4),
      8,
    )}  ${pad(r.ms, 4)}  ${r.note}`,
  );
}
