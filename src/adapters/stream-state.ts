import type { AgentEvent, ParseContext } from '../protocol/events.js';

interface StreamState {
  startedAt: number;
  text: string;
  finished: boolean;
  failed: boolean;
  calls: Set<string>;
  completed: Set<string>;
}

const states = new WeakMap<ParseContext, StreamState>();

export function streamState(context: ParseContext): StreamState {
  let state = states.get(context);
  if (!state) {
    state = {
      startedAt: Date.now(), text: '', finished: false, failed: false,
      calls: new Set(), completed: new Set(),
    };
    states.set(context, state);
  }
  return state;
}

export function providerError(message: string, fallback: string): Extract<AgentEvent, { kind: 'error' }> {
  let code = fallback;
  let retryable = false;
  if (/quota|rate.?limit|resource.exhausted|\b429\b/i.test(message)) code = 'rate_limited';
  else if (/permission|denied|not allowed/i.test(message)) code = 'permission_denied';
  else if (/unauthorized|authentication|not logged in|api.key|\b401\b/i.test(message)) code = 'authentication_required';
  else if (/overloaded|temporar|\b503\b|\b502\b|ECONNRESET|ETIMEDOUT/i.test(message)) {
    code = 'provider_unavailable';
    retryable = true;
  }
  return { kind: 'error', code, message, retryable };
}
