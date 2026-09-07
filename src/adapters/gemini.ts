import type { AgentEvent, ParseContext } from '../protocol/events.js';
import type { TaskRequest } from '../protocol/provider.js';
import { extractVersion, runProbe, whichBin } from '../process/exec.js';
import { asNumber, asRecord, asString, safeJson } from './parse-util.js';
import { providerError, streamState } from './stream-state.js';
import type { AgentAdapter, Argv, HeadlessCapability, PreflightResult } from './types.js';

export class GeminiAdapter implements AgentAdapter {
  readonly provider = 'gemini' as const;
  readonly bin = 'gemini';

  readonly capability: HeadlessCapability = {
    printFlag: '-p <prompt>', // claude/agy와 달리 -p가 값을 받는 플래그다
    streamJson: true, // -o stream-json
    structuredOutput: false, // --json-schema / --output-schema 없음
    resume: 'respawn-with-id', // --session-id / --resume
    promptDelivery: 'stdin' as const, // npm .cmd 심 경유 → argv 개행 잘림
    mcpInjection: 'pre-registered', // `gemini mcp` 서브커맨드
  };

  async preflight(offline: boolean): Promise<PreflightResult> {
    const path = await whichBin(this.bin);

    if (!path) {
      return {
        provider: this.provider,
        bin: this.bin,
        installed: false,
        authed: 'unknown',
        notes: ['미설치: `npm i -g @google/gemini-cli`'],
      };
    }

    const ver = await runProbe({ bin: path, args: ['--version'], timeoutMs: 15_000 });
    const version = ver.ok ? extractVersion(ver.stdout) : undefined;

    const authed = 'unknown' as const;
    const notes = offline
      ? ['--offline: 인증 프로브 생략']
      : ['전용 인증 상태 명령이 없어 미확인입니다. `gemini`에서 로그인 방식을 확인하세요. 인증 파일 존재만으로 실행 가능 여부를 판단하지 않습니다.'];

    return {
      provider: this.provider,
      bin: this.bin,
      installed: true,
      path,
      ...(version ? { version } : {}),
      authed,
      notes,
    };
  }

  buildArgv(req: TaskRequest): Argv {
    // gemini의 -p는 값을 받지만, 값을 비우고 프롬프트는 stdin으로 넘긴다.
    // (`-p`의 도움말: "Appended to input on stdin (if any)")
    // Windows npm 심(.cmd)을 거치면 argv의 개행이 잘리기 때문이다.
    const args = ['-p', 'Follow the instructions provided on stdin.', '-o', 'stream-json'];

    args.push('--approval-mode', req.mode === 'plan' ? 'plan' : req.autoApprove ? 'yolo' : 'auto_edit');

    // gemini의 무인 자동 승인. plan 모드에서는 의미가 없으므로 write에서만 건다.
    // 미실측 — M2에서 확인할 것.

    if (req.model) args.push('-m', req.model);
    if (req.resumeId) args.push('--resume', req.resumeId);

    return { bin: this.bin, args, env: {} };
  }

  parseLine(line: string, context: ParseContext): AgentEvent[] {
    if (!line.trim()) return [];
    const raw = safeJson(line);
    if (!raw) return [{ kind: 'unknown', raw: line }];
    const state = streamState(context);
    if (state.finished) return [];
    const unknown: AgentEvent[] = [{ kind: 'unknown', raw }];
    if (raw.type === 'init') {
      const sessionId = asString(raw.session_id);
      if (!sessionId) return unknown;
      context.sessionId = sessionId;
      const model = asString(raw.model);
      return [{ kind: 'session.started', provider: this.provider, sessionId, ...(model ? { model } : {}) }];
    }
    if (raw.type === 'message') {
      if (raw.role === 'user') return [];
      const content = asString(raw.content);
      if (raw.role !== 'assistant' || content === undefined) return unknown;
      if (raw.delta === true) {
        state.text += content;
        return [{ kind: 'message.delta', text: content }];
      }
      state.text = content;
      return [{ kind: 'message.final', text: content }];
    }
    if (raw.type === 'tool_use') {
      const callId = asString(raw.tool_id);
      const name = asString(raw.tool_name);
      if (!callId || !name) return unknown;
      if (state.calls.has(callId)) return [];
      state.calls.add(callId);
      return [{ kind: 'tool.call', callId, name, input: raw.parameters ?? {} }];
    }
    if (raw.type === 'tool_result') {
      const callId = asString(raw.tool_id);
      if (!callId) return unknown;
      if (state.completed.has(callId)) return [];
      state.completed.add(callId);
      const error = asRecord(raw.error);
      return [{ kind: 'tool.result', callId, ok: raw.status === 'success' && !raw.error,
        summary: asString(error?.message) ?? asString(raw.output) ?? String(raw.status ?? 'unknown') }];
    }
    if (raw.type === 'error') {
      if (raw.severity === 'warning') return unknown;
      state.failed = true;
      return [providerError(asString(raw.message) ?? 'Gemini error', 'gemini_error')];
    }
    if (raw.type !== 'result') return unknown;
    state.finished = true;
    const events: AgentEvent[] = [];
    const stats = asRecord(raw.stats);
    const inputTokens = asNumber(stats?.input_tokens);
    const outputTokens = asNumber(stats?.output_tokens);
    if (inputTokens !== undefined && outputTokens !== undefined) {
      const cacheReadTokens = asNumber(stats?.cached);
      events.push({ kind: 'usage', inputTokens, outputTokens,
        ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}) });
    }
    const success = raw.status === 'success' && !raw.error && !state.failed;
    if (!success) events.push(providerError(asString(asRecord(raw.error)?.message) ?? 'Gemini run failed', 'gemini_error'));
    events.push({ kind: 'session.finished', status: success ? 'success' : 'error',
      durationMs: asNumber(stats?.duration_ms) ?? Date.now() - state.startedAt });
    return events;
  }
}
