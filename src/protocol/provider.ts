/**
 * 지원 벤더 식별자.
 *
 * 여기에 추가하면 registry가 어댑터를 요구하므로, 타입 에러가 곧 체크리스트가 된다.
 */
export const PROVIDERS = ['claude', 'antigravity', 'gemini', 'codex'] as const;

export type Provider = (typeof PROVIDERS)[number];

/** 헤드리스 실행에서 요구할 실행 모드. 어댑터가 벤더별 플래그로 번역한다. */
export type ExecutionMode =
  /** 읽기 전용. 파일을 고치지 않고 조사·설계만 한다. */
  | 'plan'
  /** 워크스페이스 내 편집 허용. 승인 프롬프트 없이 진행. */
  | 'write';

/** 오케스트레이터가 어댑터에 넘기는 실행 요청. M1에서 필드가 늘어난다. */
export interface TaskRequest {
  /** 워커에게 줄 프롬프트 본문. */
  prompt: string;
  /** 실행 모드. 어댑터가 벤더 플래그로 번역한다. */
  mode: ExecutionMode;
  /** 벤더 고유 모델 식별자. 미지정 시 각 CLI 기본값. */
  model?: string;
  /** 이어갈 대화 ID. 미지정 시 새 세션. */
  resumeId?: string;
  /** 실행 디렉토리(worktree 경로). */
  cwd: string;
  /**
   * 워커 컨텍스트 격리. 기본 true.
   *
   * 워커가 호스트 프로젝트의 CLAUDE.md·MCP 서버·스킬·설정을 상속하지 않게 한다.
   * 끄면 claude 기준 1회 호출 비용이 실측 7.7배로 뛴다. SPEC §5.2
   */
  isolate?: boolean;
  /**
   * 무인 실행에서 도구 승인 프롬프트를 자동 승인한다. 기본 false.
   *
   * 헤드리스에는 승인할 사람이 없다. 벤더에 따라 이걸 켜지 않으면 도구가 전부
   * 거부되고, agy는 그 상태에서도 status=SUCCESS로 보고한다(조용한 실패).
   *
   * 안전 경계는 프롬프트가 아니라 **워크스페이스 격리**(M4의 worktree)여야 한다.
   * 격리 없이 켜면 워커가 호스트 파일시스템에 그대로 손을 댄다.
   */
  autoApprove?: boolean;
  /**
   * 워커 프로세스에 추가로 넣을 환경변수.
   *
   * 워커 협약의 정체성(run/task/dispatch ID)이 이 경로로 전달된다.
   * 자격증명은 절대 넣지 않는다. SPEC §9.1
   */
  env?: Record<string, string>;
  /**
   * 워커가 작업 디렉토리 밖에서 반드시 써야 하는 경로.
   *
   * 워커 협약의 run 디렉토리가 여기 들어간다. 워커가 완료를 보고하려면
   * 그 디렉토리에 메시지 파일을 써야 하기 때문이다.
   *
   * 샌드박스가 있는 provider(codex)만 이걸 신경 쓴다.
   */
  writableDirs?: string[];
}
