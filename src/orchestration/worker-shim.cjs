'use strict';

// Intentionally dependency-free. This file runs inside coding-provider sandboxes,
// where loading the full CLI (and tsx) may fail while querying OS user/temp state.
const fs = require('node:fs/promises');
const path = require('node:path');

const ENV = {
  runDir: 'CONDUCTOR_RUN_DIR',
  runId: 'CONDUCTOR_RUN_ID',
  taskId: 'CONDUCTOR_TASK_ID',
  dispatchId: 'CONDUCTOR_DISPATCH_ID',
  worker: 'CONDUCTOR_WORKER',
};

function identity() {
  const value = {
    runDir: process.env[ENV.runDir],
    runId: process.env[ENV.runId],
    taskId: process.env[ENV.taskId],
    dispatchId: process.env[ENV.dispatchId],
    workerHandle: process.env[ENV.worker],
  };
  if (Object.values(value).some((item) => !item)) {
    process.stderr.write(
      'conductor worker 명령은 배치된 워커 안에서만 쓸 수 있습니다.\n' +
      '(CONDUCTOR_RUN_DIR 등 환경변수가 없습니다. `conductor run --protocol`로 시작된 세션인지 확인하세요.)\n',
    );
    return null;
  }
  return value;
}

function parseFlags(args) {
  const flags = Object.create(null);
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = args[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = 'true';
    }
  }
  return flags;
}

function messageId() {
  return `msg_${Date.now().toString(36)}${process.pid.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function writeAtomic(file, text) {
  const temporary = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await fs.writeFile(temporary, text, 'utf8');
  await fs.rename(temporary, file);
}

async function appendMessage(id, values) {
  const directory = path.join(id.runDir, 'messages');
  await fs.mkdir(directory, { recursive: true });
  const message = {
    ...values,
    id: messageId(),
    createdAt: new Date().toISOString(),
  };
  await writeAtomic(
    path.join(directory, `${message.id}.json`),
    JSON.stringify(message, null, 2),
  );
  return message;
}

function baseMessage(id, type) {
  return {
    type,
    runId: id.runId,
    taskId: id.taskId,
    dispatchId: id.dispatchId,
    from: id.workerHandle,
  };
}

function idsMatch(id, flags) {
  if (flags['task-id'] && flags['task-id'] !== id.taskId) return false;
  if (flags['dispatch-id'] && flags['dispatch-id'] !== id.dispatchId) return false;
  return true;
}

function rejectMismatch() {
  process.stderr.write(
    '전달된 task-id/dispatch-id가 현재 배치와 일치하지 않습니다. 보고를 기록하지 않았습니다.\n',
  );
  return 2;
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function waitForReply(id, message, timeoutMs) {
  const replyFile = path.join(id.runDir, 'replies', `${message.id}.json`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const reply = await readJson(replyFile);
    if (reply) return reply;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

async function done(id, flags) {
  if (!idsMatch(id, flags)) return rejectMismatch();
  if (flags.outcome !== 'succeeded' && flags.outcome !== 'failed') {
    process.stderr.write('--outcome은 succeeded 또는 failed여야 합니다.\n');
    return 2;
  }
  const body = flags.body || '';
  if (!body.trim()) {
    process.stderr.write('--body는 비울 수 없습니다. 3문장 요약을 넣으세요.\n');
    return 2;
  }
  const filesModified = (flags['files-modified'] || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  await appendMessage(id, {
    ...baseMessage(id, 'worker_done'),
    outcome: flags.outcome,
    body,
    ...(flags.subject ? { subject: flags.subject } : {}),
    ...(filesModified.length ? { filesModified } : {}),
  });
  process.stdout.write(`완료 보고를 기록했습니다 (${flags.outcome}). 이 작업에서 당신의 차례는 끝났습니다.\n`);
  return 0;
}

async function ask(id, flags) {
  const question = flags.question || '';
  if (!question.trim()) {
    process.stderr.write('--question은 비울 수 없습니다.\n');
    return 2;
  }
  const options = (flags.options || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const message = await appendMessage(id, {
    ...baseMessage(id, 'question'),
    body: question,
    ...(options.length ? { options } : {}),
  });
  const parsedTimeout = Number(flags['timeout-ms'] || 600000);
  const timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 600000;
  const reply = await waitForReply(id, message, timeoutMs);
  if (!reply) {
    process.stderr.write(
      `질문에 대한 답을 ${Math.round(timeoutMs / 1000)}초 안에 받지 못했습니다 (${message.id}).\n` +
      '같은 질문을 다시 만들지 말고, 가정을 세워 진행한 뒤 그 가정을 worker done 본문에 적으세요.\n',
    );
    return 1;
  }
  process.stdout.write(`${reply.body}\n`);
  return 0;
}

async function escalate(id, flags) {
  if (!idsMatch(id, flags)) return rejectMismatch();
  if (!flags.subject || !flags.body) {
    process.stderr.write('escalate에는 --subject와 --body가 필요합니다.\n');
    return 2;
  }
  await appendMessage(id, {
    ...baseMessage(id, 'escalation'),
    subject: flags.subject,
    body: flags.body,
  });
  process.stdout.write('에스컬레이션을 기록했습니다.\n');
  return 0;
}

async function heartbeat(id, flags) {
  await appendMessage(id, {
    ...baseMessage(id, 'heartbeat'),
    phase: flags.phase || 'working',
  });
  return 0;
}

async function check(id) {
  let files = [];
  try {
    files = await fs.readdir(path.join(id.runDir, 'messages'));
  } catch {
    // A fresh run may not have any messages yet.
  }
  let escalations = 0;
  for (const file of files) {
    if (!file.endsWith('.json') || file.endsWith('.tmp')) continue;
    const message = await readJson(path.join(id.runDir, 'messages', file));
    if (message?.dispatchId === id.dispatchId && message?.type === 'escalation') {
      escalations += 1;
    }
  }
  process.stdout.write(
    escalations === 0
      ? '새 지시 없음. 계속 진행하세요.\n'
      : `미결 에스컬레이션 ${escalations}건이 있습니다.\n`,
  );
  return 0;
}

async function main() {
  const [group, action, ...rest] = process.argv.slice(2);
  if (group !== 'worker') {
    process.stderr.write('경량 shim은 conductor worker 명령만 처리합니다.\n');
    return 2;
  }
  const id = identity();
  if (!id) return 2;
  const flags = parseFlags(rest);
  if (action === 'done') return done(id, flags);
  if (action === 'ask') return ask(id, flags);
  if (action === 'escalate') return escalate(id, flags);
  if (action === 'heartbeat') return heartbeat(id, flags);
  if (action === 'check') return check(id);
  process.stderr.write(`알 수 없는 worker 명령: ${action || '(없음)'}\n`);
  return 2;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  });
