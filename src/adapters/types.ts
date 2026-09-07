import type { AgentEvent, ParseContext } from '../protocol/events.js';
import type { Provider, TaskRequest } from '../protocol/provider.js';

/** 어댑터가 조립한 실행 커맨드. Process Manager가 그대로 spawn한다. */
export interface Argv {
  bin: string;
  args: string[];
  env: Record<string, string>;
}

/** 벤더별 헤드리스 능력. doctor가 표로 보여주고, Router가 라우팅 판단에 쓴다. */
export interface HeadlessCapability {
  /** 비대화형 실행 플래그를 사람이 읽을 수 있게 요약. */
  readonly printFlag: string;
  /** NDJSON 스트리밍 출력을 지원하는가. */
  readonly streamJson: boolean;
  /** 결과를 JSON Schema로 강제할 수 있는가. */
  readonly structuredOutput: boolean;
  /** 멀티턴 방식. */
  readonly resume: 'stdin-stream' | 'respawn-with-id' | 'none';
  /**
   * 호출 시점에 MCP 서버를 주입할 수 있는가.
   * false면 사전 등록(전역 설정)이 필요하다 — M3 공유 버스 설계에 직결된다.
   */
  readonly mcpInjection: 'per-invocation' | 'pre-registered' | 'unknown';
  /**
   * 프롬프트를 어떻게 넘기는가.
   *
   * 🔴 Windows에서 npm이 깐 `.cmd` 심을 거치는 CLI(claude·gemini·codex)는
   * **인자 안의 줄바꿈에서 잘린다.** cmd.exe가 개행을 명령 종료로 보기 때문이다.
   * 게다가 exit 0으로 조용히 성공한 척한다(실측). 여러 줄 프롬프트를 쓰려면
   * 반드시 stdin으로 넘겨야 한다.
   *
   * 네이티브 실행 파일(agy.exe)은 개행이 보존되므로 argv로 넘겨도 된다.
   */
  readonly promptDelivery: 'argv' | 'stdin';
  /**
   * 특정 셸 명령만 골라 허용할 수 있는가.
   *
   * `granular`면 협약의 보고 명령만 열어줄 수 있다.
   * `all-or-nothing`이면 협약을 쓰려면 autoApprove(전면 승인)가 필요하다.
   */
  readonly commandPermission: 'granular' | 'all-or-nothing' | 'sandbox';
}

/** preflight 결과. 자격증명 값은 절대 담지 않는다. §9.1 */
export interface PreflightResult {
  provider: Provider;
  /** 실행 파일 이름(또는 PATH에서 찾을 이름). */
  bin: string;
  /** PATH에서 발견되었는가. */
  installed: boolean;
  /** 발견된 절대 경로. */
  path?: string;
  /** 버전 문자열. 파싱 실패 시 undefined. */
  version?: string;
  /**
   * 로그인 되어 있는가.
   * true/false는 확인된 결과, 'unknown'은 프로브 수단이 없거나 --offline인 경우.
   */
  authed: boolean | 'unknown';
  /** 인증 방식/플랜 등 비민감 요약. 이메일·토큰·조직 ID는 담지 않는다. */
  authSummary?: string;
  /** 사람이 읽을 조치 안내. */
  notes: string[];
}

export interface AgentAdapter {
  readonly provider: Provider;
  /** PATH에서 찾을 실행 파일 이름. */
  readonly bin: string;
  readonly capability: HeadlessCapability;

  /**
   * 설치·버전·로그인 여부 확인. doctor가 호출한다.
   * @param offline true면 네트워크를 타는 인증 프로브를 건너뛴다.
   */
  preflight(offline: boolean): Promise<PreflightResult>;

  /** 실행 인자 조립 — 벤더별 CLI 문법 차이를 여기서 전부 흡수한다. */
  buildArgv(req: TaskRequest): Argv;

  /**
   * 원시 stdout 한 줄 → 정규화 이벤트 0..n개.
   *
   * 한 줄이 여러 이벤트를 낳을 수 있다(예: claude의 result 한 줄에서
   * message.final + usage + session.finished가 나온다).
   * 파싱 실패나 미지 타입은 예외를 던지지 말고 `unknown`으로 흘려보낼 것. SPEC R3
   */
  parseLine(line: string, ctx: ParseContext): AgentEvent[];
}
