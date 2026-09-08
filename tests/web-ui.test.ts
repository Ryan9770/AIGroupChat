import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

const PAGE = 'src/ui/web/index.html';

function inlineScript(html: string): string {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match?.[1]) throw new Error('인라인 <script> 블록을 찾지 못했습니다');
  return match[1];
}

/**
 * 웹 UI는 빌드 단계가 없어서 문법 오류를 잡아주는 게 아무것도 없다.
 *
 * 실제로 정규식 이스케이프가 깨져 `/\/g`가 되면서 스크립트 전체가 파싱에 실패했고,
 * **페이지가 통째로 죽은 채로 커밋됐다.** 브라우저를 열어보기 전까지 아무도 몰랐다.
 * 그 부류를 여기서 잡는다.
 */
describe('웹 UI 페이지', () => {
  const html = readFileSync(PAGE, 'utf8');

  it('인라인 스크립트가 문법적으로 유효하다', () => {
    // 실행하지 않고 파싱만 한다. DOM이 없어도 문법 오류는 잡힌다.
    expect(() => new Script(inlineScript(html))).not.toThrow();
  });

  it('페이지가 참조하는 element id가 실제로 존재한다', () => {
    const script = inlineScript(html);
    const referenced = new Set(
      [...script.matchAll(/\$\('([A-Za-z][\w-]*)'\)/g)].map((m) => m[1]!),
    );
    const defined = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]!));

    const missing = [...referenced].filter((id) => !defined.has(id));
    expect(missing, `없는 id를 참조하고 있습니다: ${missing.join(', ')}`).toEqual([]);
  });

  it('토큰을 URL 프래그먼트에서 읽는다', () => {
    // 쿼리스트링에 실으면 서버 로그·리퍼러에 남는다.
    expect(inlineScript(html)).toContain('location.hash');
  });

  it('모든 API 호출이 토큰 헤더를 거친다', () => {
    const script = inlineScript(html);
    // fetch를 직접 부르는 곳이 있으면 토큰 없이 요청이 나갈 수 있다.
    const directFetches = [...script.matchAll(/(?<!async function api[\s\S]{0,200})\bfetch\(/g)];
    expect(script).toContain('x-conductor-token');
    // api() 헬퍼 안의 fetch 하나만 있어야 한다.
    expect(directFetches.length).toBeLessThanOrEqual(1);
  });

  it('사용자 입력을 이스케이프해서 넣는다', () => {
    // 워커 출력·파일명·질문이 그대로 innerHTML에 들어가면 페이지가 깨지거나
    // 스크립트가 실행될 수 있다. 산출물은 신뢰할 수 없는 데이터다.
    expect(inlineScript(html)).toMatch(/const esc = /);
  });

  it('설치된 어떤 provider든 계획의 팀장과 수행 모델로 선택할 수 있다', () => {
    const script = inlineScript(html);

    expect(html).toContain('id="teamLeader"');
    expect(html).toContain('id="teamWorker"');
    expect(html).toContain('id="applyTeamPreset"');
    expect(html).not.toContain('id="presetClaudeLeads"');
    expect(script).toContain("const leader = $('teamLeader').value");
    expect(script).toContain('design: withFallback(leader)');
    expect(script).toContain('review: withFallback(leader)');
    expect(script).toContain('implement: withFallback(worker)');
  });
});
