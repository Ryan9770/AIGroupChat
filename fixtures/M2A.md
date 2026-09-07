# M2a fixtures

- `codex.read.jsonl`: Codex CLI 0.153.4 / `gpt-5.4-mini`, 2026-09-07 실제 읽기 전용 호출. 세션 ID와 로컬 실행 경로만 익명화. 통계는 원래 값이다.
- `codex.failed.jsonl`: 같은 날 기본 모델 `gpt-5.2-codex`가 계정에서 지원되지 않아 실패한 실제 출력. 세션 ID만 익명화.
- `gemini.reference.jsonl`: **실제 호출 출력이 아닌 합성 픽스처**. 설치된 `@google/gemini-cli` 0.57.0의 `gemini-PSRJNVY5.js` 및 `chunk-7HKQGPWB.js`에서 `StreamJsonFormatter`와 헤드리스 이벤트 생성 코드를 확인해 작성했다. 통계는 테스트용 값이다. Google 로그인 인증 취소(exit 130)로 성공 실행 검증은 보류 상태다.

공식 문서: [Codex 비대화형 모드](https://learn.chatgpt.com/docs/non-interactive-mode), [Gemini 헤드리스 모드](https://geminicli.com/docs/cli/headless/).

실제 원시 로그는 `.conductor/captures/`에만 저장한다. 계정 정보·경로를 검토하고 익명화한 사본만 fixtures에 추가한다. `capture-fixture.ts`는 기존 파일을 덮어쓰지 않고 stdout/stderr를 별도로 보관하며 실패 종료 코드를 전달한다.
