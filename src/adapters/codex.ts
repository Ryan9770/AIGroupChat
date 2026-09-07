import type { AgentEvent, ParseContext } from '../protocol/events.js';
import type { TaskRequest } from '../protocol/provider.js';
import { extractVersion, runProbe, whichBin, type ProbeResult } from '../process/exec.js';
import { asNumber, asRecord, asString, safeJson } from './parse-util.js';
import { providerError, streamState } from './stream-state.js';
import type { AgentAdapter, Argv, HeadlessCapability, PreflightResult } from './types.js';

export function codexAuthStatus(probe: ProbeResult): Pick<PreflightResult, 'authed' | 'authSummary' | 'notes'> {
  if (probe.timedOut || probe.spawnError) return { authed: 'unknown', notes: ['로그인 상태 확인 실패 또는 시간 초과'] };
  const text = `${probe.stdout}\n${probe.stderr}`;
  if (probe.ok && /Logged in using ChatGPT/i.test(text)) {
    return { authed: true, authSummary: 'ChatGPT', notes: ['로그인 상태는 실행 모델의 사용 가능 여부까지 보장하지 않습니다.'] };
  }
  if (probe.ok && /Logged in using (?:an? )?API key/i.test(text)) return { authed: true, authSummary: 'API key', notes: [] };
  if (!probe.ok && /Not logged in/i.test(text)) return { authed: false, notes: ['`codex login`으로 로그인하세요.'] };
  return { authed: 'unknown', notes: ['로그인 상태 응답을 확인할 수 없습니다. `codex login status`로 확인하세요.'] };
}

export class CodexAdapter implements AgentAdapter {
  readonly provider = 'codex' as const;
  readonly bin = 'codex';
  readonly capability: HeadlessCapability = {
    printFlag: 'exec', streamJson: true, structuredOutput: true,
    resume: 'respawn-with-id', promptDelivery: 'stdin', mcpInjection: 'unknown',
  };

  async preflight(offline: boolean): Promise<PreflightResult> {
    const path = await whichBin(this.bin);
    if (!path) return { provider: this.provider, bin: this.bin, installed: false, authed: 'unknown', notes: ['Codex CLI를 설치하고 `codex login`으로 로그인하세요.'] };
    const versionProbe = await runProbe({ bin: path, args: ['--version'], timeoutMs: 15_000 });
    const version = versionProbe.ok ? extractVersion(versionProbe.stdout) : undefined;
    const auth = offline
      ? { authed: 'unknown' as const, notes: ['--offline: 인증 프로브 생략'] }
      : codexAuthStatus(await runProbe({ bin: path, args: ['login', 'status'], timeoutMs: 15_000 }));
    return { provider: this.provider, bin: this.bin, installed: true, path, ...(version ? { version } : {}), ...auth };
  }

  buildArgv(req: TaskRequest): Argv {
    // ⚠️ 워커 협약과 read-only 샌드박스는 양립하지 않는다.
    //
    // 협약에서 완료를 보고하려면 run 디렉토리에 메시지 파일을 **써야** 한다.
    // 그런데 `--sandbox read-only`는 어디에도 쓰지 못하게 막는다. 그래서
    // plan 모드 + 협약으로 codex를 돌리면 워커가 보고를 못 하고,
    // 정산이 no_completion으로 떨어진다(실측).
    //
    // writableDirs가 있으면 workspace-write로 올리고 그 경로를 열어준다.
    // 읽기 전용 강제가 약해지는 대신 보고가 가능해진다. 안전 경계는
    // 여전히 worktree 격리다. 협약이 필요 없으면 writableDirs를 비우면 된다.
    const needsWrite = req.mode !== 'plan' || (req.writableDirs?.length ?? 0) > 0;
    const args = ['exec', '--json', '--sandbox', needsWrite ? 'workspace-write' : 'read-only'];
    args.push('-c', 'approval_policy="never"');
    for (const dir of req.writableDirs ?? []) args.push('--add-dir', dir);
    if (req.model) args.push('--model', req.model);
    if (req.resumeId) args.push('resume', req.resumeId);
    args.push('-');
    return { bin: this.bin, args, env: {} };
  }

  parseLine(line: string, context: ParseContext): AgentEvent[] {
    if (!line.trim()) return [];
    const raw = safeJson(line);
    if (!raw) return [{ kind: 'unknown', raw: line }];
    const state = streamState(context);
    if (state.finished) return [];
    const unknown: AgentEvent[] = [{ kind: 'unknown', raw }];
    if (raw.type === 'thread.started') {
      const sessionId = asString(raw.thread_id);
      if (!sessionId) return unknown;
      context.sessionId = sessionId;
      return [{ kind: 'session.started', provider: this.provider, sessionId }];
    }
    if (raw.type === 'turn.started') return [];
    if (raw.type === 'error') return [providerError(asString(raw.message) ?? 'Codex error', 'codex_error')];
    if (raw.type === 'turn.failed') {
      state.finished = true;
      return [providerError(asString(asRecord(raw.error)?.message) ?? 'Codex turn failed', 'turn_failed'),
        { kind: 'session.finished', status: 'error', durationMs: Date.now() - state.startedAt }];
    }
    if (raw.type === 'turn.completed') {
      state.finished = true;
      const events: AgentEvent[] = [];
      const usage = asRecord(raw.usage);
      const inputTokens = asNumber(usage?.input_tokens);
      const outputTokens = asNumber(usage?.output_tokens);
      if (inputTokens !== undefined && outputTokens !== undefined) {
        const cacheReadTokens = asNumber(usage?.cached_input_tokens);
        const thinkingTokens = asNumber(usage?.reasoning_output_tokens);
        events.push({ kind: 'usage', inputTokens, outputTokens,
          ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
          ...(thinkingTokens !== undefined ? { thinkingTokens } : {}) });
      }
      events.push({ kind: 'session.finished', status: 'success', durationMs: Date.now() - state.startedAt });
      return events;
    }
    if (!['item.started', 'item.updated', 'item.completed'].includes(String(raw.type))) return unknown;
    const item = asRecord(raw.item);
    const callId = asString(item?.id);
    if (!item || !callId) return unknown;
    const complete = raw.type === 'item.completed';
    if (state.completed.has(callId)) return [];
    if (complete) state.completed.add(callId);
    if (item.type === 'agent_message' || item.type === 'reasoning') {
      if (!complete) return [];
      const text = asString(item.text);
      return text === undefined ? unknown : [{ kind: item.type === 'reasoning' ? 'thinking' : 'message.final', text }];
    }
    if (item.type === 'error') return complete ? [providerError(asString(item.message) ?? 'Codex item error', 'item_error')] : [];
    if (!['command_execution', 'file_change', 'mcp_tool_call', 'web_search'].includes(String(item.type))) return unknown;
    const events: AgentEvent[] = [];
    if (!state.calls.has(callId)) {
      state.calls.add(callId);
      events.push({ kind: 'tool.call', callId,
        name: item.type === 'mcp_tool_call' ? `${asString(item.server) ?? 'mcp'}.${asString(item.tool) ?? 'tool'}` : String(item.type),
        input: item.command ?? item.arguments ?? item.changes ?? item.query ?? {} });
    }
    if (!complete) return events;
    const ok = (item.status === 'completed' || item.status === 'applied' || (item.type === 'web_search' && item.status === undefined))
      && item.error == null && (item.type !== 'command_execution' || item.exit_code === 0);
    events.push({ kind: 'tool.result', callId, ok,
      summary: asString(item.aggregated_output) ?? asString(asRecord(item.error)?.message) ?? asString(item.error) ?? asString(item.query) ?? String(item.status ?? 'completed') });
    if (ok && item.type === 'file_change' && Array.isArray(item.changes)) {
      for (const value of item.changes) {
        const change = asRecord(value);
        const path = asString(change?.path);
        const op = change?.kind === 'add' ? 'create' : change?.kind === 'update' ? 'modify' : change?.kind === 'delete' ? 'delete' : undefined;
        if (path && op) events.push({ kind: 'file.changed', path, op });
      }
    }
    return events;
  }
}
