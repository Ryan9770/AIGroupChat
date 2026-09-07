import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentEvent, ParseContext } from '../protocol/events.js';
import type { TaskRequest } from '../protocol/provider.js';
import { extractVersion, runProbe, whichBin } from '../process/exec.js';
import { safeJson } from './parse-util.js';
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

    // gemini는 인증 상태를 알려주는 서브커맨드가 없다.
    // 자격증명 파일의 **존재 여부만** 본다. 내용은 절대 읽지 않는다. SPEC §9.1
    let authed: boolean | 'unknown' = 'unknown';
    const notes: string[] = [];

    if (offline) {
      notes.push('--offline: 인증 프로브 생략');
    } else {
      try {
        await access(join(homedir(), '.gemini', 'google_accounts.json'));
        authed = true;
        notes.push('자격증명 파일 존재로 추정 (전용 status 커맨드 없음)');
      } catch {
        authed = false;
        notes.push('자격증명 파일 없음 — `gemini`를 대화형으로 1회 실행해 로그인');
      }
    }

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
    const args = ['-p', '', '-o', 'stream-json'];

    args.push('--approval-mode', req.mode === 'plan' ? 'plan' : 'auto_edit');

    // gemini의 무인 자동 승인. plan 모드에서는 의미가 없으므로 write에서만 건다.
    // 미실측 — M2에서 확인할 것.
    if (req.autoApprove && req.mode !== 'plan') args.push('--yolo');

    if (req.model) args.push('-m', req.model);
    if (req.resumeId) args.push('--session-id', req.resumeId);

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
