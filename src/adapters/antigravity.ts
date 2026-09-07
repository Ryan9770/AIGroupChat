import type { AgentEvent, ParseContext } from '../protocol/events.js';
import type { TaskRequest } from '../protocol/provider.js';
import { extractVersion, runProbe, whichBin } from '../process/exec.js';
import { asNumber, asRecord, asString, safeJson } from './parse-util.js';
import type { AgentAdapter, Argv, HeadlessCapability, PreflightResult } from './types.js';

/**
 * Google Antigravity CLI 어댑터. 실행 파일 이름은 `antigravity`가 아니라 **`agy`**.
 *
 * 주의: npm에 있는 `antigravity` 패키지는 구글 제품이 아닌 동명이인 장난 패키지다.
 * 실제 CLI는 Go 바이너리이며 기본 설치 경로는 `~/AppData/Local/agy/bin/agy`(Windows).
 * 설정은 gemini CLI와 `~/.gemini/` 디렉토리를 공유한다(`~/.gemini/antigravity-cli/`).
 */
export class AntigravityAdapter implements AgentAdapter {
  readonly provider = 'antigravity' as const;
  readonly bin = 'agy';

  readonly capability: HeadlessCapability = {
    // Go 플래그라서 -p는 **값을 받는다**. claude처럼 위치 인자로 주면
    // 뒤따르는 플래그를 프롬프트로 먹고 exit 2로 죽는다. (실측 확인)
    printFlag: '--print=<prompt>',
    streamJson: true,
    structuredOutput: true, // --json-schema
    resume: 'stdin-stream', // --input-format stream-json (--output-format stream-json 필수)
    // agy에는 --mcp-config가 없다. `agy mcp add`로 전역 사전 등록만 가능하다.
    // M3 공유 컨텍스트 버스가 claude와 다른 경로를 타야 한다는 뜻이다.
    promptDelivery: 'argv' as const, // 네이티브 agy.exe라 개행이 보존된다(실측)
    mcpInjection: 'pre-registered',
  };

  async preflight(offline: boolean): Promise<PreflightResult> {
    const path = await whichBin(this.bin);

    if (!path) {
      return {
        provider: this.provider,
        bin: this.bin,
        installed: false,
        authed: 'unknown',
        notes: [
          '미설치: 공식 배포처에서 Antigravity CLI 설치 후 `agy` 대화형 1회 실행으로 로그인',
          '주의: npm의 `antigravity` 패키지는 구글 제품이 아니다',
        ],
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

    // agy에는 auth/login 서브커맨드가 없다. `agy models`가 백엔드를 호출하므로
    // 추론 비용 없이 인증 여부를 확인할 수 있는 가장 싼 프로브다.
    const probe = await runProbe({ bin: path, args: ['models'], timeoutMs: 30_000 });
    const notes: string[] = [];
    const modelCount = probe.ok
      ? probe.stdout.split('\n').filter((l) => /^\S+\t/.test(l)).length
      : 0;

    if (!probe.ok) {
      notes.push('`agy models` 실패 — `agy`를 대화형으로 1회 실행해 로그인 필요');
    } else {
      notes.push('MCP는 `agy mcp add`로 사전 등록 필요 (호출 시점 주입 불가)');
    }

    return {
      provider: this.provider,
      bin: this.bin,
      installed: true,
      path,
      ...(version ? { version } : {}),
      authed: probe.ok,
      ...(probe.ok && modelCount > 0 ? { authSummary: `models: ${modelCount}` } : {}),
      notes,
    };
  }

  buildArgv(req: TaskRequest): Argv {
    const args = ['--output-format', 'stream-json'];

    // ⚠️ agy의 `--mode plan`은 claude의 plan과 의미가 다르다.
    // claude: 읽기 전용 권한 제한. agy: **계획 수립 워크플로우**(태스크 관리·탐색 루프).
    // 같은 질문("package.json의 name")을 시킨 실측 비교:
    //   --mode plan   도구 15회  입력 104,491 토큰  36.1s
    //   기본 모드      도구  3회  입력  24,332 토큰  13.2s
    // 토큰 4.3배, 시간 2.7배 차이다. plan을 읽기 전용으로 착각해 걸면 안 된다.
    //
    // 그래서 conductor의 'plan'은 agy 기본 모드로 보낸다.
    // ⚠️ 결과적으로 **agy에는 읽기 전용을 강제할 CLI 플래그가 없다.**
    // 쓰기 차단은 M4의 worktree 격리가 맡아야 하고, 그 전까지 Router는
    // 읽기 전용이 중요한 작업을 claude로 보내는 편이 안전하다.
    if (req.mode === 'write') args.push('--mode', 'accept-edits');

    // agy는 헤드리스에서도 permission_mode가 'request-review'로 남는다.
    // 승인할 사람이 없으니 도구가 전부 거부되고, 그런데도 status=SUCCESS를 낸다.
    // claude의 plan 모드와 달리 이걸 켜지 않으면 파일 읽기조차 못 한다.
    if (req.autoApprove) args.push('--dangerously-skip-permissions');

    if (req.model) args.push('--model', req.model);
    if (req.resumeId) args.push('--conversation', req.resumeId);

    // 프롬프트는 반드시 --print=VALUE 형태로, 그리고 마지막에 붙인다.
    // `-p` 뒤에 띄어쓰기로 주면 다음 플래그를 프롬프트로 삼켜버린다.
    // shell:false로 spawn하므로 인용부호를 직접 넣으면 프롬프트에 섞인다. 넣지 말 것.
    args.push(`--print=${req.prompt}`);

    return { bin: this.bin, args, env: {} };
  }

  parseLine(line: string, ctx: ParseContext): AgentEvent[] {
    const o = safeJson(line);
    if (!o) return [];

    // claude와 달리 판별자가 `type`이 아니라 `event`이고,
    // 실제 내용은 같은 이름의 중첩 객체 안에 들어 있다.
    switch (o['event']) {
      case 'init': {
        const sessionId = asString(o['conversation_id']) ?? '';
        ctx.sessionId = sessionId;
        const init = asRecord(o['init']);
        const model = asString(init?.['model']);
        return [
          {
            kind: 'session.started',
            sessionId,
            provider: this.provider,
            ...(model ? { model } : {}),
          },
        ];
      }

      case 'step_update': {
        const step = asRecord(o['step_update']);
        if (!step) return [{ kind: 'unknown', raw: o }];

        // 도구 호출은 step_type='tool'로 오고, 같은 step_index가
        // ACTIVE → DONE/ERROR로 두 번 온다. call과 result로 나눠 낸다.
        if (step['step_type'] === 'tool') {
          const callId = String(asNumber(step['step_index']) ?? '');
          const info = asRecord(step['tool_info']);
          const name = asString(step['tool_name']) ?? asString(info?.['name']) ?? '';
          const state = asString(step['state']);

          if (state === 'ACTIVE') {
            return [{ kind: 'tool.call', callId, name, input: info?.['parameters'] }];
          }

          const error = asRecord(info?.['error']);
          return [
            {
              kind: 'tool.result',
              callId,
              ok: state !== 'ERROR',
              summary: asString(error?.['message']) ?? state ?? '',
            },
          ];
        }

        const delta = asString(step['text_delta']);
        if (!delta) return [{ kind: 'unknown', raw: o }];

        // usage는 result에서만 집계한다. step_update의 DONE에도 같은 usage가
        // 실려오는데 둘 다 세면 이중 계상된다.
        return step['step_type'] === 'agent_thought'
          ? [{ kind: 'thinking', text: delta }]
          : [{ kind: 'message.delta', text: delta }];
      }

      case 'result': {
        const r = asRecord(o['result']);
        if (!r) return [{ kind: 'unknown', raw: o }];

        const events: AgentEvent[] = [];
        const text = asString(r['response']);
        if (text) events.push({ kind: 'message.final', text });

        const u = asRecord(r['usage']);
        if (u) {
          // agy는 비용(USD)을 주지 않는다. costUsd는 비워두고 토큰으로 환산해야 한다.
          events.push({
            kind: 'usage',
            inputTokens: asNumber(u['input_tokens']) ?? 0,
            outputTokens: asNumber(u['output_tokens']) ?? 0,
            ...(asNumber(u['cache_read_tokens']) !== undefined
              ? { cacheReadTokens: asNumber(u['cache_read_tokens'])! }
              : {}),
            ...(asNumber(u['thinking_tokens']) !== undefined
              ? { thinkingTokens: asNumber(u['thinking_tokens'])! }
              : {}),
          });
        }

        // agy는 도구 권한이 전부 거부돼 아무 일도 못 했을 때조차 SUCCESS로 보고한다.
        // status를 그대로 믿으면 빈 작업을 완료로 받게 된다. denied_actions로 잡아낸다.
        const denied = Array.isArray(r['denied_actions']) ? r['denied_actions'] : [];
        if (denied.length > 0) {
          const names = denied
            .map((d) => asString(asRecord(d)?.['display_name']) ?? 'unknown')
            .join(', ');
          events.push({
            kind: 'error',
            code: 'permission_denied',
            message:
              `도구 권한이 거부되어 작업이 수행되지 않았다: ${names}. ` +
              'agy는 헤드리스에서 승인자가 없으면 도구를 거부한다. ' +
              'autoApprove(--yolo)를 켜거나 settings.json의 permissions.allow에 사전 등록할 것.',
            // 권한 설정 문제라 그대로 재시도해봐야 똑같이 거부된다.
            retryable: false,
          });
        }

        const status = asString(r['status']);
        const failed = status !== 'SUCCESS' || denied.length > 0;
        const seconds = asNumber(r['duration_seconds']) ?? 0;
        events.push({
          kind: 'session.finished',
          status: failed ? 'error' : 'success',
          durationMs: Math.round(seconds * 1000),
          ...(asNumber(r['num_turns']) !== undefined
            ? { numTurns: asNumber(r['num_turns'])! }
            : {}),
        });
        return events;
      }

      default:
        return [{ kind: 'unknown', raw: o }];
    }
  }
}
