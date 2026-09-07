import type { AgentEvent, ParseContext } from '../protocol/events.js';
import type { TaskRequest } from '../protocol/provider.js';
import { extractVersion, runProbe, whichBin } from '../process/exec.js';
import { asNumber, asRecord, asString, safeJson } from './parse-util.js';
import type { AgentAdapter, Argv, HeadlessCapability, PreflightResult } from './types.js';

/**
 * `claude auth status --json` 응답 중 **비민감 필드만** 통과시킨다.
 *
 * 원본 응답에는 email, orgId, orgName, projectsDirectory가 들어 있다.
 * 이 함수를 거치지 않은 값은 어디에도 저장·출력하지 않는다. SPEC §9.1
 */
function redactAuthStatus(raw: string): { authed: boolean; summary?: string } {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { authed: false };

    const o = parsed as Record<string, unknown>;
    const authed = o['loggedIn'] === true;
    if (!authed) return { authed: false };

    const method = typeof o['authMethod'] === 'string' ? o['authMethod'] : undefined;
    const plan = typeof o['subscriptionType'] === 'string' ? o['subscriptionType'] : undefined;
    const summary = [method, plan].filter(Boolean).join(' / ');

    return summary ? { authed, summary } : { authed };
  } catch {
    return { authed: false };
  }
}

export class ClaudeAdapter implements AgentAdapter {
  readonly provider = 'claude' as const;
  readonly bin = 'claude';

  readonly capability: HeadlessCapability = {
    printFlag: '-p',
    streamJson: true,
    structuredOutput: true, // --json-schema
    resume: 'stdin-stream', // --input-format stream-json
    promptDelivery: 'stdin' as const, // npm .cmd 심 경유 → argv 개행 잘림
    commandPermission: 'granular' as const, // --allowed-tools "Bash(cmd *)"
    mcpInjection: 'per-invocation', // --mcp-config
  };

  async preflight(offline: boolean): Promise<PreflightResult> {
    const path = await whichBin(this.bin);
    const notes: string[] = [];

    if (!path) {
      return {
        provider: this.provider,
        bin: this.bin,
        installed: false,
        authed: 'unknown',
        notes: ['미설치: `npm i -g @anthropic-ai/claude-code` 후 `claude auth login`'],
      };
    }

    const ver = await runProbe({ bin: path, args: ['--version'], timeoutMs: 15_000 });
    const version = ver.ok ? extractVersion(ver.stdout) : undefined;

    if (offline) {
      return {
        provider: this.provider,
        bin: this.bin,
        installed: true,
        path,
        ...(version ? { version } : {}),
        authed: 'unknown',
        notes: ['--offline: 인증 프로브 생략'],
      };
    }

    const auth = await runProbe({
      bin: path,
      args: ['auth', 'status', '--json'],
      timeoutMs: 20_000,
    });

    if (!auth.ok) {
      notes.push('`claude auth status` 실패 — `claude auth login` 필요');
      return {
        provider: this.provider,
        bin: this.bin,
        installed: true,
        path,
        ...(version ? { version } : {}),
        authed: false,
        notes,
      };
    }

    const { authed, summary } = redactAuthStatus(auth.stdout);
    if (!authed) notes.push('로그인 안 됨 — `claude auth login`');

    return {
      provider: this.provider,
      bin: this.bin,
      installed: true,
      path,
      ...(version ? { version } : {}),
      authed,
      ...(summary ? { authSummary: summary } : {}),
      notes,
    };
  }

  buildArgv(req: TaskRequest): Argv {
    const args = ['-p', '--output-format', 'stream-json', '--verbose'];

    // 무인 실행에서 승인 대기로 멈추지 않게 한다.
    // 'none' = 프롬프트가 필요한 동작은 자동 거부. permission-mode가 나머지를 결정한다.
    args.push('--permission-prompts', 'none');

    // plan 모드는 autoApprove 없이도 읽기 도구가 정상 동작한다(실측).
    // write 모드의 acceptEdits는 편집만 자동 승인하므로, Bash 같은 도구는
    // 여전히 프롬프트 → 자동 거부된다. 그래서 write + autoApprove일 때만
    // bypassPermissions로 올린다.
    const permissionMode =
      req.mode === 'plan' ? 'plan' : req.autoApprove ? 'bypassPermissions' : 'acceptEdits';
    args.push('--permission-mode', permissionMode);

    if (req.isolate !== false) {
      // 워커가 호스트 프로젝트의 컨텍스트를 상속하지 않게 한다.
      // 측정값(캐시 warm, 동일 프롬프트):
      //   baseline                        tools 94  $0.2020  3553ms
      //   +strict-mcp-config              tools 29  $0.1943  5413ms
      //   +setting-sources +no-slash      tools 28  $0.0262  2151ms  ← 채택
      // 비용 7.7배, 지연 40% 차이다. 끄고 돌리면 오케스트레이션이 비싸진다.
      //
      // --bare는 쓸 수 없다. OAuth/키체인을 아예 읽지 않아 구독 인증이 깨진다.
      args.push('--strict-mcp-config'); // --mcp-config로 준 것 외 MCP 서버 무시
      args.push('--setting-sources', ''); // user/project/local 설정 및 CLAUDE.md 미로드
      args.push('--disable-slash-commands'); // 스킬 목록 미주입
    }

    // 🔴 협약을 쓰면 워커가 셸로 보고해야 한다. acceptEdits는 편집만 자동 승인하므로
    // Bash는 여전히 프롬프트 → --permission-prompts none에 걸려 자동 거부된다.
    // 그러면 워커가 완료를 알릴 방법이 없어 무조건 no_completion으로 끝난다(실측).
    // 보고 명령만 콕 집어 허용해서, 전면 승인 없이도 협약이 돌아가게 한다.
    for (const command of req.allowCommands ?? []) {
      args.push('--allowed-tools', `Bash(${command} *)`);
    }

    if (req.model) args.push('--model', req.model);
    if (req.resumeId) args.push('--resume', req.resumeId);

    // 프롬프트는 argv가 아니라 stdin으로 간다. capability.promptDelivery 참조.
    // Windows npm 심(.cmd)을 거치면 argv의 개행에서 잘리기 때문이다.
    return { bin: this.bin, args, env: {} };
  }

  parseLine(line: string, ctx: ParseContext): AgentEvent[] {
    const o = safeJson(line);
    if (!o) return [];

    switch (o['type']) {
      case 'system': {
        if (o['subtype'] !== 'init') return [{ kind: 'unknown', raw: o }];
        const sessionId = asString(o['session_id']) ?? '';
        ctx.sessionId = sessionId;
        const model = asString(o['model']);
        return [
          {
            kind: 'session.started',
            sessionId,
            provider: this.provider,
            ...(model ? { model } : {}),
          },
        ];
      }

      case 'assistant': {
        const message = asRecord(o['message']);
        const content = message?.['content'];
        if (!Array.isArray(content)) return [{ kind: 'unknown', raw: o }];

        const events: AgentEvent[] = [];
        for (const rawBlock of content) {
          const block = asRecord(rawBlock);
          if (!block) continue;

          if (block['type'] === 'text') {
            const text = asString(block['text']);
            if (text) events.push({ kind: 'message.delta', text });
          } else if (block['type'] === 'thinking') {
            const text = asString(block['thinking']) ?? asString(block['text']);
            if (text) events.push({ kind: 'thinking', text });
          } else if (block['type'] === 'tool_use') {
            events.push({
              kind: 'tool.call',
              callId: asString(block['id']) ?? '',
              name: asString(block['name']) ?? '',
              input: block['input'],
            });
          }
        }
        // usage는 result에서 한 번만 집계한다. assistant의 usage까지 세면 이중 계상된다.
        return events.length > 0 ? events : [{ kind: 'unknown', raw: o }];
      }

      case 'user': {
        const message = asRecord(o['message']);
        const content = message?.['content'];
        if (!Array.isArray(content)) return [{ kind: 'unknown', raw: o }];

        const events: AgentEvent[] = [];
        for (const rawBlock of content) {
          const block = asRecord(rawBlock);
          if (block?.['type'] !== 'tool_result') continue;
          const raw = block['content'];
          events.push({
            kind: 'tool.result',
            callId: asString(block['tool_use_id']) ?? '',
            ok: block['is_error'] !== true,
            summary: (typeof raw === 'string' ? raw : JSON.stringify(raw ?? '')).slice(0, 500),
          });
        }
        return events.length > 0 ? events : [{ kind: 'unknown', raw: o }];
      }

      case 'rate_limit_event': {
        const info = asRecord(o['rate_limit_info']);
        if (!info) return [{ kind: 'unknown', raw: o }];

        // unifiedWindows에서 가장 압박이 큰 창을 고른다.
        // Governor는 "가장 먼저 막힐 창"만 신경 쓰면 된다.
        const windows = asRecord(info['unifiedWindows']) ?? {};
        let worstKey: string | undefined;
        let worstUse = -1;
        let worstReset: number | undefined;

        for (const [key, value] of Object.entries(windows)) {
          const win = asRecord(value);
          const use = asNumber(win?.['utilization']);
          if (use !== undefined && use > worstUse) {
            worstUse = use;
            worstKey = key;
            worstReset = asNumber(win?.['resetsAt']);
          }
        }

        const limitType = worstKey ?? asString(info['rateLimitType']);
        const resetsAt = worstReset ?? asNumber(info['resetsAt']);

        return [
          {
            kind: 'rate_limit',
            status: asString(info['status']) ?? 'unknown',
            ...(limitType ? { limitType } : {}),
            ...(worstUse >= 0 ? { utilization: worstUse } : {}),
            ...(resetsAt !== undefined ? { resetsAt } : {}),
          },
        ];
      }

      case 'result': {
        const events: AgentEvent[] = [];
        const isError = o['is_error'] === true || o['subtype'] !== 'success';

        const text = asString(o['result']);
        if (text) events.push({ kind: 'message.final', text });

        const u = asRecord(o['usage']);
        if (u) {
          events.push({
            kind: 'usage',
            inputTokens: asNumber(u['input_tokens']) ?? 0,
            outputTokens: asNumber(u['output_tokens']) ?? 0,
            ...(asNumber(u['cache_creation_input_tokens']) !== undefined
              ? { cacheCreationTokens: asNumber(u['cache_creation_input_tokens'])! }
              : {}),
            ...(asNumber(u['cache_read_input_tokens']) !== undefined
              ? { cacheReadTokens: asNumber(u['cache_read_input_tokens'])! }
              : {}),
            ...(asNumber(o['total_cost_usd']) !== undefined
              ? { costUsd: asNumber(o['total_cost_usd'])! }
              : {}),
          });
        }

        events.push({
          kind: 'session.finished',
          status: isError ? 'error' : 'success',
          durationMs: asNumber(o['duration_ms']) ?? 0,
          ...(asNumber(o['num_turns']) !== undefined
            ? { numTurns: asNumber(o['num_turns'])! }
            : {}),
        });
        return events;
      }

      default:
        return [{ kind: 'unknown', raw: o }];
    }
  }
}
