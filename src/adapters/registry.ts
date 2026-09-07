import type { Provider } from '../protocol/provider.js';
import { PROVIDERS } from '../protocol/provider.js';
import { AntigravityAdapter } from './antigravity.js';
import { ClaudeAdapter } from './claude.js';
import { CodexAdapter } from './codex.js';
import { GeminiAdapter } from './gemini.js';
import type { AgentAdapter } from './types.js';

/**
 * Provider별 어댑터 레지스트리.
 *
 * Record<Provider, ...>로 선언했으므로 PROVIDERS에 값을 추가하면
 * 어댑터를 만들 때까지 타입체크가 실패한다. 빠뜨릴 수 없게 만드는 게 의도다.
 */
const REGISTRY: Record<Provider, AgentAdapter> = {
  claude: new ClaudeAdapter(),
  antigravity: new AntigravityAdapter(),
  gemini: new GeminiAdapter(),
  codex: new CodexAdapter(),
};

export function getAdapter(provider: Provider): AgentAdapter {
  return REGISTRY[provider];
}

export function allAdapters(): AgentAdapter[] {
  return PROVIDERS.map((p) => REGISTRY[p]);
}

export function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value);
}
