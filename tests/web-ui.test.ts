import { readFileSync } from 'node:fs';
import { Script, createContext, runInContext } from 'node:vm';
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
    expect(script).toContain("applyTeamSelection(['design', 'review']");
    expect(script).toContain("applyTeamSelection(['implement', 'custom']");
    expect(html).toContain('id="teamFallback"');
    expect(html).toContain('id="createTeamWorkflow"');
  });

  it('모델 토론 탭에서 토론자, 턴 수, 서기를 지정하고 실행한다', () => {
    const script = inlineScript(html);

    expect(html).toContain('data-tab="discussion"');
    expect(html).toContain('id="tab-discussion"');
    expect(html).toContain('id="discussionParticipants"');
    expect(html).toContain('id="discussionTurns"');
    expect(html).toContain('id="discussionScribe"');
    expect(html).toContain('id="discussionUsageInput"');
    expect(html).toContain('id="discussionUsageCost"');
    expect(html).toContain('id="discussionUsageProviders"');
    expect(script).toContain("api('/api/discussion/run'");
    expect(script).toContain("event.type === 'usage'");
    expect(script).toContain('addDiscussionUsageEvent(event)');
    expect(script).toContain("event.type === 'discussion.turn.end'");
    expect(script).toContain('event.truncated');
    expect(script).toContain('서기에는');
    expect(html).toContain('maxlength="120" data-discussion-index');
    expect(script).toContain('마지막 ${closingTurns}턴은');
    expect(script).toContain("event.type === 'discussion.summary.end'");
  });
});

// Execute the actual routing editor code: verify exported state, not just labels.
function teamEditor() {
  const html = readFileSync(PAGE, 'utf8');
  const script = inlineScript(html);
  const elements = new Map<string, any>();
  const element = (id: string) => {
    if (!elements.has(id)) {
      let markup = '';
      const el = {
        value: '', checked: false, textContent: '',
        focus() {}, querySelectorAll() { return []; },
        get innerHTML() { return markup; },
        set innerHTML(value: string) {
          markup = value;
          if (['teamLeader', 'teamWorker'].includes(id)) {
            const options = [...value.matchAll(/<option value="([^"]*)"([^>]*)>/g)];
            this.value = (options.find((m) => m[2]?.includes('selected')) || options[0])?.[1] || '';
          }
        },
      };
      elements.set(id, el);
    }
    return elements.get(id);
  };
  const context = createContext({
    $: element, esc: (s: unknown) => String(s), alert() {}, confirm: () => true,
    providers: ['claude', 'antigravity', 'codex'].map((provider) => ({ provider, installed: true, authed: true })),
  });
  runInContext(script.slice(script.indexOf('let tasks = [];'), script.indexOf('function syncPlanWarn()')), context);
  runInContext(script.slice(script.indexOf('function loadPlanTemplate(tpl)'), script.indexOf('const currentPlan =')), context);
  return {
    element,
    run: (code: string) => runInContext(code, context),
    state: () => JSON.parse(runInContext('JSON.stringify({ routes, tasks })', context)),
  };
}

describe('team routing editor behavior', () => {
  it('initializes exactly the visible team, including general work, without hidden fallback', () => {
    const ui = teamEditor();
    ui.run('renderTeamPresetOptions()');
    expect(ui.state().routes).toEqual({ design: ['codex'], review: ['codex'], implement: ['antigravity'], custom: ['antigravity'] });
    expect(ui.element('teamLeader').value).toBe('codex');
    ui.element('teamWorker').value = 'claude';
    ui.element('teamWorker').onchange();
    expect(ui.state().routes.custom).toEqual(['claude']);
    ui.run('renderTeamPresetOptions()');
    expect(ui.element('teamWorker').value).toBe('claude');
  });

  it('enables fallback explicitly and can return to selected-model-only routing', () => {
    const ui = teamEditor();
    ui.run('renderTeamPresetOptions()');
    ui.element('teamFallback').checked = true;
    ui.element('teamFallback').onchange();
    expect(ui.state().routes.design).toEqual(['codex', 'claude', 'antigravity']);
    ui.element('teamFallback').checked = false;
    ui.element('teamFallback').onchange();
    expect(ui.state().routes.design).toEqual(['codex']);
  });

  it('preserves imported exceptions, shows them, and does not inherit stale routes on import', () => {
    const ui = teamEditor();
    ui.run('renderTeamPresetOptions()');
    ui.run(`loadPlanTemplate({ objective: 'test', routes: { design: ['claude'] }, tasks: [{ id: 'x', role: 'custom', providers: ['codex'], spec: 'test' }] })`);
    expect(ui.element('teamLeader').value).toBe('');
    expect(ui.run('assignmentLabel(tasks[0])')).toContain('작업별 직접 지정: codex');
    ui.run(`loadPlanTemplate({ objective: 'second', tasks: [] })`);
    expect(ui.state().routes).toEqual({});
    ui.run('renderTeamPresetOptions()');
    expect(ui.state().routes).toEqual({});
  });

  it('keeps an unavailable selection visible instead of silently replacing it', () => {
    const ui = teamEditor();
    ui.run('renderTeamPresetOptions(); providers = providers.filter(p => p.provider !== "codex"); renderTeamPresetOptions()');
    expect(ui.state().routes.design).toEqual(['codex']);
    expect(ui.element('teamLeader').innerHTML).toContain('codex (사용 불가)');
  });

  it('creates an explicit three-step workflow with dependencies and context', () => {
    const ui = teamEditor();
    ui.run('renderTeamPresetOptions()');
    ui.element('planObjective').value = 'Build a puzzle';
    ui.element('createTeamWorkflow').onclick();
    const { tasks } = ui.state();
    expect(tasks.map((t: any) => t.role)).toEqual(['design', 'implement', 'review']);
    expect(tasks[1].dependsOn).toEqual(['design']);
    expect(tasks[2].dependsOn).toEqual(['implement']);
    expect(tasks[2].context).toEqual(['design', 'implement']);
    expect(tasks.every((t: any) => t.spec.includes('Build a puzzle'))).toBe(true);
    ui.element('addTask').onclick();
    expect(ui.state().tasks[3].role).toBe('implement');
  });
});
