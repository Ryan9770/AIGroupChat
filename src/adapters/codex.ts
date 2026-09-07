import type { AgentEvent, ParseContext } from '../protocol/events.js';
import type { TaskRequest } from '../protocol/provider.js';
import { extractVersion, runProbe, whichBin } from '../process/exec.js';
import { safeJson } from './parse-util.js';
import type { AgentAdapter, Argv, HeadlessCapability, PreflightResult } from './types.js';

/**
 * OpenAI Codex CLI 어댑터.
 *
 * 현재 로컬 미설치 상태라 아래 capability와 buildArgv는 **공식 문서 기반이며
 * 실측 검증되지 않았다.** 설치 후 M2에서 실제 출력으로 확정할 것.
 */
export class CodexAdapter implements AgentAdapter {
  readonly provider = 'codex' as const;
  readonly bin = 'codex';

  readonly capability: HeadlessCapability = {
    printFlag: 'exec',
    streamJson: true, // --json (JSONL)
    structuredOutput: true, // --output-schema <file>
    resume: 'respawn-with-id', // codex exec resume --last | <id>
    mcpInjection: 'unknown', // 미검증
  };

  async preflight(offline: boolean): Promise<PreflightResult> {
    const path = await whichBin(this.bin);

    if (!path) {
      return {
        provider: this.provider,
        bin: this.bin,
        installed: false,
        authed: 'unknown',
        notes: ['미설치: 공식 배포처에서 설치 후 `codex login`'],
      };
    }

    const ver = await runProbe({ bin: path, args: ['--version'], timeoutMs: 15_000 });
    const version = ver.ok ? extractVersion(ver.stdout) : undefined;

    return {
      provider: this.provider,
      bin: this.bin,
      installed: true,
      path,
      ...(version ? { version } : {}),
      authed: 'unknown',
      notes: offline
        ? ['--offline: 인증 프로브 생략']
        : ['인증 프로브 미구현 — 설치 확인 후 M2에서 실측하여 추가'],
    };
  }

  buildArgv(req: TaskRequest): Argv {
    const args = ['exec', '--json'];

    args.push('--sandbox', req.mode === 'plan' ? 'read-only' : 'workspace-write');

    if (req.model) args.push('--model', req.model);

    if (req.resumeId) {
      // codex는 resume이 서브커맨드다: codex exec resume <id> "prompt"
      return {
        bin: this.bin,
        args: ['exec', 'resume', req.resumeId, '--json', req.prompt],
        env: {},
      };
    }

    args.push(req.prompt);
    return { bin: this.bin, args, env: {} };
  }

  parseLine(line: string, _ctx: ParseContext): AgentEvent[] {
    const o = safeJson(line);
    if (!o) return [];
    // 미실측. M2에서 tools/capture-fixture.ts로 픽스처를 뜬 뒤 매핑한다.
    // 추측으로 매핑하면 조용히 틀린 이벤트를 흘리게 되므로 전부 unknown으로 통과시킨다.
    return [{ kind: 'unknown', raw: o }];
  }
}
