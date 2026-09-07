import { createInterface } from 'node:readline/promises';
import type { WorkerMessage } from '../protocol/orchestration.js';
import { readNewMessages, writeReply } from '../store/run-store.js';

export interface CoordinatorOptions {
  runDir: string;
  /** 이 배치의 메시지만 처리한다. 다른 시도의 늦은 메시지는 무시한다. ADR-8 */
  dispatchId: string;
  /** 화면 출력. run 커맨드가 소유한다. */
  render: (text: string) => void;
  /**
   * 질문에 답하는 방법.
   * 사람이 붙어 있으면 터미널로 묻고, 아니면 정해진 문구로 자동 응답한다.
   */
  answerMode: 'human' | 'auto';
  /** answerMode가 'auto'일 때 보낼 답. */
  autoAnswer?: string;
  /**
   * 질문에 답하는 방법을 갈아끼운다.
   *
   * 터미널은 readline으로 묻지만, 웹 UI는 브라우저에 질문을 띄우고
   * 사용자가 입력할 때까지 기다린다. 답을 못 받으면 null을 돌려주고,
   * 그러면 자동 응답으로 떨어진다.
   */
  askHuman?: (question: PendingQuestion) => Promise<string | null>;
  pollIntervalMs?: number;
}

/** 사람에게 넘길 질문. */
export interface PendingQuestion {
  messageId: string;
  question: string;
  options: string[];
}

export interface Completion {
  outcome: 'succeeded' | 'failed';
  body: string;
  subject?: string;
  filesModified?: string[];
}

const DEFAULT_AUTO_ANSWER =
  '이 실행에는 답할 사람이 없습니다. 합리적인 가정을 세워 진행하고, ' +
  '그 가정을 worker done 본문에 명시하세요.';

/**
 * 워커가 보낸 메시지를 받아 처리하는 코디네이터 측 루프.
 *
 * 워커와 오케스트레이터는 별개 프로세스라 파일로 주고받는다.
 * 인터럽트가 없는 구조라, 이쪽에서 주기적으로 들여다본다.
 */
export class Coordinator {
  private readonly seen = new Set<string>();
  private timer: NodeJS.Timeout | undefined;
  private draining = false;
  private stopped = false;

  private completionValue: Completion | undefined;
  private readonly escalationList: WorkerMessage[] = [];
  private questionCount = 0;

  constructor(private readonly opts: CoordinatorOptions) {}

  get completion(): Completion | undefined {
    return this.completionValue;
  }

  get escalations(): readonly WorkerMessage[] {
    return this.escalationList;
  }

  get questionsAnswered(): number {
    return this.questionCount;
  }

  start(): void {
    const interval = this.opts.pollIntervalMs ?? 600;
    this.timer = setInterval(() => void this.drain(), interval);
    // 이 타이머 때문에 프로세스가 살아 있으면 안 된다.
    this.timer.unref?.();
  }

  /** 폴링을 멈추고, 워커가 마지막 순간에 남긴 메시지까지 마저 처리한다. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;

    // 진행 중이던 drain이 끝나기를 기다린 뒤 한 번 더 훑는다.
    while (this.draining) await new Promise((r) => setTimeout(r, 50));
    await this.drain(true);
  }

  private async drain(final = false): Promise<void> {
    if (this.draining) return;
    if (this.stopped && !final) return;
    this.draining = true;

    try {
      const messages = await readNewMessages(this.opts.runDir, this.seen);
      for (const message of messages) {
        // 다른 Dispatch의 메시지는 이 실행과 무관하다.
        if (message.dispatchId !== this.opts.dispatchId) continue;
        await this.handle(message);
      }
    } catch {
      // 폴링 실패로 실행 전체를 죽이지 않는다. 다음 주기에 다시 시도한다.
    } finally {
      this.draining = false;
    }
  }

  private async handle(message: WorkerMessage): Promise<void> {
    switch (message.type) {
      case 'worker_done':
        // 정확히 한 번이어야 한다. 두 번째는 무시하고 알린다.
        if (this.completionValue) {
          this.opts.render(`\n  ! 중복 worker_done 무시됨 (${message.id})\n`);
          return;
        }
        this.completionValue = {
          outcome: message.outcome ?? 'failed',
          body: message.body ?? '',
          ...(message.subject ? { subject: message.subject } : {}),
          ...(message.filesModified ? { filesModified: message.filesModified } : {}),
        };
        return;

      case 'escalation':
        this.escalationList.push(message);
        this.opts.render(
          `\n  ⚑ 에스컬레이션: ${message.subject ?? ''}\n    ${message.body ?? ''}\n`,
        );
        return;

      case 'question':
        await this.answer(message);
        return;

      case 'heartbeat':
        // 하트비트는 생존만 증명한다. 진행의 증거가 아니므로 조용히 넘긴다.
        return;

      default:
        return;
    }
  }

  private async answer(message: WorkerMessage): Promise<void> {
    this.questionCount += 1;
    const question = message.body ?? '';
    const options = message.options ?? [];

    if (this.opts.answerMode === 'auto') {
      const body = this.opts.autoAnswer ?? DEFAULT_AUTO_ANSWER;
      await writeReply(this.opts.runDir, {
        messageId: message.id,
        body,
        source: 'auto',
        createdAt: new Date().toISOString(),
      });
      this.opts.render(`\n  ? 워커 질문: ${question}\n    → 자동 응답\n`);
      return;
    }

    // 답을 받는 경로는 갈아끼울 수 있다. 터미널은 readline, 웹 UI는 브라우저.
    const pending: PendingQuestion = { messageId: message.id, question, options };
    const answered = this.opts.askHuman
      ? await this.opts.askHuman(pending)
      : await askOnTerminal(pending, this.opts.render);

    const source: 'human' | 'auto' = answered === null ? 'auto' : 'human';
    // 빈 답을 그대로 보내면 워커가 해석에 곤란해진다. 명시적으로 알린다.
    const body =
      answered === null
        ? (this.opts.autoAnswer ?? DEFAULT_AUTO_ANSWER)
        : answered || '특별한 제약 없음. 판단해서 진행하세요.';

    if (source === 'auto') this.opts.render('\n    (입력이 없어 자동 응답)\n');

    await writeReply(this.opts.runDir, {
      messageId: message.id,
      body,
      source,
      createdAt: new Date().toISOString(),
    });
    this.opts.render('\n');
  }
}

/**
 * 터미널에서 사람에게 묻는다. 기본 동작.
 *
 * stdin이 EOF면 null을 돌려준다 — 답할 사람이 없다는 뜻이고,
 * 여기서 멈추면 워커가 타임아웃까지 대기하게 된다.
 */
async function askOnTerminal(
  pending: PendingQuestion,
  render: (text: string) => void,
): Promise<string | null> {
  render(`\n\n  ? 워커가 질문했습니다\n    ${pending.question}\n`);
  if (pending.options.length > 0) {
    render(`    선택지: ${pending.options.join(' / ')}\n`);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question('    답변> ')).trim();
  } catch {
    return null;
  } finally {
    rl.close();
  }
}
