import { randomBytes } from 'node:crypto';
import { execa } from 'execa';
import { buildServer } from '../server/api.js';
import { bold, cyan, dim, green, yellow } from '../ui/format.js';

export interface UiOptions {
  port: number;
  cwd: string;
  /** 브라우저를 자동으로 열지 않는다. */
  noOpen: boolean;
}

/**
 * 로컬 웹 UI를 띄운다.
 *
 * 🔴 이 서버는 로컬에서 AI 에이전트를 실행한다 — **임의 명령 실행 능력이 있다.**
 * 그래서 두 가지를 건다.
 * 1. **127.0.0.1에만 바인딩.** 같은 네트워크의 다른 기기가 접근할 수 없다.
 * 2. **매 실행마다 새 토큰.** 로컬이라도 브라우저의 다른 탭이 이 서버에
 *    요청을 보낼 수 있다. 커스텀 헤더를 요구하면 프리플라이트가 걸려 막힌다.
 */
export async function ui(opts: UiOptions): Promise<number> {
  const token = randomBytes(24).toString('base64url');
  const app = buildServer({ token, defaultCwd: opts.cwd });

  try {
    await app.listen({ port: opts.port, host: '127.0.0.1' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`서버를 시작하지 못했습니다: ${message}\n`);
    if (message.includes('EADDRINUSE')) {
      process.stderr.write(`${dim(`포트 ${opts.port}이 사용 중입니다. --port로 다른 포트를 지정하세요.`)}\n`);
    }
    return 1;
  }

  const url = `http://127.0.0.1:${opts.port}/#${token}`;

  process.stdout.write(`\n${bold('conductor UI')}\n\n`);
  process.stdout.write(`  ${green(url)}\n\n`);
  process.stdout.write(`  ${dim('대상 폴더')} ${opts.cwd}\n`);
  process.stdout.write(`  ${dim('127.0.0.1에만 열려 있고, 토큰이 있어야 조작됩니다.')}\n`);
  process.stdout.write(`  ${yellow('종료하려면 Ctrl+C')}\n\n`);

  if (!opts.noOpen) {
    // Windows는 start, macOS는 open, 그 외는 xdg-open.
    const [bin, args] =
      process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : process.platform === 'darwin'
          ? ['open', [url]]
          : ['xdg-open', [url]];
    await execa(bin, args, { reject: false, windowsHide: true, stdio: 'ignore' }).catch(
      () => undefined,
    );
  }

  // Ctrl+C까지 살아 있는다.
  await new Promise<void>((resolve) => {
    const stop = () => {
      process.stdout.write(`\n${cyan('서버를 종료합니다.')}\n`);
      void app.close().then(resolve);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });

  return 0;
}
