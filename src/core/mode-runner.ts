import { allAdapters, getAdapter, isProvider } from '../adapters/registry.js';
import { runAgent } from '../process/manager.js';
import type { AgentEvent } from '../protocol/events.js';
import { BUILTIN_MODES, type ModeDefinition, type ModeParams } from '../protocol/mode.js';
import type { Provider, TaskRequest } from '../protocol/provider.js';

export interface ModeRunOptions {
  modeName: string;
  params: ModeParams;
  cwd: string;
  agent?: string | undefined;
  model?: string | undefined;
  timeoutMs?: number | undefined;
  isolate?: boolean | undefined;
  autoApprove?: boolean | undefined;
  signal?: AbortSignal | undefined;
  onEvent?: ((event: AgentEvent) => void) | undefined;
}

export interface ModeRunResult {
  mode: string;
  provider: Provider;
  status: 'success' | 'error' | 'cancelled';
  text: string;
  durationMs: number;
  usage?: Extract<AgentEvent, { kind: 'usage' }> | undefined;
  errors: Extract<AgentEvent, { kind: 'error' }>[];
}

export class ModeError extends Error {
  constructor(message: string, readonly hint?: string) {
    super(message);
    this.name = 'ModeError';
  }
}

/** 사용 가능한 provider 중 모드에 가장 적합한 provider를 결정한다. */
async function resolveProvider(
  mode: ModeDefinition,
  requestedAgent?: string,
): Promise<Provider> {
  if (requestedAgent) {
    if (!isProvider(requestedAgent)) {
      throw new ModeError(`알 수 없는 provider: ${requestedAgent}`);
    }
    return requestedAgent;
  }

  // 로그인/설치 검증된 어댑터 확인
  const adapters = allAdapters();
  const preflights = await Promise.all(adapters.map((a) => a.preflight(false)));
  const readySet = new Set(
    preflights.filter((p) => p.installed && p.authed === true).map((p) => p.provider),
  );

  if (readySet.has(mode.provider)) {
    return mode.provider;
  }

  // fallback 후보 탐색
  for (const fallback of mode.fallbacks) {
    if (readySet.has(fallback)) {
      return fallback;
    }
  }

  // fallback도 없으면 기본 provider로 시도
  return mode.provider;
}

export async function runMode(opts: ModeRunOptions): Promise<ModeRunResult> {
  const mode = BUILTIN_MODES[opts.modeName];
  if (!mode) {
    const available = Object.keys(BUILTIN_MODES).join(', ');
    throw new ModeError(
      `알 수 없는 모드입니다: ${opts.modeName}`,
      `사용 가능한 모드: ${available}`,
    );
  }

  const provider = await resolveProvider(mode, opts.agent);
  const adapter = getAdapter(provider);
  const prompt = mode.buildPrompt(opts.params);

  // antigravity는 headless에서 도구 실행을 위해 autoApprove(--dangerously-skip-permissions)가 필요하다
  const autoApprove = opts.autoApprove ?? (provider === 'antigravity' ? true : false);

  const req: TaskRequest = {
    prompt,
    mode: mode.mode,
    cwd: opts.cwd,
    isolate: opts.isolate ?? true,
    autoApprove,
    ...(opts.model ? { model: opts.model } : {}),
  };

  const startedAt = Date.now();
  let status: 'success' | 'error' | 'cancelled' = 'error';
  let finalText = '';
  let accumulatedDeltas = '';
  let usage: Extract<AgentEvent, { kind: 'usage' }> | undefined;
  const errors: Extract<AgentEvent, { kind: 'error' }>[] = [];

  const events = runAgent(adapter, req, {
    timeoutMs: opts.timeoutMs ?? 300_000,
    ...(opts.signal ? { signal: opts.signal } : {}),
  });

  for await (const event of events) {
    opts.onEvent?.(event);
    if (event.kind === 'message.delta') {
      accumulatedDeltas += event.text;
    } else if (event.kind === 'message.final') {
      finalText = event.text;
    } else if (event.kind === 'usage') {
      usage = event;
    } else if (event.kind === 'error') {
      errors.push(event);
    } else if (event.kind === 'session.finished') {
      status = event.status;
    }
  }

  const text = (finalText || accumulatedDeltas).trim();
  const durationMs = Date.now() - startedAt;

  return {
    mode: mode.name,
    provider,
    status,
    text,
    durationMs,
    usage,
    errors,
  };
}
