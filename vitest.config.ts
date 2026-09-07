import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 테스트는 tests/ 에만 있다. eval/tasks/*/files/ 아래의 *.test.mjs는
    // 평가용 저장소 픽스처의 일부이지 우리 테스트가 아니다 — 채점표가
    // worktree 안에서 node로 직접 실행한다.
    include: ['tests/**/*.test.ts'],
  },
});
