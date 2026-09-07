import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { CodexAdapter, codexAuthStatus } from '../src/adapters/codex.js';
import { GeminiAdapter } from '../src/adapters/gemini.js';
import { AgentEvent, type ParseContext } from '../src/protocol/events.js';
import type { ProbeResult } from '../src/process/exec.js';

const parseFixture = (adapter: CodexAdapter | GeminiAdapter, file: string) => {
  const context: ParseContext = {};
  const events = readFileSync(new URL(`../fixtures/${file}`, import.meta.url), 'utf8')
    .split('\n').flatMap((line) => adapter.parseLine(line, context));
  for (const event of events) AgentEvent.parse(event);
  return { events, context };
};
const parse = (adapter: CodexAdapter | GeminiAdapter, records: unknown[]) => {
  const context: ParseContext = {};
  return records.flatMap((record) => adapter.parseLine(JSON.stringify(record), context));
};

describe('M2a captured/reference streams', () => {
  it('normalizes the captured Codex read, pairing calls and retaining both messages', () => {
    const { events, context } = parseFixture(new CodexAdapter(), 'codex.read.jsonl');
    expect(context.sessionId).toBe('00000000-0000-4000-8000-000000000001');
    expect(events.filter((event) => event.kind === 'tool.call')).toHaveLength(1);
    expect(events).toContainEqual(expect.objectContaining({ kind: 'tool.result', callId: 'item_1', ok: true }));
    expect(events.filter((event) => event.kind === 'message.final')).toHaveLength(2);
    expect(events).toContainEqual({ kind: 'message.final', text: 'M2A_READ_OK' });
    expect(events).toContainEqual({ kind: 'usage', inputTokens: 35243, outputTokens: 343, cacheReadTokens: 21504, thinkingTokens: 242 });
    expect(events.at(-1)).toMatchObject({ kind: 'session.finished', status: 'success' });
  });
  it('does not turn the captured unsupported-model failure into success', () => {
    const { events } = parseFixture(new CodexAdapter(), 'codex.failed.jsonl');
    expect(events.at(-1)).toMatchObject({ kind: 'session.finished', status: 'error' });
    expect(events.filter((event) => event.kind === 'usage')).toHaveLength(0);
  });
  it('normalizes the Gemini source-derived reference without double-counting model totals', () => {
    const { events, context } = parseFixture(new GeminiAdapter(), 'gemini.reference.jsonl');
    expect(context.sessionId).toBe('00000000-0000-4000-8000-000000000003');
    expect(events.filter((event) => event.kind === 'message.delta').map((event) => event.text).join('')).toBe('M2A_READ_OK');
    expect(events.filter((event) => event.kind === 'usage')).toEqual([{ kind: 'usage', inputTokens: 32, outputTokens: 10, cacheReadTokens: 12 }]);
    expect(events.at(-1)).toEqual({ kind: 'session.finished', status: 'success', durationMs: 800 });
  });
});

describe('M2a error and stream boundaries', () => {
  for (const adapter of [new CodexAdapter(), new GeminiAdapter()]) {
    it(`${adapter.provider}: preserves malformed/unknown events without throwing`, () => {
      for (const line of ['{', 'not-json', '[]', '{"type":"new_event"}', '{"type":"item.completed","item":null}']) {
        const events = adapter.parseLine(line, {});
        expect(events[0]?.kind).toBe('unknown');
        for (const event of events) expect(() => AgentEvent.parse(event)).not.toThrow();
      }
      expect(adapter.parseLine(' ', {})).toEqual([]);
    });
    it(`${adapter.provider}: routes quota exhaustion to another provider`, () => {
      // 원래는 retryable:false로 두어 같은 provider 무한 재시도를 막았다.
      // M5에서 retryOn을 추가해 "재시도 가능"과 "어디에 재시도"를 분리했다.
      // 같은 곳에 다시 던지는 건 여전히 막히고(retryOn !== 'same-provider'),
      // 대신 Governor가 다른 벤더로 넘길 수 있게 됐다.
      const events = parse(adapter, [{ type: 'error', message: '429 quota exhausted', severity: 'error' }]);
      expect(events[0]).toMatchObject({
        kind: 'error',
        code: 'rate_limited',
        retryable: true,
        retryOn: 'other-provider',
      });
    });
    it(`${adapter.provider}: isolates state between simultaneous sessions`, () => {
      const first: ParseContext = {};
      const second: ParseContext = {};
      const end = JSON.stringify(adapter.provider === 'codex' ? { type: 'turn.completed' } : { type: 'result', status: 'success' });
      expect(adapter.parseLine(end, first).at(-1)?.kind).toBe('session.finished');
      expect(adapter.parseLine(end, first)).toEqual([]);
      expect(adapter.parseLine(end, second).at(-1)?.kind).toBe('session.finished');
    });
  }
  it('treats a Gemini fatal error followed by success as failure, but warning as non-fatal', () => {
    for (const severity of ['warning', 'error']) {
      const events = parse(new GeminiAdapter(), [{ type: 'error', severity, message: 'limit reached' }, { type: 'result', status: 'success' }]);
      expect(events.at(-1)).toMatchObject({ status: severity === 'warning' ? 'success' : 'error' });
    }
  });
  it('treats missing Gemini result status as failure', () => {
    expect(parse(new GeminiAdapter(), [{ type: 'result' }]).at(-1)).toMatchObject({ status: 'error' });
  });
  it('allows recovery after tool errors and deduplicates tool completion', () => {
    const result = { type: 'tool_result', tool_id: 'read', status: 'error', error: { message: 'not found' } };
    const events = parse(new GeminiAdapter(), [result, result, { type: 'result', status: 'success' }]);
    expect(events.filter((event) => event.kind === 'tool.result')).toHaveLength(1);
    expect(events[0]).toMatchObject({ ok: false });
    expect(events.at(-1)).toMatchObject({ status: 'success' });
  });
  it('maps applied file changes only, with failed shell exit codes preserved', () => {
    const events = parse(new CodexAdapter(), [
      { type: 'item.completed', item: { id: 'files', type: 'file_change', status: 'completed', changes: [{ path: 'new.ts', kind: 'add' }, { path: 'old.ts', kind: 'delete' }, { path: 'edit.ts', kind: 'update' }] } },
      { type: 'item.completed', item: { id: 'failed', type: 'file_change', status: 'failed', changes: [{ path: 'never.ts', kind: 'add' }] } },
      { type: 'item.completed', item: { id: 'command', type: 'command_execution', status: 'completed', exit_code: 1 } },
    ]);
    expect(events.filter((event) => event.kind === 'file.changed')).toEqual([
      { kind: 'file.changed', path: 'new.ts', op: 'create' }, { kind: 'file.changed', path: 'old.ts', op: 'delete' }, { kind: 'file.changed', path: 'edit.ts', op: 'modify' },
    ]);
    expect(events.at(-1)).toMatchObject({ kind: 'tool.result', ok: false });
  });
});

describe('M2a CLI and authentication contracts', () => {
  const request = { prompt: 'first\nsecond', cwd: '.', mode: 'plan' as const, model: 'selected-model', resumeId: 'session-id' };
  it('preserves Codex model, sandbox and stdin marker on resume', () => {
    expect(new CodexAdapter().buildArgv(request).args).toEqual([
      'exec', '--json', '--sandbox', 'read-only', '-c', 'approval_policy="never"', '--model', 'selected-model', 'resume', 'session-id', '-',
    ]);
    const args = new CodexAdapter().buildArgv({ ...request, mode: 'write', autoApprove: true }).args;
    expect(args).toContain('workspace-write');
    expect(args.join(' ')).not.toContain('dangerously');
  });
  it('resumes Gemini with --resume and uses exactly one approval mode', () => {
    const args = new GeminiAdapter().buildArgv({ ...request, mode: 'write', autoApprove: true }).args;
    expect(args).toContain('--resume');
    expect(args).not.toContain('--session-id');
    expect(args).not.toContain('--yolo');
    expect(args[args.indexOf('--approval-mode') + 1]).toBe('yolo');
    expect(new GeminiAdapter().buildArgv({ ...request, autoApprove: true }).args).toContain('plan');
  });
  const probe = (text: string, ok = true): ProbeResult => ({ ok, stdout: '', stderr: text, exitCode: ok ? 0 : 1, timedOut: false });
  it('reads Codex status from stderr, strips key material and keeps uncertainty', () => {
    expect(codexAuthStatus(probe('Logged in using ChatGPT')).authed).toBe(true);
    expect(codexAuthStatus(probe('Logged in using an API key - SECRET')).authSummary).toBe('API key');
    expect(JSON.stringify(codexAuthStatus(probe('Logged in using an API key - SECRET')))).not.toContain('SECRET');
    expect(codexAuthStatus(probe('Not logged in', false)).authed).toBe(false);
    expect(codexAuthStatus(probe('Permission denied', false)).authed).toBe('unknown');
    expect(codexAuthStatus({ ...probe('Logged in using ChatGPT'), timedOut: true }).authed).toBe('unknown');
  });
});
