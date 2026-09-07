import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { PendingQuestion } from '../orchestration/coordinator.js';

/**
 * 브라우저로 흘려보낼 이벤트.
 *
 * 정규화 AgentEvent를 그대로 쓰지 않는 이유: 화면은 "어느 Task의 무슨 일인지"를
 * 알아야 하고, 질문·완료처럼 AgentEvent에 없는 것도 실어야 한다.
 */
export type UiEvent =
  | { type: 'log'; text: string }
  | { type: 'task.start'; taskId: string; provider: string; reason: string }
  | { type: 'task.end'; taskId: string; state: string; note?: string; files: number }
  | { type: 'failover'; taskId: string; from: string; to: string; reason: string }
  | { type: 'question'; questionId: string; question: string; options: string[] }
  | { type: 'question.answered'; questionId: string }
  | { type: 'usage'; costUsd?: number; inputTokens: number; outputTokens: number }
  | { type: 'done'; ok: boolean; summary: unknown }
  | { type: 'error'; message: string };

interface PendingAnswer {
  question: PendingQuestion;
  resolve: (answer: string | null) => void;
}

export interface RunRecord {
  id: string;
  kind: 'run' | 'plan';
  label: string;
  startedAt: number;
  finishedAt?: number;
  ok?: boolean;
  /** 지금까지의 이벤트. 늦게 접속한 브라우저도 처음부터 볼 수 있게 보관한다. */
  events: UiEvent[];
  emitter: EventEmitter;
  controller: AbortController;
  pending: Map<string, PendingAnswer>;
}

/** 이벤트 보관 상한. 긴 실행에서 메모리를 무한정 먹지 않게 한다. */
const EVENT_CAP = 2_000;

/**
 * 진행 중인 실행을 들고 있는다.
 *
 * 서버 프로세스 안에만 존재한다. 서버가 죽으면 사라진다 —
 * 실행 기록 자체는 `.conductor/runs/`에 파일로 남으므로 잃는 건 화면 상태뿐이다.
 */
export class RunRegistry {
  private readonly runs = new Map<string, RunRecord>();

  create(kind: RunRecord['kind'], label: string): RunRecord {
    const record: RunRecord = {
      id: randomUUID(),
      kind,
      label,
      startedAt: Date.now(),
      events: [],
      emitter: new EventEmitter(),
      controller: new AbortController(),
      pending: new Map(),
    };
    // 구독자가 없어도 emit이 터지지 않게 한다.
    record.emitter.setMaxListeners(0);
    this.runs.set(record.id, record);
    return record;
  }

  get(id: string): RunRecord | undefined {
    return this.runs.get(id);
  }

  list(): RunRecord[] {
    return [...this.runs.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  emit(id: string, event: UiEvent): void {
    const record = this.runs.get(id);
    if (!record) return;

    record.events.push(event);
    if (record.events.length > EVENT_CAP) record.events.splice(0, record.events.length - EVENT_CAP);
    record.emitter.emit('event', event);
  }

  finish(id: string, ok: boolean, summary: unknown): void {
    const record = this.runs.get(id);
    if (!record) return;

    record.finishedAt = Date.now();
    record.ok = ok;

    // 아직 답을 기다리는 질문이 있으면 풀어준다. 안 그러면 워커가 타임아웃까지 멈춘다.
    for (const [, pending] of record.pending) pending.resolve(null);
    record.pending.clear();

    this.emit(id, { type: 'done', ok, summary });
  }

  /**
   * 워커의 질문을 브라우저로 넘기고 답을 기다린다.
   *
   * 사용자가 답하지 않으면 여기서 계속 기다린다. 워커 쪽 `ask`에 타임아웃이
   * 걸려 있으므로(기본 10분) 영원히 멈추지는 않는다.
   */
  askUi(id: string, question: PendingQuestion): Promise<string | null> {
    const record = this.runs.get(id);
    if (!record) return Promise.resolve(null);

    return new Promise<string | null>((resolve) => {
      record.pending.set(question.messageId, { question, resolve });
      this.emit(id, {
        type: 'question',
        questionId: question.messageId,
        question: question.question,
        options: question.options,
      });
    });
  }

  /** 브라우저가 답을 보냈다. */
  answer(id: string, questionId: string, body: string): boolean {
    const record = this.runs.get(id);
    const pending = record?.pending.get(questionId);
    if (!record || !pending) return false;

    record.pending.delete(questionId);
    pending.resolve(body);
    this.emit(id, { type: 'question.answered', questionId });
    return true;
  }

  cancel(id: string): boolean {
    const record = this.runs.get(id);
    if (!record || record.finishedAt !== undefined) return false;
    record.controller.abort();
    return true;
  }

  /** 답을 기다리는 질문 목록. 브라우저가 새로고침해도 복구할 수 있게. */
  pendingQuestions(id: string): PendingQuestion[] {
    const record = this.runs.get(id);
    return record ? [...record.pending.values()].map((p) => p.question) : [];
  }
}
