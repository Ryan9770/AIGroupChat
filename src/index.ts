#!/usr/bin/env node
import { Command } from 'commander';
import { doctor } from './commands/doctor.js';
import { planRun, planShow } from './commands/plan.js';
import { run } from './commands/run.js';
import {
  workerAsk,
  workerCheck,
  workerDone,
  workerEscalate,
  workerHeartbeat,
} from './commands/worker.js';
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
  .option(
    '-P, --protocol',
    '워커 협약을 켠다: 프리앰블 주입 + worker done/ask 수신 + 정산',
    false,
  )
  .option('--auto-answer', '워커 질문에 사람 대신 자동 응답한다 (무인 실행용)', false)
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
        protocol: boolean;
        autoAnswer: boolean;
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
        protocol: opts.protocol,
        // 파이프로 답을 넣는 경우도 사람 모드로 본다.
        // stdin이 EOF면 Coordinator가 알아서 자동 응답으로 떨어진다.
        answerMode: opts.autoAnswer ? ('auto' as const) : ('human' as const),
        ...(opts.model ? { model: opts.model } : {}),
        ...(opts.resume ? { resume: opts.resume } : {}),
      });
    },
  );

const plan = program
  .command('plan')
  .description('여러 Task로 이루어진 계획(DAG)을 여러 provider에 배분해 실행한다');

plan
  .command('show')
  .description('실행하지 않고 DAG와 provider 배정만 보여준다')
  .argument('<file>', '계획 JSON 파일')
  .option('--offline', '인증 프로브를 생략한다', false)
  .action(async (file: string, opts: { offline: boolean }) => {
    process.exitCode = await planShow(file, opts.offline);
  });

plan
  .command('run')
  .description('계획을 실행한다. 각 Task는 선행 작업이 정산된 뒤에만 시작한다')
  .argument('<file>', '계획 JSON 파일')
  .option('--cwd <path>', '대상 저장소', process.cwd())
  .option('--timeout <ms>', 'Task별 타임아웃(ms)', '900000')
  .option('--no-isolate', '호스트 컨텍스트 격리를 끈다')
  .option('-y, --yolo', '도구 승인 프롬프트를 자동 승인한다', false)
  .option('-P, --no-protocol', '워커 협약을 끈다')
  .option('--auto-answer', '워커 질문에 자동 응답한다', false)
  .option('-v, --verbose', '각 워커의 출력을 그대로 보여준다', false)
  .option('--max-attempts <n>', 'Task 하나당 최대 시도 횟수(페일오버 포함)', '3')
  .option('--budget-usd <n>', '실행 전체 비용 상한. 넘으면 남은 Task를 건너뛴다')
  .option('--max-per-provider <n>', 'provider별 배치 수 상한 (구독 사용량 보호)')
  .action(
    async (
      file: string,
      opts: {
        cwd: string;
        timeout: string;
        isolate: boolean;
        yolo: boolean;
        protocol: boolean;
        autoAnswer: boolean;
        verbose: boolean;
        maxAttempts: string;
        budgetUsd?: string;
        maxPerProvider?: string;
      },
    ) => {
      process.exitCode = await planRun(file, {
        cwd: opts.cwd,
        isolate: opts.isolate !== false,
        autoApprove: opts.yolo,
        protocol: opts.protocol !== false,
        answerMode: opts.autoAnswer ? 'auto' : 'human',
        timeoutMs: Number(opts.timeout),
        verbose: opts.verbose,
        maxAttempts: Number(opts.maxAttempts),
        ...(opts.budgetUsd !== undefined ? { budgetUsd: Number(opts.budgetUsd) } : {}),
        ...(opts.maxPerProvider !== undefined
          ? { maxPerProvider: Number(opts.maxPerProvider) }
          : {}),
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

// 워커 프로세스가 셸에서 호출하는 명령들. 사람이 직접 칠 일은 없다.
const worker = program
  .command('worker')
  .description('배치된 워커가 코디네이터와 소통하는 명령 (워커 전용)');

worker
  .command('done')
  .description('작업 결과를 보고한다 (필수, 정확히 한 번)')
  .requiredOption('--outcome <outcome>', 'succeeded | failed')
  .requiredOption('--body <text>', '3문장 요약: 무엇을 했고/발견했고/남았는지')
  .option('--subject <text>', '짧은 상태 문구')
  .option('--files-modified <list>', '쉼표로 구분한 변경 파일')
  .option('--task-id <id>', '배치받은 task ID')
  .option('--dispatch-id <id>', '배치받은 dispatch ID')
  .action(
    async (opts: {
      outcome: string;
      body: string;
      subject?: string;
      filesModified?: string;
      taskId?: string;
      dispatchId?: string;
    }) => {
      if (opts.outcome !== 'succeeded' && opts.outcome !== 'failed') {
        process.stderr.write('--outcome은 succeeded 또는 failed여야 합니다.\n');
        process.exitCode = 2;
        return;
      }
      process.exitCode = await workerDone({
        outcome: opts.outcome,
        body: opts.body,
        ...(opts.subject ? { subject: opts.subject } : {}),
        ...(opts.filesModified
          ? { filesModified: opts.filesModified.split(',').map((s) => s.trim()).filter(Boolean) }
          : {}),
        ...(opts.taskId ? { taskId: opts.taskId } : {}),
        ...(opts.dispatchId ? { dispatchId: opts.dispatchId } : {}),
      });
    },
  );

worker
  .command('ask')
  .description('코디네이터에게 질문하고 답이 올 때까지 기다린다')
  .requiredOption('--question <text>', '질문')
  .option('--options <list>', '쉼표로 구분한 선택지')
  .option('--timeout-ms <ms>', '대기 시간', '600000')
  .action(async (opts: { question: string; options?: string; timeoutMs: string }) => {
    process.exitCode = await workerAsk({
      question: opts.question,
      timeoutMs: Number(opts.timeoutMs),
      ...(opts.options
        ? { options: opts.options.split(',').map((s) => s.trim()).filter(Boolean) }
        : {}),
    });
  });

worker
  .command('escalate')
  .description('완료 전에 막힌 상황을 알린다')
  .requiredOption('--subject <text>', '막힌 이유')
  .requiredOption('--body <text>', '상세')
  .option('--task-id <id>')
  .option('--dispatch-id <id>')
  .action(
    async (opts: { subject: string; body: string; taskId?: string; dispatchId?: string }) => {
      process.exitCode = await workerEscalate({
        subject: opts.subject,
        body: opts.body,
        ...(opts.taskId ? { taskId: opts.taskId } : {}),
        ...(opts.dispatchId ? { dispatchId: opts.dispatchId } : {}),
      });
    },
  );

worker
  .command('heartbeat')
  .description('생존 신호. 진행의 증거는 아니다')
  .option('--phase <text>', 'investigating | implementing | reviewing | waiting', 'working')
  .action(async (opts: { phase: string }) => {
    process.exitCode = await workerHeartbeat(opts.phase);
  });

worker
  .command('check')
  .description('코디네이터의 후속 지시를 확인한다')
  .option('--task-id <id>')
  .option('--dispatch-id <id>')
  .action(async () => {
    process.exitCode = await workerCheck();
  });

await program.parseAsync(process.argv);
