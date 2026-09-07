import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CodexAdapter } from '../src/adapters/codex.js';
import { GeminiAdapter } from '../src/adapters/gemini.js';
import type { AgentAdapter } from '../src/adapters/types.js';
import { runAgent } from '../src/process/manager.js';

const fake = (scenario: string, provider: 'codex' | 'gemini' = 'codex', fixture?: string): AgentAdapter => {
  const adapter = provider === 'codex' ? new CodexAdapter() : new GeminiAdapter();
  return {
    provider, bin: process.execPath, capability: adapter.capability,
    preflight: adapter.preflight.bind(adapter), parseLine: adapter.parseLine.bind(adapter),
    buildArgv: () => ({ bin: process.execPath, args: [fileURLToPath(new URL('../tools/fake-agent.mjs', import.meta.url)), scenario, ...(fixture ? [fileURLToPath(new URL(`../fixtures/${fixture}`, import.meta.url))] : [])], env: {} }),
  };
};
const request = { prompt: '한국어 첫 줄\nSecond line & "quotes"\n마지막 줄', cwd: process.cwd(), mode: 'plan' as const };
const collect = async (scenario: string, timeoutMs = 5000) => Array.fromAsync(runAgent(fake(scenario), request, { timeoutMs }));

describe('real fake-worker process integration, no AI calls', () => {
  it('delivers multiline stdin fully and closes it', async () => {
    const events = await collect('stdin');
    expect(events).toContainEqual({ kind: 'message.final', text: request.prompt });
    expect(events.at(-1)).toMatchObject({ kind: 'session.finished', status: 'success' });
  });
  it('process exit failure overrides a success event and emits one finish', async () => {
    const events = await collect('late-exit');
    expect(events.at(-1)).toMatchObject({ kind: 'session.finished', status: 'error' });
    expect(events.filter((event) => event.kind === 'session.finished')).toHaveLength(1);
    expect(events).toContainEqual(expect.objectContaining({ kind: 'error', code: 'exit_7' }));
  });
  it('timeout after a success report is still failure', async () => {
    const events = await collect('late-timeout', 1000);
    expect(events.at(-1)).toMatchObject({ status: 'error' });
    expect(events).toContainEqual(expect.objectContaining({ code: 'timeout' }));
  });
  it('exit zero without a terminal result is failure', async () => {
    const events = await collect('no-terminal');
    expect(events).toContainEqual(expect.objectContaining({ code: 'missing_terminal' }));
    expect(events.at(-1)).toMatchObject({ status: 'error' });
  });
  it('waits for process exit after stdout closes', async () => {
    expect((await collect('close-output')).at(-1)).toMatchObject({ status: 'success' });
  });
  it('cancellation wins over an earlier success event', async () => {
    const controller = new AbortController();
    const events = await Array.fromAsync(runAgent(fake('late-timeout'), request, {
      signal: controller.signal,
      onRawLine: () => controller.abort(),
    }));
    expect(events.at(-1)).toMatchObject({ status: 'cancelled' });
  });
  it.each([
    ['codex', 'codex.read.jsonl'], ['gemini', 'gemini.reference.jsonl'],
  ] as const)('replays the %s fixture through spawn and normalization', async (provider, fixture) => {
    const events = await Array.fromAsync(runAgent(fake('fixture', provider, fixture), request));
    expect(events.at(-1)).toMatchObject({ kind: 'session.finished', status: 'success' });
    expect(events.filter((event) => event.kind === 'usage')).toHaveLength(1);
    expect(events.filter((event) => event.kind === 'tool.result')).toHaveLength(1);
  });
});
