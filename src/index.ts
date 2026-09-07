#!/usr/bin/env node
import { Command } from 'commander';
import { doctor } from './commands/doctor.js';
import { run } from './commands/run.js';
import { workspaceList, workspaceRemove } from './commands/workspace.js';
import { PROVIDERS } from './protocol/provider.js';

const program = new Command();

program
  .name('conductor')
  .description('여러 구독형 AI 코딩 CLI를 헤드리스로 지휘하는 멀티 에이전트 오케스트레이터')
  .version('0.0.1');

program
  .command('doctor')
  .description('각 AI CLI의 설치·버전·로그인 상태와 헤드리스 능력을 점검한다')
  .option('--offline', '네트워크를 타는 인증 프로브를 생략한다', false)
  .option('--json', '사람이 읽는 표 대신 JSON으로 출력한다', false)
  .option('--show-argv', 'provider별로 실제 실행될 커맨드를 미리 보여준다', false)
  .action(async (opts: { offline: boolean; json: boolean; showArgv: boolean }) => {
    const code = await doctor({
      offline: opts.offline,
      json: opts.json,
      showArgv: opts.showArgv,
    });
    process.exitCode = code;
  });

program
  .command('run')
  .description('한 워커에게 프롬프트를 위임하고 정규화 이벤트를 스트리밍한다')
  .argument('<prompt>', '워커에게 줄 프롬프트')
  .requiredOption('-a, --agent <provider>', `실행할 provider (${PROVIDERS.join(' | ')})`)
  .option('-m, --mode <mode>', '실행 모드: plan(읽기 전용) | write(편집 허용)', 'plan')
  .option('--model <model>', '벤더 고유 모델 식별자')
  .option('--cwd <path>', '워커의 실행 디렉토리', process.cwd())
  .option('-r, --resume <id>', '이어갈 세션/대화 ID')
  .option('--timeout <ms>', '워커 타임아웃(ms)', '900000')
  .option('--json', '정규화 이벤트를 JSONL로 출력한다', false)
  .option('--no-isolate', '호스트 프로젝트 컨텍스트 격리를 끈다 (비용이 크게 는다)')
  .option('-w, --workspace', '전용 git worktree를 만들어 그 안에서 워커를 돌린다', false)
  .option('--clean-empty', '변경이 없으면 실행 후 worktree를 자동 정리한다', false)
  .option(
    '-y, --yolo',
    '도구 승인 프롬프트를 자동 승인한다. agy는 이게 없으면 헤드리스에서 도구가 전부 거부된다',
    false,
  )
  .action(
    async (
      prompt: string,
      opts: {
        agent: string;
        mode: string;
        model?: string;
        cwd: string;
        resume?: string;
        timeout: string;
        json: boolean;
        isolate: boolean;
        yolo: boolean;
        workspace: boolean;
        cleanEmpty: boolean;
      },
    ) => {
      if (opts.mode !== 'plan' && opts.mode !== 'write') {
        process.stderr.write(`--mode는 plan 또는 write여야 합니다 (받은 값: ${opts.mode})\n`);
        process.exitCode = 2;
        return;
      }
      process.exitCode = await run(prompt, {
        agent: opts.agent,
        mode: opts.mode,
        cwd: opts.cwd,
        timeoutMs: Number(opts.timeout),
        json: opts.json,
        noIsolate: opts.isolate === false,
        autoApprove: opts.yolo,
        workspace: opts.workspace,
        cleanEmpty: opts.cleanEmpty,
        ...(opts.model ? { model: opts.model } : {}),
        ...(opts.resume ? { resume: opts.resume } : {}),
      });
    },
  );

const workspace = program
  .command('workspace')
  .description('워커 전용 git worktree를 조회·정리한다');

workspace
  .command('list', { isDefault: true })
  .description('conductor가 만든 작업 공간 목록')
  .option('--cwd <path>', '대상 저장소', process.cwd())
  .option('--json', 'JSON으로 출력한다', false)
  .action(async (opts: { cwd: string; json: boolean }) => {
    process.exitCode = await workspaceList(opts.cwd, opts.json);
  });

workspace
  .command('rm')
  .description('작업 공간과 그 브랜치를 제거한다')
  .argument('<id>', '작업 공간 ID')
  .option('--cwd <path>', '대상 저장소', process.cwd())
  .option('-f, --force', '커밋되지 않은 변경이 있어도 제거한다', false)
  .action(async (id: string, opts: { cwd: string; force: boolean }) => {
    process.exitCode = await workspaceRemove(opts.cwd, id, opts.force);
  });

await program.parseAsync(process.argv);
