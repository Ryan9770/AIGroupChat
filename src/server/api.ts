import Fastify, { type FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allAdapters, getAdapter } from '../adapters/registry.js';
import { loadConfig } from '../core/config.js';
import { DispatchConfigError, executeDispatch } from '../core/dispatch.js';
import { Governor } from '../core/governor.js';
import { DEFAULT_ROUTES, route } from '../core/router.js';
import { runPlan, SchedulerError } from '../core/scheduler.js';
import { Plan, topoOrder, validatePlan, type Routes } from '../protocol/plan.js';
import type { Provider } from '../protocol/provider.js';
import { createRun, newTaskId } from '../store/run-store.js';
import { git, findRepoRoot } from '../workspace/git.js';
import {
  collectChanges,
  listWorkspaces,
  removeWorkspace,
  WorkspaceError,
} from '../workspace/worktree.js';
import { RunRegistry, type UiEvent } from './run-registry.js';

const here = dirname(fileURLToPath(import.meta.url));
/** src/server → src, dist/server → dist */
const assetDir = join(dirname(here), 'ui', 'web');

export interface ApiOptions {
  /** 브라우저가 보내야 하는 토큰. 로컬이라도 다른 페이지의 요청을 막는다. */
  token: string;
  /** 기본 대상 디렉토리. */
  defaultCwd: string;
}

export function buildServer(opts: ApiOptions): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 2_000_000 });
  const registry = new RunRegistry();
  const governor = new Governor();

  /**
   * 이 서버는 로컬에서 AI 에이전트를 실행한다. 즉 **임의 명령 실행 능력이 있다.**
   * 127.0.0.1에만 바인딩해도 브라우저의 다른 탭이 요청을 보낼 수 있으므로,
   * 커스텀 헤더 토큰을 요구한다(프리플라이트가 걸려 단순 CSRF가 막힌다).
   */
  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'GET' && !request.url.startsWith('/api/')) return;
    if (request.url.startsWith('/api/events/')) {
      // SSE는 EventSource라 헤더를 못 붙인다. 쿼리로 받는다.
      const token = (request.query as { token?: string }).token;
      if (token !== opts.token) return reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    if (request.headers['x-conductor-token'] !== opts.token) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });

  // ── 정적 페이지 ────────────────────────────────────────────────────────
  app.get('/', async (_request, reply) => {
    const html = await readFile(join(assetDir, 'index.html'), 'utf8');
    return reply.type('text/html; charset=utf-8').send(html);
  });

  // ── 현황 ───────────────────────────────────────────────────────────────
  app.get('/api/status', async (request) => {
    const offline = (request.query as { offline?: string }).offline === '1';
    const providers = await Promise.all(allAdapters().map((a) => a.preflight(offline)));
    return {
      providers: providers.map((p) => ({
        provider: p.provider,
        bin: p.bin,
        installed: p.installed,
        version: p.version ?? null,
        authed: p.authed,
        summary: p.authSummary ?? null,
        notes: p.notes,
        availability: governor.availability(p.provider),
        commandPermission: getAdapter(p.provider).capability.commandPermission,
      })),
      routes: DEFAULT_ROUTES,
      defaultCwd: opts.defaultCwd,
    };
  });

  // ── 작업 공간 ──────────────────────────────────────────────────────────
  app.get('/api/workspaces', async (request) => {
    const cwd = resolve((request.query as { cwd?: string }).cwd ?? opts.defaultCwd);
    const workspaces = await listWorkspaces(cwd);
    const detailed = await Promise.all(
      workspaces.map(async (ws) => ({ ...ws, changes: await collectChanges(ws) })),
    );
    return { repoRoot: await findRepoRoot(cwd), workspaces: detailed };
  });

  app.get('/api/diff', async (request, reply) => {
    const { cwd, id } = request.query as { cwd?: string; id?: string };
    const workspaces = await listWorkspaces(resolve(cwd ?? opts.defaultCwd));
    const target = workspaces.find((w) => w.id === id);
    if (!target) return reply.code(404).send({ error: 'workspace not found' });

    const result = await git(
      ['-c', 'core.quotepath=false', 'diff', 'HEAD'],
      target.path,
    );
    return { diff: result.stdout, path: target.path, branch: target.branch };
  });

  app.post('/api/workspaces/remove', async (request, reply) => {
    const { cwd, id, force } = request.body as { cwd?: string; id: string; force?: boolean };
    const workspaces = await listWorkspaces(resolve(cwd ?? opts.defaultCwd));
    const target = workspaces.find((w) => w.id === id);
    if (!target) return reply.code(404).send({ error: 'workspace not found' });

    const changes = await collectChanges(target);
    if (changes.files.length > 0 && !force) {
      // 워커의 작업물을 말없이 날리지 않는다. 무엇을 지우는지 먼저 보여준다.
      return reply.code(409).send({ error: 'uncommitted', files: changes.files });
    }
    try {
      await removeWorkspace(target, { force: force === true });
    } catch (err) {
      const message = err instanceof WorkspaceError ? err.message : String(err);
      return reply.code(400).send({ error: message });
    }
    return { ok: true };
  });

  // ── 계획 미리보기 ──────────────────────────────────────────────────────
  app.post('/api/plan/preview', async (request, reply) => {
    const body = request.body as { plan?: unknown; cwd?: string };
    const parsed = Plan.safeParse(body.plan);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.') || '(root)',
          message: i.message,
        })),
      });
    }

    const plan = parsed.data;
    const loaded = await loadConfig(resolve(body.cwd ?? opts.defaultCwd));
    const routes = mergeRoutes(loaded.config.routes, plan.routes);
    const issues = validatePlan(plan);
    const available = await availableProviders();
    const byId = new Map(plan.tasks.map((t) => [t.id, t]));
    const assigned = new Map<string, Provider>();

    const rows = topoOrder(plan).map((id) => {
      const task = byId.get(id)!;
      const avoid = task.context
        .map((ref) => assigned.get(ref))
        .filter((p): p is Provider => p !== undefined);
      const explicit = Boolean(task.providers ?? routes?.[task.role]);
      const routed = route({
        role: task.role,
        available,
        explicit,
        ...(routes ? { routes } : {}),
        ...(task.providers ? { preferred: task.providers } : {}),
        ...(!explicit && avoid.length > 0 && task.role === 'review' ? { avoid } : {}),
      });
      if (routed) assigned.set(id, routed.provider);
      return {
        id: task.id,
        role: task.role,
        dependsOn: task.dependsOn,
        workspace: task.workspace,
        provider: routed?.provider ?? null,
        fallbacks: routed?.fallbacks ?? [],
        reason: routed?.reason ?? '쓸 수 있는 provider가 없습니다',
      };
    });

    return {
      issues,
      tasks: rows,
      available,
      routes: routes ?? null,
      configPath: loaded.path ?? null,
      configProblem: loaded.problem ?? null,
    };
  });

  // ── 실행 ───────────────────────────────────────────────────────────────
  app.post('/api/run', async (request, reply) => {
    const body = request.body as {
      agent: Provider;
      prompt: string;
      cwd?: string;
      mode?: 'plan' | 'write';
      workspace?: boolean;
      yolo?: boolean;
      protocol?: boolean;
      model?: string;
    };

    if (!body.prompt?.trim()) return reply.code(400).send({ error: '프롬프트가 비어 있습니다' });

    const cwd = resolve(body.cwd ?? opts.defaultCwd);
    const record = registry.create('run', body.prompt.slice(0, 60));
    const emit = (event: UiEvent) => registry.emit(record.id, event);

    // 요청을 붙잡아두지 않는다. 진행 상황은 SSE로 흘린다.
    void (async () => {
      try {
        const runDir = body.protocol
          ? (await createRun({ stateRoot: (await findRepoRoot(cwd)) ?? cwd, objective: body.prompt }))
              .runDir
          : undefined;

        const result = await executeDispatch({
          provider: body.agent,
          spec: body.prompt,
          mode: body.mode ?? 'plan',
          cwd,
          workspace: body.workspace ? { kind: 'new', label: `${body.agent}-${body.mode ?? 'plan'}` } : { kind: 'none' },
          isolate: true,
          autoApprove: body.yolo === true,
          protocol: body.protocol === true,
          answerMode: 'human',
          askHuman: (question) => registry.askUi(record.id, question),
          timeoutMs: 15 * 60_000,
          taskId: newTaskId(),
          attempt: 1,
          signal: record.controller.signal,
          ...(runDir ? { runDir } : {}),
          ...(body.model ? { model: body.model } : {}),
          observer: {
            onEvent: (event) => {
              governor.observeEvent(body.agent, event);
              if (event.kind === 'message.delta' || event.kind === 'message.final') {
                emit({ type: 'log', text: event.text });
              } else if (event.kind === 'tool.call') {
                const detail =
                  typeof event.input === 'string'
                    ? event.input
                    : typeof event.input === 'object' && event.input
                      ? (event.input as { command?: string; query?: string; path?: string }).command ??
                        (event.input as { query?: string }).query ??
                        (event.input as { path?: string }).path ??
                        ''
                      : '';
                emit({ type: 'log', text: `\n⚙ ${event.name}${detail ? `: ${detail.slice(0, 100)}` : ''}\n` });
              } else if (event.kind === 'tool.result' && event.summary) {
                emit({ type: 'log', text: `  ↳ ${event.summary.slice(0, 120)}\n` });
              } else if (event.kind === 'error') {
                emit({ type: 'log', text: `\n✗ [${event.code}] ${event.message}\n` });
              } else if (event.kind === 'usage') {
                emit({
                  type: 'usage',
                  inputTokens: event.inputTokens,
                  outputTokens: event.outputTokens,
                  ...(event.costUsd !== undefined ? { costUsd: event.costUsd } : {}),
                });
              }
            },
            onNotice: (text) => emit({ type: 'log', text: `\n${text}\n` }),
          },
        });

        governor.observeDispatch(body.agent);
        registry.finish(record.id, result.outcome === 'succeeded', {
          outcome: result.outcome,
          report: result.note ?? result.report,
          filesChanged: result.filesChanged,
          workspace: result.workspace
            ? { id: result.workspace.id, path: result.workspace.path }
            : null,
          durationMs: result.durationMs,
        });
      } catch (err) {
        const message =
          err instanceof DispatchConfigError
            ? `${err.message} — ${err.hint}`
            : err instanceof WorkspaceError
            ? `${err.message}${err.hint ? ` — ${err.hint}` : ''}`
            : err instanceof Error
              ? err.message
              : String(err);
        emit({ type: 'error', message });
        registry.finish(record.id, false, { error: message });
      }
    })();

    return { runId: record.id };
  });

  app.post('/api/plan/run', async (request, reply) => {
    const body = request.body as {
      plan: unknown;
      cwd?: string;
      yolo?: boolean;
      protocol?: boolean;
      budgetUsd?: number;
      maxAttempts?: number;
    };

    const parsed = Plan.safeParse(body.plan);
    if (!parsed.success) return reply.code(400).send({ error: '계획 형식이 올바르지 않습니다' });

    const plan = parsed.data;
    const cwd = resolve(body.cwd ?? opts.defaultCwd);
    const loaded = await loadConfig(cwd);
    if (loaded.problem) {
      return reply.code(400).send({ error: `설정 파일 문제 (${loaded.path}): ${loaded.problem}` });
    }
    const routes = mergeRoutes(loaded.config.routes, plan.routes);
    const available = await availableProviders();
    if (available.length === 0) {
      return reply.code(400).send({ error: '로그인된 provider가 없습니다' });
    }

    const record = registry.create('plan', plan.objective);
    const emit = (event: UiEvent) => registry.emit(record.id, event);

    void (async () => {
      try {
        const stateRoot = (await findRepoRoot(cwd)) ?? cwd;
        const { runDir } = await createRun({ stateRoot, objective: plan.objective });

        const outcomes = await runPlan({
          plan,
          runDir,
          cwd,
          available,
          ...(routes ? { routes } : {}),
          isolate: true,
          autoApprove: body.yolo === true,
          protocol: body.protocol !== false,
          answerMode: 'human',
          askHuman: (question) => registry.askUi(record.id, question),
          timeoutMs: 15 * 60_000,
          signal: record.controller.signal,
          governor,
          ...(body.maxAttempts ? { maxAttempts: body.maxAttempts } : {}),
          onTaskStart: (task, provider, reason) =>
            emit({ type: 'task.start', taskId: task.id, provider, reason }),
          onTaskEnd: (outcome) =>
            emit({
              type: 'task.end',
              taskId: outcome.taskId,
              state: outcome.state,
              files: outcome.result?.filesChanged.length ?? 0,
              ...(outcome.note ? { note: outcome.note } : {}),
            }),
          onFailover: (taskId, from, to, reason) =>
            emit({ type: 'failover', taskId, from, to, reason }),
          observerFor: () => ({
            onEvent: (event) => {
              if (event.kind === 'message.delta' || event.kind === 'message.final') {
                emit({ type: 'log', text: event.text });
              } else if (event.kind === 'tool.call') {
                const detail =
                  typeof event.input === 'string'
                    ? event.input
                    : typeof event.input === 'object' && event.input
                      ? (event.input as { command?: string; query?: string; path?: string }).command ??
                        (event.input as { query?: string }).query ??
                        (event.input as { path?: string }).path ??
                        ''
                      : '';
                emit({ type: 'log', text: `\n⚙ ${event.name}${detail ? `: ${detail.slice(0, 100)}` : ''}\n` });
              } else if (event.kind === 'tool.result' && event.summary) {
                emit({ type: 'log', text: `  ↳ ${event.summary.slice(0, 120)}\n` });
              }
            },
            onNotice: (text) => emit({ type: 'log', text: `\n${text}\n` }),
          }),
        });

        const failed = outcomes.filter((o) => o.state !== 'succeeded');
        registry.finish(record.id, failed.length === 0, {
          tasks: outcomes.map((o) => ({
            taskId: o.taskId,
            state: o.state,
            provider: o.provider ?? null,
            files: o.result?.filesChanged ?? [],
            workspace: o.result?.workspace?.id ?? null,
            attempts: o.attempts,
            note: o.note ?? null,
          })),
          costUsd: governor.totalCostUsd,
          quota: governor.snapshot(),
        });
      } catch (err) {
        const message = err instanceof SchedulerError ? err.message : String(err);
        emit({ type: 'error', message });
        registry.finish(record.id, false, { error: message });
      }
    })();

    return { runId: record.id };
  });

  // ── 실시간 이벤트 ──────────────────────────────────────────────────────
  app.get('/api/events/:runId', async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const record = registry.get(runId);
    if (!record) return reply.code(404).send({ error: 'run not found' });

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const send = (event: UiEvent) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);

    // 늦게 접속해도 처음부터 볼 수 있게 지금까지의 이벤트를 먼저 보낸다.
    for (const event of record.events) send(event);
    for (const question of registry.pendingQuestions(runId)) {
      send({
        type: 'question',
        questionId: question.messageId,
        question: question.question,
        options: question.options,
      });
    }

    if (record.finishedAt !== undefined) {
      reply.raw.end();
      return reply;
    }

    record.emitter.on('event', send);
    // 프록시·브라우저가 유휴 연결을 끊지 않게 주기적으로 주석을 보낸다.
    const keepalive = setInterval(() => reply.raw.write(': ping\n\n'), 20_000);

    request.raw.on('close', () => {
      clearInterval(keepalive);
      record.emitter.off('event', send);
    });

    return reply;
  });

  app.post('/api/answer', async (request, reply) => {
    const { runId, questionId, body } = request.body as {
      runId: string;
      questionId: string;
      body: string;
    };
    const ok = registry.answer(runId, questionId, body?.trim() || '판단해서 진행하세요.');
    return ok ? { ok: true } : reply.code(404).send({ error: 'question not found' });
  });

  app.post('/api/cancel', async (request) => {
    const { runId } = request.body as { runId: string };
    return { ok: registry.cancel(runId) };
  });

  return app;
}

/** 로그인까지 확인된 provider만 라우팅 후보로 삼는다. */
async function availableProviders(): Promise<Provider[]> {
  const results = await Promise.all(allAdapters().map((a) => a.preflight(false)));
  return results.filter((r) => r.installed && r.authed === true).map((r) => r.provider);
}

/** 설정 파일 담당 위에 계획 파일 담당을 덮어쓴다. */
function mergeRoutes(base?: Routes, override?: Routes): Routes | undefined {
  if (!base && !override) return undefined;
  return { ...(base ?? {}), ...(override ?? {}) };
}
