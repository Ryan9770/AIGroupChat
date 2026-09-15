# 14. 안티그래비티 작업 지시서 — 『강탈자들 (Revenant Run)』 프로덕트화

> 수신: Antigravity 에이전트
> 작성: 2026-09-14 · 기준 커밋: 워킹트리(`workspace/goingdark/` 전체 untracked 상태)
> 목적: 현재 플레이어블 프로토타입을 **출시 가능한(프로덕트급) 솔로 PvE 버티컬 슬라이스 → 얼리 액세스 빌드**로 끌어올린다.
> 이 문서 하나만 읽고 작업을 시작할 수 있도록 **현황 감사 · 부족한 점 · 단계별 작업 지시 · 무료 에셋 선정 · 완료 기준**을 모두 담았다.

---

## 0. 먼저 읽을 것 (작업 규칙)

### 0.1 작업 루트와 명령

- 게임 루트: `workspace/goingdark/game/` (Vite 5 + Canvas2D + Web Audio, Vanilla JS ESM)
- 실행: `cd workspace/goingdark/game && npm ci && npm run dev` → http://localhost:5173
- 검증 명령 (모든 작업 단위 끝에 반드시 실행, 전부 종료 코드 0):
  ```
  npm run build
  npm test
  npm run lint
  ```

### 0.2 원본 문서 우선순위 (충돌 시 위가 이긴다)

1. `00b_core_mechanics.md` — 수치 원본
2. `10_pve_revision.md` — v1→v2 정정 내역
3. `11_creative_direction.md` — 아트·오디오·UI·서사 총괄 기준 (**비주얼 판단은 전부 여기에 맞춘다**)
4. `12_roguelite_enhancement_plan.md` — 기술 고도화 설계와 G0~G5 수용 기준
5. `13_roguelite_enhancement_review.md` — 직전 검토 결과 (일부는 이미 해결됨, 아래 §2에서 재판정)
6. `01~04`, `07`, `08` — 세계관·대사·퀘스트·적·확장팩·경제
7. `05*`, `09` — **v1(PvPvE) 시절 기록. 신규 작업 근거로 사용 금지**

### 0.3 반드시 지킬 것

- **하드코딩 금지**: 수치·확률·색·에셋 경로는 `src/data/` 또는 에셋 매니페스트에서만 정의한다.
- **모든 게임 랜덤은 시드 RNG** (`src/core/rng.js`의 스트림)로. `Math.random()` 신규 사용 금지.
- **에셋 추가 시 즉시 `public/assets/LICENSES.md`에 출처·작가·버전·라이선스·URL·파일 목록을 기록**한다. 라이선스를 페이지에서 직접 확인하지 못한 에셋은 추가하지 않는다.
- CC-BY 계열 에셋은 **게임 내 크레딧 화면**에 표기한다(§6.4).
- 기존 테스트를 지우거나 약화시켜 통과시키지 않는다. 테스트가 틀렸다면 이유를 보고서에 적는다.
- "완료"는 기능 존재가 아니라 **수용 기준 통과**로만 판정한다. 검증하지 못한 항목은 "미검증"으로 보고한다.
- 한 태스크 = 한 커밋 단위. 커밋 메시지에 태스크 ID(예: `P0-03`)를 붙인다.

### 0.4 금지 사항

- 라이선스 불명·NC(비상업)·ND(변경금지)·"개인용 무료" 에셋 사용.
- AI 생성 이미지를 출처 기록 없이 섞는 것 (사용한다면 LICENSES.md에 도구와 생성일을 명시하고 스타일 가이드 통과 필수).
- 스타일이 다른 팩(16px 픽셀 + 고해상도 일러스트 + 3D 렌더)을 한 화면에 혼용.
- 코옵 넷코드, 7막 전체, 수익화/LiveOps 착수 (이번 범위 밖, §3.9).

---

## 1. 프로젝트 한눈에

| 항목 | 내용 |
|---|---|
| 한 줄 | 죽은 왕국을 삼킨 살아 있는 구멍에서, 욕심이 들키기 전에 유산을 훔쳐 나오는 PvE 익스트랙션 로그라이트 |
| 태그라인 | "구멍 밖으로 나온 것만 세상의 물건이다." |
| 코어 루프 | 거점 준비 → 1~5층 침입·약탈 → 시선(0~100)·조수(22/27/30분) 압박 → 18분 게이트 8초 충전 탈출 or 전량 로스트 → 환전(세관 10%)·강화 도박 |
| 비주얼 명제 | "왕국의 무덤이 아니라, 왕국을 아직 소화 중인 위장" — 장기 고딕(Visceral Gothic), 탑다운 3/4 |
| 현재 스택 | Vite 5, Canvas2D 도형 렌더, DOM HUD, Web Audio 합성음, localStorage 세이브, node:test 22개 |
| 목표 플랫폼 | PC (웹 빌드 → Electron/Tauri 래핑으로 Steam/itch 배포) |

---

## 2. 현재 상태 감사 (2026-09-14, 코드 직접 확인)

### 2.1 실행 검증 결과

| 항목 | 결과 |
|---|---|
| `npm run build` | ✅ 성공 (20 modules, JS 107.7 kB) |
| `npm test` | ✅ 22/22 통과 (8 suites) — 단, 통합 결함을 거의 잡지 못하는 수준 |
| `npm run lint` | ⚠️ "성공"이지만 실체는 `node --check` 문법 검사뿐 (ESLint 아님) |
| 브라우저 실행 | ✅ 콘솔 에러 0. 거점 → 던전 진입 → 이동 동작 |
| 화면 품질 | ❌ **던전은 원·사각형·선과 디버그 라벨("COMBAT" 등)로만 그려진다.** 스프라이트가 전혀 쓰이지 않음 |

### 2.2 이미 해결된 것 (재작업 불필요, 회귀 테스트만 보강)

- 13번 R1 역주행 무한 파밍 → `floorCache` + `awardedFloorXp`로 층 상태 보존 (`src/scenes/dungeon.js:101-138`, `806-826`)
- 13번 R4 일부 → 그래프 `worldW/worldH` 0 반환 문제 해결
- 13번 R5 출혈·경직 → `BaseEnemy.updateStatusEffects()`가 모든 적 `update`에서 호출됨 (`src/entities/enemies.js:50-78`)
- 13번 R7 일부 → 적 8종(광신도·망령·미믹 추가), 엘리트 3종, 저주 유물 8종, 방 이벤트 8종 데이터 존재
- 12번 P0 4건(소모품 효과, 탈출 즉시 환전, 4·5층 귀환, 감속 영구화) 수정 확인

### 2.3 미해결 결함 (우선순위순, 모두 이번 작업 대상)

| ID | 심각도 | 근거 (파일:라인) | 현상 |
|---|---|---|---|
| D-01 | **P0** | `src/systems/spriteAtlas.js` 전체 / `src/scenes/dungeon.js:19` | `spriteAtlas`를 import만 하고 **렌더에서 한 번도 호출하지 않음**. 0x72·Kenney 에셋이 폴더에만 있고 게임에 안 보임 |
| D-02 | **P0** | `src/systems/audioManager.js:33` | `preload()`가 어디에서도 호출되지 않아 `audioCache`가 비어 있음 → **OGG 효과음은 절대 재생되지 않고** 항상 합성음 폴백. 앰비언스만 파일 재생 |
| D-03 | **P0** | `src/main.js:18,37`, `src/scenes/hub.js:141,160,169,183,233,250,260,275,289` | `saveState()`가 `false`를 반환해도 무시 → 저장 실패 시 결과/구매/강화가 성공으로 표시되고 새로고침하면 사라짐 (13번 R3 미해결) |
| D-04 | P1 | `src/scenes/dungeon.js:1308-1309`, `1339-1340` | 벽·문 충돌과 LOS 없음. 플레이어/적이 층 전체 사각형에만 clamp → 방 그래프가 그림일 뿐 통과 가능 (13번 R6 미해결) |
| D-05 | P1 | 10,000시드 재검사 (시드 100000~109999, 층 1~5 순환) | 보물방 누락 **886건**, 탈출 후보 2개 미만 **10,000건**, 시작방-보스방 직접 인접 **38건** (13번 R4 잔존). 테스트는 자체 `validateGraph()`만 재호출해 통과 |
| D-06 | P1 | `src/main.js:66-74`, `src/scenes/hub.js:202,216` | 가변 RAF `dt`, 고정 스텝·`rulesVersion`·상태 해시 없음. 강화 도박은 `Math.random()` 직접 사용 → 재현·밸런스 시뮬레이션 불가 (13번 R2 잔존) |
| D-07 | P1 | `src/main.js:44`, `src/core/settlement.js:34` vs `src/scenes/hub.js:153` | 결과 화면은 항상 "세관 10%", 실제 환전은 `customs_favor` 해금 시 8% → 표시와 지급 불일치 (13번 R8) |
| D-08 | P1 | `src/scenes/hub.js` 전반 | 클릭 대상이 `div`/`span`, `button`·`tabindex`·키보드 조작 없음. 설정값(`save.js:28` `soundVolume/screenShake/reducedFlash`)은 저장 스키마에만 있고 **UI가 없음**. 일시정지 없음 |
| D-09 | P1 | `src/systems/spriteAtlas.js` `SPRITE_DEFS` | 키 이름과 실제 타일이 불일치: `mite`→imp, `golem`→ogre, `cultist`→orc_shaman, `wraith`→chort, `boss_warden`→big_demon, `boss_hart`→big_zombie, `altar`/`gate_crystal`→빨간 샘물 타일. 0x72에는 제단·게이트 타일이 없음 |
| D-10 | P2 | `game/assets/` vs `game/public/assets/` | 동일 에셋 2벌 중복(`diff` 결과 동일). Vite는 `public/`만 서빙 → `game/assets/` 삭제 |
| D-11 | P2 | `public/assets/audio/dungeon_ambience.wav` | 1.4 MB 무압축 WAV, 자체 합성 8초 루프 → OGG/Opus 변환 + 실제 앰비언스로 교체 |
| D-12 | P2 | `src/scenes/dungeon.js` 1,663줄 | 입력·스폰·전투·시선·조수·게이트·렌더·HUD가 한 클래스. 렌더 교체·테스트가 어려움 |
| D-13 | P2 | `README.md` | "외부 에셋 전혀 없음", 구 디렉토리 구조 등 현재와 다른 설명 |
| D-14 | P2 | `tools/lint.mjs` | ESLint/Prettier 부재. 미사용 import(D-01) 같은 결함을 못 잡음 |
| D-15 | P2 | `test/economy.test.js`, `test/escape_path.test.js` | 실제 `HubScene`/`DungeonScene` 메서드를 호출하지 않고 산식을 테스트 안에서 복제 → 통합 결함 미검출 |

---

## 3. 프로덕트급까지 부족한 점 (영역별 격차)

### 3.1 비주얼 — 가장 큰 격차

- 스프라이트 렌더 파이프라인 미연결(D-01). 타일맵·벽 오토타일·애니메이션 상태머신(idle/run/attack/hit/death) 없음.
- **조명/어둠 표현 없음.** 이 게임의 핵심 규칙은 "아비그라는 어둠으로 본다"인데 화면에 광원 반경·그림자·등불 효과가 없다. 비네트 그라디언트 1개(`dungeon.js:1583`)가 전부.
- 층별 아트 키(`11` §5: 1층 주화 해안 ~ 5층 위장·어좌)와 "왕국 70:생체 30 → 30:70" 전이가 전혀 표현되지 않음.
- 시선 4구간·조수 3단계의 화면 변화(`11` §5 표) 미구현.
- 공격 전조(텔레그래프) 시각화가 보스 일부에만 존재. 적 공격 형상 = 히트 영역 정합성 없음.
- 캐릭터 실루엣 규칙(8슬롯 하네스, 2슬롯 유물이 등에 보임) 미반영.

### 3.2 게임 필(Game Feel)

- 히트스톱, 넉백, 피격 플래시 외 형태 압축, 데미지 숫자, 카메라 선행(전방 10%) 및 사용자 조절 흔들림 없음.
- 파티클(먼지·피·금화·위액·성수 빛) 없음. 드롭 빔·희귀도 연출 없음.
- 공격/구르기 애니메이션 캔슬 규칙, 입력 버퍼 없음.

### 3.3 오디오

- 파일 SFX 미재생(D-02). 채널 믹싱·동시 재생 제한·볼륨 버스 없음 (`cloneNode()` 방식은 GC·지연 문제).
- `11` §5 요구: **적마다 0.4초 이상 고유 전조음**, 게이트·조수 3단계의 서로 다른 4개 리듬, 60~72→90~120 BPM 박동 — 전부 미구현.
- 층별 앰비언스, 거점 음악, 시선 61+ 속삭임 레이어 없음.

### 3.4 UI/UX

- "강탈자의 장부" UI 메타포 미적용. HUD가 기본 바 형태.
- 8슬롯 인벤토리의 2슬롯 실제 점유 표시, 희귀도 **색+홈 개수** 병행 표기 없음.
- 타이틀 화면, 일시정지 메뉴, 설정 화면, 크레딧 화면, 런 결과 영수증 연출 없음.
- 미니맵/지도는 디버그 수준.
- 한글 폰트 역할 분리(본문 고딕 / 제목 명조) 미적용, `Georgia` 하드코딩.

### 3.5 온보딩

- 최초 5분 튜토리얼 없음. 시선·조수·게이트·세관 개념을 플레이로 가르치는 흐름 부재.

### 3.6 콘텐츠·서사

- 메인 퀘스트 1개(1막 '병장의 반지'), 사이드 1개. 7막 중 1막만.
- 대사는 텍스트 박스뿐. 환경 서사 모티프(층마다 지워지는 왕실 벽화, 화폐의 변화) 없음.
- 보스 페이즈별 외형 변화(감시자 P1 인간→P2 비대칭→P3 기관) 없음.

### 3.7 기술 기반

- 결정론(D-06), 충돌/LOS(D-04), 맵 불변식(D-05), 저장 실패 처리(D-03).
- 에셋 로더/매니페스트/프리로드 화면 없음. 로딩 실패 폴백 정책 불명확.
- 해상도 스케일링(1024×576~1920×1080 비율 유지), DPI 대응, 픽셀 아트 `imageSmoothingEnabled=false` 정책 없음.

### 3.8 품질·출시 인프라

- ESLint/Prettier, Playwright E2E, 성능 프로파일(p95 프레임), 30분 메모리 테스트, CI 없음.
- 데스크톱 패키징(Electron/Tauri), 세이브 경로(파일 기반), 전체화면·창 모드, 게임패드, 키 재지정 없음.
- 크레딧·서드파티 라이선스 고지 화면 없음.
- 현지화 구조(문자열 테이블) 없음 — 한국어 하드코딩. 최소한 `src/data/strings.ko.json`으로 추출해 영어 추가 가능 구조 필요.

### 3.9 이번 범위에서 제외 (착수 금지)

듀오/트리오 코옵 넷코드, 7막 전체 및 엔딩 5종, 서버 권위 세이브, 수익화·LiveOps, 음성 녹음.

---

## 4. 단계별 작업 지시

> 각 태스크는 **변경 대상 → 할 일 → 수용 기준** 형식. 단계 순서는 바꾸지 않는다(P0 → P1 → P2 …). 같은 단계 안에서는 병렬 가능.

### Phase 0 — 정합성 복구 (필수 선행)

**P0-01 저장 실패를 성공으로 표시하지 않기** (D-03)
- 대상: `src/systems/save.js`, `src/main.js`, `src/scenes/hub.js`, `src/core/settlement.js`
- 할 일: 모든 상태 변경 액션을 `commit(mutator)` 헬퍼로 감싼다 — 사본에 적용 → `saveState` 성공 시에만 원본 교체 → 실패 시 원상복구 + 모달("저장 실패: 재시도 / 세이브 JSON 내보내기").
- 수용: `localStorage.setItem`을 throw하도록 모킹한 테스트에서 탈출·사망·구매·환전·강화·해금·퀘스트 완료 7개 경로 모두 골드/인벤토리 변화 0, 실패 UI 표시.

**P0-02 세관 정책 단일화** (D-07)
- 대상: `src/core/settlement.js`, `src/main.js`, `src/scenes/hub.js`
- 할 일: `getCustomsRate(save)`를 `src/core/economy.js`로 만들고 세 곳 모두 이 함수만 사용. 결과 화면 문구도 실제 비율로 표시.
- 수용: `customs_favor` 해금/미해금 두 경우 결과 화면 예상액 == 허브 실제 지급액 테스트.

**P0-03 결정론 마무리** (D-06)
- 대상: `src/main.js`, `src/scenes/dungeon.js`, `src/scenes/hub.js`, `src/core/rng.js`
- 할 일: 고정 스텝 1/60초 누산기 루프(렌더는 보간), `RULES_VERSION` 상수, 강화 도박용 `meta` RNG 스트림(세이브에 시드 저장), `DungeonScene.snapshotHash()`.
- 수용: 동일 `seed + RULES_VERSION + 입력 프레임 로그`로 헤드리스 10회 실행 → 해시 동일. `grep -rn "Math.random" src`가 `rng.js`의 시드 생성 1곳과 오디오 노이즈 버퍼 외 0건.

**P0-04 맵 불변식 수정 + 진짜 테스트** (D-05)
- 대상: `src/core/roomGraph.js`, `test/roomGraph.test.js`
- 할 일: 보물방 강제 배정(잎 노드 없으면 전투방 1개 전환), 보스방은 시작방 BFS 거리 ≥ 3, 탈출 정책 결정 — `12` §3.2의 "층당 탈출 후보 2개"를 따르거나, 체크포인트 정책(1·3·5층 게이트 + 역주행 계단)을 유지할 경우 **`12` 문서를 갱신하고 그 정책대로 검사**. 테스트는 생성기 자체 검증기를 재호출하지 말고 독립 검사 함수로 작성.
- 수용: 10,000시드에서 보물방 누락 0, 보스-시작 거리 < 3 0건, 탈출 정책 위반 0, 폴백률 < 0.1%.

**P0-05 에셋 파이프라인 정리** (D-02, D-10, D-11)
- 대상: `game/assets/`(삭제), `src/systems/audioManager.js`, `src/main.js`
- 할 일: 중복 폴더 삭제. `src/systems/assets.js`에 **매니페스트 기반 프리로더**(이미지·오디오 디코드, 진행률, 실패 목록) 작성 → 부팅 시 로딩 화면 후 거점 진입. 오디오는 `AudioBuffer` 디코드 + `GainNode` 버스(master/sfx/music/ambience) 방식으로 교체, 동일 SFX 동시 재생 상한(예: 4). WAV → OGG 변환.
- 수용: 네트워크 탭에서 모든 매니페스트 파일 200, 공격 시 `knife_slice.ogg`가 실제 재생(합성 폴백 호출 0 — 카운터로 확인), 로딩 실패 시 해당 키만 합성 폴백 + 콘솔 warn 1회.

### Phase 1 — 월드 구조와 판정

**P1-01 타일맵 + 충돌 월드** (D-04)
- 대상: 신규 `src/core/collision.js`, `src/core/tilemap.js`, `roomGraph.js`
- 할 일: 방 그래프 → 16px(=1타일, 월드 1m 기준 스케일 재정의) 타일 그리드로 래스터화(바닥/벽/문/통로). 원-AABB 슬라이드 충돌, DDA 기반 LOS, 부채꼴/원/직선 공격 판정 함수. 원거리 투사체 벽 충돌.
- 수용: 벽 통과 0 (자동 이동 봇 10분), 적 투사체가 벽 뒤 플레이어 미적중 테스트, 공격 텔레그래프 렌더 영역과 판정 영역 차이 ≤ 0.15m.

**P1-02 DungeonScene 분리** (D-12)
- 대상: `src/scenes/dungeon.js` → `src/run/RunEngine.js`(규칙), `src/render/DungeonRenderer.js`, `src/render/HudRenderer.js`, `src/input/InputController.js`
- 원칙: 렌더러는 엔진 상태를 **읽기만** 한다. ECS 전면 도입은 하지 않는다.
- 수용: 엔진을 DOM/Canvas 없이 Node에서 1런 시뮬레이션 가능. 기존 테스트 + 신규 통합 테스트 통과.

**P1-03 통합 테스트로 교체** (D-15)
- 경제·탈출 테스트를 실제 `HubScene`/`RunEngine` API 호출 방식으로 재작성.

### Phase 2 — 비주얼 버티컬 슬라이스 (1층 주화 해안 품질 증명)

> `11` §6 "MVP 비주얼 슬라이스"를 목표로 한다. **1층을 최종 품질로, 2~5층은 팔레트·타일 교체 수준으로.**

**P2-01 스프라이트 렌더 연결** (D-01, D-09)
- `SPRITE_DEFS`를 `tile_list_v1.7.txt` 이름 기반으로 **자동 생성**하는 스크립트(`tools/build-atlas.mjs`) 작성 → 수작업 좌표 제거. 키 이름은 게임 개념명, 값은 원본 타일명(§5.3 매핑표 준수).
- `ctx.imageSmoothingEnabled = false`, 정수 배율 스케일(기본 3×), 카메라 픽셀 스냅.
- 벽 오토타일(0x72 `wall_*`, `wall_edge_*` 조합), 바닥 변주(`floor_1~8` 가중 랜덤, 시드 `decor` 스트림).
- 캐릭터 애니메이션 상태머신: idle / run / attack(무기 스프라이트 회전 스윙) / hit / death(페이드+파편).
- 수용: 디버그 도형·방 타입 텍스트 라벨이 프로덕션 모드에서 0개. 흑백 축소 스크린샷에서 플레이어·적 종류·출구·위험 바닥 구분 가능(`11` 아트 수용 기준).

**P2-02 조명·어둠 시스템 (게임 정체성 핵심)**
- 오프스크린 캔버스 라이트맵: 전체 어둠(`#0A0806` 알파) 위에 `destination-out` 방사형 광원(플레이어 등불, 벽 횃불, 제단 청백광 `#CFE6FF`). 광원 반경은 데이터화.
- 시선 구간 연동: 31+ 그림자가 플레이어 쪽으로 기울어짐(광원 오프셋), 61+ 자주 `#8D5A91` 잔상·가짜 광원, 91+ 주홍 `#E6503C` 탐조등.
- 조수 연동: 담즙 녹 `#78A83D` 바닥 안개 레이어 3단계, 조수 3에서 시야 반경 축소(출구 표식은 절대 가리지 않음).
- 성능: 라이트맵은 1/2 해상도로 그리고 업스케일.
- 수용: 시선 0/45/75/95, 조수 0/1/2/3 조합 스크린샷 16장이 `11` §5 표와 일치. 1280×720 전투 30엔티티에서 프레임 p95 ≤ 16.7ms.

**P2-03 팔레트 통일 (에셋 혼용 대책)**
- 모든 스프라이트 시트를 빌드 타임에 **프로젝트 팔레트로 리매핑**(`tools/palette-remap.mjs`, `sharp` 또는 `pngjs` 사용). 기준 팔레트: `11` §5 핵심 팔레트 8색 + 램프 확장 24~32색. 층별 LUT(1층 금·석회 / 2층 철회·뼈 / 3층 먹청·양피지 / 4층 적갈·산화금 / 5층 응고적·상아).
- 적 변형(병장·엘리트·수색대)은 **색만 바꾸지 말고** 외곽선/오버레이 형태 추가(`11` "색만 바꾼 적 금지").
- 수용: 한 화면에 사용된 고유 색 수가 층 LUT 범위 내. 색각이상 시뮬레이션(Deuteranopia/Protanopia)에서 희귀도·전조 식별 가능.

**P2-04 게임 필 패키지**
- 히트스톱(적중 60~90ms), 넉백, 피격 형태 압축(스쿼시), 데미지 숫자, 카메라 전방 선행 10% + 트라우마 기반 흔들림(설정 0~100%), 파티클 풀(먼지/금화/뼈 파편/위액/성수 빛).
- 수용: 모든 효과가 설정의 흔들림·깜빡임 감소 옵션을 존중. 파티클 풀 상한 초과 시 오래된 것부터 재활용(GC 스파이크 없음).

**P2-05 전조(텔레그래프) 언어**
- 적마다 공격 0.4초 이상 전 **자세 + 바닥 형상 + 소리** 3중 신호(`11` 요구: 색 제거 상태에서도 2개 이상으로 식별). 붉은색=즉시 피해, 녹색=지속 피해, 자주=거짓 정보 고정.

### Phase 3 — 오디오

**P3-01 믹서와 사운드 디자인**
- 버스: master / music / ambience / sfx / ui. 거리 감쇠 + 스테레오 팬(플레이어 기준).
- 적별 전조음 세트(§5.5 에셋 매핑), 발소리 재질별(석재/주화/뼈/육벽) 2~4 변주 + 피치 ±5% 랜덤(시드 `decor` 스트림).
- 게이트 개방·충전·조수 1/2/3단계를 **서로 다른 4개 리듬**으로. 아비그라 심장 박동 레이어 60~72 BPM → 조수 상승 시 90→120 BPM.
- 시선 61+ 속삭임 레이어: 방향성 거짓 가능, **실제 적 발소리·공격음은 절대 위조 금지**.
- 수용: 화면을 끈 상태(오디오만)로 테스터가 게이트/조수 단계를 구분 가능. 동시 SFX 32개 스트레스에서 클리핑 없음(마스터 리미터 `DynamicsCompressorNode`).

### Phase 4 — UI/UX·온보딩·설정

**P4-01 "강탈자의 장부" UI 리스킨**
- 9-slice 패널(가격표·봉인 도장·찢긴 장부 탭), 폰트 역할 분리(§5.4), 최소 본문 16px, 대비 4.5:1.
- HUD 상시 노출 5종만: HP·스태미나·시선(숫자+4단 눈금)·시간(+조수 3단 수위 아이콘)·8슬롯.
- 인벤토리: 2슬롯 아이템 실제 2칸 점유 + 무게 추 아이콘, 희귀도 색 + 테두리 홈 1/2/3/4개.

**P4-02 메뉴 체계**
- 타이틀 → (이어하기/새 게임/설정/크레딧/종료) · 일시정지(Esc) · 설정 · 크레딧 · 런 결과 영수증 연출.
- 설정: 마스터/음악/앰비언스/효과음 볼륨, 화면 흔들림 0~100%, 깜빡임 감소, 색각 보조 모드, 키 재지정, 게임패드 매핑, 전체화면/창, UI 배율, 언어.
- 모든 허브 조작을 `<button>` + 포커스 링 + 키보드/게임패드로 완주 가능하게 (D-08).

**P4-03 온보딩 (첫 5분)**
- 거점 첫 방문 → "연습 굴(튜토리얼 방)": 이동 → 공격 → 가드 → 구르기 → 상자 약탈 → 시선 상승 체험 → 제단으로 시선 감소 → 게이트 충전 탈출 → 브로카 환전. 각 단계는 **행동 완료 시 진행**(텍스트 넘기기 아님). 건너뛰기 가능.
- 수용: 신규 테스터 5명 중 4명 이상이 첫 런에서 "18분 게이트"와 "사망 시 전량 로스트"를 설명 가능.

**P4-04 문자열 외부화**
- 모든 UI·대사 문자열을 `src/data/strings/ko.json`으로 추출, `t(key, vars)` 헬퍼. `en.json` 골격 생성.

### Phase 5 — 콘텐츠 마감 (슬라이스 범위 내)

- 보스 페이즈 외형 3단 변화(감시자), 하르트의 보고서 두루마리·통신 깃발 실루엣.
- 층별 랜드마크 1개씩(`11` §5 층별 아트 키), 왕실 행렬 벽화 모티프 5단계.
- 메인 1~2막 + 사이드 SQ-01~02를 퀘스트 데이터 구조(`조건→진행 이벤트→보상→완료`)로.
- 메타 해금 12노드, 튜토리얼 의뢰 3개(`12` §3.3 상한).

### Phase 6 — 출시 인프라

**P6-01 품질 도구**: ESLint(flat config) + Prettier, `npm run lint`를 실제 ESLint로 교체, 미사용 import 에러화. GitHub Actions: build/test/lint + 1,000시드 속성 테스트(PR), 10,000회 시뮬레이션·30분 메모리(야간).

**P6-02 E2E**: Playwright — 첫 실행→튜토리얼→구매→고정 시드 런→탈출→환전→강화→새로고침 복구 / 사망 경로 / 보스 경로 / 저장 실패 경로. 1024×576·1280×720·1920×1080 시각 회귀 스냅샷.

**P6-03 성능**: p95 16.7ms(30엔티티), p95 33.3ms(100엔티티 스트레스), 30분 런 메모리 증가 ≤ 20MB. 스프라이트 배치, 오프스크린 정적 타일 레이어 캐시, 객체 풀.

**P6-04 데스크톱 패키징**: Tauri(권장, 용량 작음) 또는 Electron. 세이브를 파일(`%APPDATA%/RevenantRun/save.json`)로 이전 + localStorage 마이그레이션, 자동 백업 3세대. Steamworks 연동은 이번 범위 밖(업적 훅만 인터페이스로).

**P6-05 법적 고지**: 크레딧 화면 + `THIRD_PARTY_NOTICES.md`(폰트 OFL 전문, CC-BY 표기, 라이브러리 MIT 등) 빌드 산출물 포함.

---

## 5. 무료 에셋 선정

### 5.1 선정 원칙

1. **스타일 축 고정: 16×16 기반 픽셀 아트, 탑다운.** 이미 들어온 0x72 DungeonTileset II가 기준 해상도다. 32px·HD 일러스트·3D 렌더 팩은 섞지 않는다.
2. **라이선스 등급**: 1순위 CC0 → 2순위 "상업 사용 가능·크레딧 선택" 커스텀 라이선스(재배포 금지 조항 확인) → 3순위 CC-BY(크레딧 필수). **CC-BY-SA/GPL 에셋은 코드와 섞지 않는 조건을 확인한 뒤 음악·SFX에 한해 예외 허용**, 아트에는 사용하지 않는다(파생물 공유 의무가 커스텀 리컬러에 전파됨).
3. 모든 스프라이트는 §4 P2-03 팔레트 리매핑을 거쳐 한 게임처럼 보이게 한다.
4. 에셋이 `11`의 톤(장기 고딕)과 어긋나면(귀엽거나 코믹한 실루엣) 쓰지 않고 §5.7 커스텀 목록으로 보낸다.
5. 다운로드 후 **각 에셋 페이지의 라이선스 문구를 직접 확인하고 LICENSES.md에 인용**한다. 아래 표의 라이선스는 2026-09-14 기준이며 작가가 바꿀 수 있다.

### 5.2 그래픽 — 타일·캐릭터·소품

| 우선 | 에셋 | 라이선스 | 용도 | 비고 |
|---|---|---|---|---|
| ★ 유지 | **0x72 DungeonTileset II v1.7** — https://0x72.itch.io/dungeontileset-ii | CC0 | 벽·바닥·문·상자·함정·계단·적/플레이어 애니메이션·무기 | 이미 `public/assets/sprites/`에 있음. 기준 팩 |
| ★ 추가 | **Szadi art — Rogue Fantasy Catacombs** — https://szadiart.itch.io/rogue-fantasy-catacombs | 작가 표기 "퍼블릭 도메인, 상업 사용 가능, 크레딧 불필요", **팩 재판매 금지** | 2~4층 지하묘지 타일·횃불·촛불·가시·통 등 장식 | 16×16, 0x72와 해상도 일치. 어두운 톤이 `11`과 맞음 |
| ★ 유지 | **Kenney Roguelike Characters / Roguelike RPG Pack** — https://kenney.nl | CC0 | 소품·아이템 아이콘 보조, 방패 등 0x72에 없는 파츠 | 이미 있음. 캐릭터는 톤이 밝아 **보조용**으로만 |
| 추가 | **Kenney Tiny Dungeon** — https://kenney.nl/assets/tiny-dungeon | CC0 | 추가 소품(제단·기둥·해골 장식) 후보 | 리컬러 필수 |
| 선택 | **DawnLike 16×16** (DragonDePlatino) — https://opengameart.org/content/dawnlike-16x16-universal-rogue-like-tileset-v181 | CC-BY 4.0 — **DragonDePlatino와 DawnBringer 모두 크레딧 필수** | 층별 변주용 대량 타일·몬스터 후보 풀 | 스타일이 다소 다름 → 리매핑 후 채택 여부 판단 |

### 5.3 기존 스프라이트 → 게임 개념 매핑표 (P2-01에서 이 표대로 교체)

| 게임 개념 | 현재 코드 키(실제 타일) | 지시 | 0x72 원본 타일 |
|---|---|---|---|
| 플레이어 강탈자 | `player` (knight_m) | 유지 + 망토·8슬롯 하네스 오버레이 커스텀 | `knight_m_*` |
| 해골병정 | `skeleton` (skelet) | 유지 | `skelet_*` + `weapon_bow` 대신 석궁 커스텀 |
| 해골 병장 | `skeletonCaptain` (masked_orc) | **교체** — 오크 실루엣은 세계관 위반 | `skelet_*` 1.25× + 투구·어깨갑 오버레이 |
| 왕실 호위 잔재 | `royalGuard` (knight_f) | 교체 | `knight_m_*` 적갈 리컬러 + Kenney 방패 파츠(정면 금빛 막 VFX) |
| 심연충 | `mite` (imp) | **교체** — 붉은 악마는 톤 위반 | `tiny_slug`/`slug` 응고적 리컬러 + 치아 오버레이, 조장은 두개 껍질 추가 |
| 수호 골렘 | `golem` (ogre) | 교체 | `ogre_*` 청동·금고 리컬러 + 사슬 8m 라인 렌더 |
| 어둠 광신도 | `cultist` (orc_shaman) | 교체 | `necromancer_*` 회백 리컬러 |
| 심연 망령 | `wraith` (chort) | 교체 | `wogol_*` 또는 `ice_zombie_*` 자주 반투명 |
| 식인 궤(미믹) | `mimic` | 유지 | `chest_mimic_open_anim_*` |
| 감시자 (보스) | `boss_warden` (big_demon) | P1·P2는 **커스텀 필수**, P3만 임시로 `big_demon` 리컬러 | — |
| 하르트 (사이드 보스) | `boss_hart` (big_zombie) | 임시 `big_zombie` 뼈색 리컬러 + 깃발·두루마리 오버레이 | — |
| 빛의 제단 | `altar` (빨간 샘물 타일 — **오류**) | 교체 | `wall_fountain_*_blue` 청백 리컬러 또는 Catacombs 촛불 제단 |
| 탈출 게이트 | `gate_crystal` (**오류**) | 커스텀(아비그라 역류 = 동심 타원 막) | `hole` + 파티클/라이트 |
| 계단 | `stairs_down` / `stairs_up` | 유지 | `floor_stairs` / `floor_ladder` |
| 상자 | `chest_closed` (empty 시트) | 수정 | 전리품 있는 상자는 `chest_full_open_anim_*` |

### 5.4 UI·아이콘·폰트

| 에셋 | 라이선스 | 용도 |
|---|---|---|
| **Galmuri** (quiple) — https://quiple.dev/galmuri | SIL OFL 1.1, 한글 11,172자 지원 | 인게임 HUD·데미지 숫자·짧은 라벨 (픽셀 폰트) |
| **Noto Sans KR** / **Noto Serif KR** — Google Fonts | SIL OFL 1.1 | 본문 고딕(설명·대사) / 왕실 문서·제목 명조 (`11` 폰트 역할 분리) |
| **DungGeunMo(둥근모꼴)** | SIL OFL 1.1 | Galmuri 대안 (둘 중 하나만) |
| **game-icons.net** — https://game-icons.net | CC-BY 3.0 — 작가별 크레딧 필수 | 축복 18종·저주 유물·상태 이상 아이콘 (SVG → 팔레트 단색 래스터화) |
| **Kenney UI Pack – RPG Expansion** / **Kenney Fantasy UI Borders** | CC0 | 9-slice 패널 원형 → 장부 텍스처로 리터치 |
| 0x72 `ui_heart_*` | CC0 | 사용하지 않음 (HP는 바 형태가 기획) |

폰트는 `public/assets/fonts/`에 WOFF2로 셀프호스팅하고 서브셋(KS X 1001 2,350자 + 게임 내 사용 문자)으로 용량을 줄인다. OFL 전문을 함께 동봉한다.

### 5.5 VFX

| 에셋 | 라이선스 | 용도 |
|---|---|---|
| **Pimen — Battle VFX: Slashes and Thrusts** — https://pimen.itch.io/battle-vfx-slashes-and-thrusts | 작가 표기 "개인·상업 사용·수정 가능, 크레딧 선택, **재판매·재배포 금지**" | 근접 베기 스미어 20종·찌르기 5종 |
| **Pimen — Battle VFX: Hit Spark** — https://pimen.itch.io | 동일 계열 — **개별 페이지에서 라이선스 확인 후 채택** | 적중 스파크 |
| **Kenney Particle Pack** / **Kenney Smoke Particles** | CC0 | 먼지·연기·안개 레이어 원형 (저해상도 다운샘플 후 사용) |
| 코드 생성 | — | 라이트맵, 위액 파문, 시선 잔상, 수색대 탐조등은 **셰이더/캔버스로 직접 생성** (에셋 의존 X) |

### 5.6 오디오

| 에셋 | 라이선스 | 용도 |
|---|---|---|
| **Kenney RPG Audio** | CC0 | 이미 있음 — 베기·동전·문·상자·발소리 |
| **Kenney Impact Sounds** (130개) — https://kenney.nl/assets/impact-sounds | CC0 | 재질별 발소리(석재/금속), 가드·타격·골렘 충격 |
| **Sonniss GDC Game Audio Bundle** (연도별 무료 배포) — https://sonniss.com/gameaudiogdc | 로열티 프리, 상업 사용·크레딧 불필요, **원본 단독 재배포 금지** | 뼈·금속·저역 드론·크리처·환경음. 적 전조음과 아비그라 호흡음의 핵심 소스 |
| **Loopable Dungeon Ambience** — https://opengameart.org/content/loopable-dungeon-ambience | CC0 | 1층 기본 앰비언스 (현 합성 WAV 교체) |
| **Dark Cavern Ambient** — https://opengameart.org/content/dark-cavern-ambient | CC0 | 3~5층 앰비언스 베이스 |
| **Dark Dungeon Ambience** — https://opengameart.org/content/dark-dungeon-ambience | CC-BY 3.0 | 보스 전 긴장 루프 후보 |
| **RPG Ambience – Dungeon** — https://opengameart.org/content/rpg-ambience-dungeon | CC-BY 3.0 | 거점(잿빛 야영지) 음악 후보 (첼로·현악 — `11` "멀리 울리는 현악 잔향"과 부합) |
| **Kevin MacLeod (incompetech)** — https://incompetech.com | CC-BY 4.0 | 다크 앰비언트 트랙 보충 (크레딧 필수) |
| **freesound.org** (필터: CC0만) | CC0 | 속삭임·역재생 호흡·젖은 저역 보충 |
| ❌ Juhani Junkala 512 SFX (8-bit) | CC0 | **사용 금지** — 칩튠 톤이 `11` 오디오 콘셉트와 충돌. UI 클릭음이 필요할 때만 검토 |

**적별 전조음 소스 지정**(P3-01): 해골병정=마른 뼈 딸깍+석궁 장전(Kenney Impact/Sonniss), 심연충=젖은 스크래치 군집음(Sonniss 크리처 레이어링), 골렘=사슬 끌림+저역 금속(Kenney `metal_pot` + Sonniss), 왕실 호위=정렬된 금속 발구름 2박, 망령=역재생 호흡(freesound CC0 가공), 감시자=전 층 방송형 종소리 왜곡.

모든 오디오는 **OGG Vorbis 96~128kbps**, 루프는 제로크로싱 편집, 라우드니스 앰비언스 -24 LUFS / SFX 피크 -3 dBFS로 정규화.

### 5.7 무료 에셋으로 해결되지 않는 것 → 커스텀 제작 목록

아래는 세계관 고유 요소라 기성 팩에 없다. 0x72 16px 스타일 가이드(외곽선 1px, 3~4단 셰이딩)에 맞춰 Aseprite/LibreSprite로 직접 제작하거나 외주한다.

1. 플레이어 망토 + 8슬롯 하네스 오버레이(빈 슬롯/1슬롯/2슬롯 유물 3단)
2. 감시자 P1(수직 인간)·P2(오른팔 위액 창)·P3(벽 고정 동심원 기관) 32×36 시트
3. 탈출 게이트(아비그라 역류: 동심 타원 막, 충전 8단계)
4. 층별 랜드마크 5종(세관 크레인, 금고문, 뼈 마구간 탑, 뒤집힌 종, 기울어진 대관 회랑, 심장 왕좌)
5. 왕실 행렬 벽화 타일 5단계(얼굴이 지워지고 심장만 남는 변화)
6. 육벽/막/섬모 타일셋(4~5층 "생체 70%")
7. 브로카·세레나·톨렌·넬·오도베르 거점 NPC 스프라이트 + 대화 초상화(64×64)
8. 장부형 UI 9-slice(가격표, 봉인 도장, 찢긴 탭)
9. 시선 4단계·조수 3단계 HUD 아이콘

### 5.8 도구·라이브러리 (모두 무료)

| 도구 | 라이선스 | 용도 |
|---|---|---|
| **LDtk** — https://ldtk.io | MIT | 튜토리얼 방·보스방·랜드마크 방 **수제 템플릿** 제작 → 절차 생성기에 삽입 |
| **Tiled** | GPL(도구) / 출력물 제약 없음 | LDtk 대안 |
| **LibreSprite** / **Piskel** | GPL / Apache 2.0 | 커스텀 스프라이트 제작 (Aseprite는 유료) |
| **Lospec 팔레트** — https://lospec.com/palette-list | 팔레트 자체는 자유 사용 | 프로젝트 32색 팔레트 기반 선택 |
| **sharp** 또는 **pngjs** | Apache 2.0 / MIT | 빌드 타임 팔레트 리매핑·아틀라스 패킹 |
| **free-tex-packer-core** | MIT | 스프라이트 아틀라스 패킹 |
| **Audacity** | GPL(도구) | 오디오 편집·정규화 |
| **ffmpeg** | LGPL/GPL(도구) | WAV→OGG 일괄 변환 |
| **Playwright**, **ESLint**, **Prettier**, **Vitest**(선택) | Apache 2.0 / MIT | 품질 도구 |
| **Tauri** | MIT/Apache 2.0 | 데스크톱 패키징 |
| (선택) **PixiJS v8** | MIT | Canvas2D 성능 한계 도달 시 WebGL 렌더러 전환. **P6-03 프로파일 결과가 기준 미달일 때만** 도입 |

---

## 6. 에셋 파이프라인 규칙

### 6.1 폴더 구조

```
game/
  art-src/                  # 원본(PSD/ASE/원본 PNG/원본 WAV) — 빌드에 포함 안 됨
    third_party/<pack>/     # 다운로드 원본 + 라이선스 파일 그대로
    custom/                 # 자체 제작 원본
  public/assets/
    atlas/                  # 빌드된 아틀라스 png + json (리매핑 완료본)
    audio/{sfx,ambience,music,ui}/
    fonts/
    manifest.json           # 키 → 경로, 타입, 프리로드 그룹(boot/hub/floor1..5)
    LICENSES.md
  tools/
    build-atlas.mjs
    palette-remap.mjs
    build-audio.mjs
```

### 6.2 매니페스트 규칙

- 코드에서 에셋 경로 문자열 직접 사용 금지 → `assets.get('sfx.sword_swing')` 형태.
- 키 명명: `<종류>.<대상>_<동작>` (예: `sprite.skeleton_run`, `sfx.golem_chain_drag`, `amb.floor3_base`).
- 층 진입 시 해당 층 그룹만 로드, 이전 층 그룹은 캐시 유지(역주행 대비).

### 6.3 LICENSES.md 항목 템플릿

```
## <에셋 이름>
- Author: <작가>
- Source URL: <다운로드 페이지>
- Version / Downloaded: <버전> / 2026-MM-DD
- License: <정확한 라이선스명> (페이지 문구 인용: "...")
- Attribution required: Yes/No — 크레딧 문구: "<...>"
- Redistribution of raw files: Allowed/Forbidden
- Modified: Yes/No (리컬러, 크롭 등)
- Files: <public/assets/... 목록>
```

### 6.4 크레딧 화면

타이틀 → 크레딧에서 스크롤 표시. CC-BY 항목(DawnLike 사용 시 DragonDePlatino + DawnBringer, game-icons.net 작가별, Kevin MacLeod, OGA CC-BY 트랙)은 **반드시** 포함. CC0·크레딧 선택 항목도 감사 표기로 포함 권장.

---

## 7. 완료 정의와 보고 형식

### 7.1 이번 작업 전체 완료 조건

- §2.3 D-01~D-15 전부 해결 또는 사유와 함께 보류 명시.
- `12` 문서의 G0~G5 수용 기준 통과(맵 탈출 정책 변경 시 `12` 문서 갱신 포함).
- 1층 주화 해안 1세션이 `11` §6 "아트 수용 기준" 6개 항목을 만족하는 스크린샷·녹화 제출.
- 흑백/색각 시뮬레이션/3해상도 스크린샷 세트 제출.
- `LICENSES.md`에 없는 파일이 `public/assets/`에 0개 (스크립트로 검사: `tools/check-licenses.mjs`).
- `README.md`를 현재 구조·실행법·에셋 출처 요약으로 갱신(D-13).

### 7.2 각 Phase 종료 시 보고 템플릿

```
## Phase N 보고
- 완료 태스크: P?-?? … (커밋 해시)
- 수용 기준 결과: 태스크별 통과/실패/미검증 + 근거(테스트명, 스크린샷 경로, 수치)
- 명령 결과: build / test (n/n) / lint / e2e
- 추가한 에셋: 이름 · 라이선스 · LICENSES.md 반영 여부
- 새로 발견한 결함: ID · 파일:라인 · 영향
- 기획 문서와 다르게 결정한 것: 내용 · 이유 · 갱신한 문서
- 다음 Phase 착수 전 확인이 필요한 결정
```

### 7.3 결정이 필요하면 멈추고 질문할 것

- 탈출 정책(층당 게이트 2개 vs 1·3·5층 체크포인트) 최종안
- PixiJS 전환 여부 (P6-03 결과 이후)
- 커스텀 아트 외주 여부와 예산
- CC-BY-SA 음악 채택 여부
