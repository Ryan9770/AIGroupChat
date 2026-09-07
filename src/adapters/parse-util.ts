/**
 * JSONL 한 줄을 객체로 파싱한다. 실패하면 null.
 *
 * 어댑터의 parseLine은 절대 예외를 던지면 안 된다. 벤더가 스트림 중간에
 * 예상 못 한 텍스트를 뱉어도 파이프라인이 죽지 않아야 한다. SPEC R3
 */
export function safeJson(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
