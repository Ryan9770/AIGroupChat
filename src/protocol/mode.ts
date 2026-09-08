import { z } from 'zod';
import type { ExecutionMode, Provider } from './provider.js';

export interface ModeParams {
  files?: string;
  query?: string;
  spec?: string;
  context?: string;
  target?: string;
}

export interface ModeDefinition {
  readonly name: string;
  readonly description: string;
  readonly provider: Provider;
  readonly fallbacks: readonly Provider[];
  readonly mode: ExecutionMode;
  readonly buildPrompt: (params: ModeParams) => string;
}

export function buildBulkReaderPrompt(params: ModeParams): string {
  const target = params.files || params.target || '.';
  const queryPart = params.query ? `\n[집중 분석 질의]: ${params.query}` : '';

  return `당신은 대용량 파일 분석을 전담하는 전문 리더(bulk-reader) 워커입니다.
팀장(Leader) 모델이 컨텍스트와 토큰을 낭비하지 않도록, 소스코드를 분석해 압축된 요약본을 제공해야 합니다.

[분석 대상]: ${target}${queryPart}

규칙:
1. 파일의 소스코드 전문을 그대로 출력하지 마세요 (토큰 낭비 절대 금지).
2. 대상 파일들을 분석하여 다음 항목을 40줄 이내의 간결한 Markdown으로 작성하세요:
   - 주요 파일 목록 및 각 파일의 핵심 책임 (1~2줄 요약)
   - 핵심 인터페이스, 함수 시그니처, 주요 자료구조
   - 모듈 간 호출 관계 및 의존 흐름
   - 주의 깊게 보아야 할 제약이나 엣지 케이스
3. 팀장이 추가 질문 없이 바로 설계에 착수할 수 있도록 정제된 사실 위주로 보고하세요.`;
}

export function buildDraftWriterPrompt(params: ModeParams): string {
  const spec = params.spec || '요청받은 코드 초안을 작성하라.';
  const contextPart = params.context ? `\n[참고 컨텍스트/패턴]:\n${params.context}` : '';
  const targetPart = params.files ? `\n[대상 파일]: ${params.files}` : '';

  return `당신은 정형화된 코드 및 단위 테스트 생성을 전담하는 드래프트 라이터(draft-writer) 워커입니다.

[작업 명세]: ${spec}${targetPart}${contextPart}

규칙:
1. 기존 프로젝트의 컨벤션, 네이밍, 코딩 스타일을 엄격하게 준수하세요.
2. 불필요한 서론/결론이나 장황한 설명 없이 실제 코드 작성 및 수정에 집중하세요.
3. 작업이 완료되면 수정한 파일과 수행한 작업 요약을 3문장 이내로 간결히 보고하세요.`;
}

/**
 * 기본 내장 AiKA 모드 프리셋.
 * 기본 워커는 실측 검증된 antigravity(agy)를 사용하며, 필요 시 codex, claude로 대체된다.
 */
export const BUILTIN_MODES: Record<string, ModeDefinition> = {
  'bulk-reader': {
    name: 'bulk-reader',
    description: '대용량 파일들을 분석하여 핵심 구조, 시그니처, 의존성을 압축 요약본으로 추출 (antigravity 기반)',
    provider: 'antigravity',
    fallbacks: ['codex', 'claude'],
    mode: 'plan',
    buildPrompt: buildBulkReaderPrompt,
  },
  'draft-writer': {
    name: 'draft-writer',
    description: '기존 패턴을 참조하여 보일러플레이트, 단위 테스트, 모델 정의 등의 초안 작성 (antigravity 기반)',
    provider: 'antigravity',
    fallbacks: ['codex', 'claude'],
    mode: 'write',
    buildPrompt: buildDraftWriterPrompt,
  },
};

export const ModeParamSchema = z.object({
  files: z.string().optional(),
  query: z.string().optional(),
  spec: z.string().optional(),
  context: z.string().optional(),
  target: z.string().optional(),
});
