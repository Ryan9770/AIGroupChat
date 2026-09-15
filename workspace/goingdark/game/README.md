# 『강탈자들 (Revenant Run)』 — PvE 익스트랙션 로그라이트 버티컬 슬라이스

> **"구멍 밖으로 나온 것만 세상의 물건이다."**  
> 죽은 왕국을 삼킨 살아 있는 구멍(아비그라)에서, 욕심이 들키기 전에 유산을 훔쳐 나오는 다크 판타지 솔로 PvE 회수형 크롤러.

---

## 1. 개요 (Overview)

본 프로젝트는 『강탈자들 (Revenant Run)』의 **출시 가능한 솔로 PvE 버티컬 슬라이스(Early Access Quality)** 빌드입니다.
Vite 5 + Canvas2D + Web Audio API 기반의 순수 Vanilla JS ESM 구조로 개발되었으며, 렌더링/입력/오디오/규칙 엔진이 철저하게 분리되어 DOM/Canvas 없이도 헤드리스 결정론적 시뮬레이션 및 속성 기반 자동화 검증이 가능합니다.

---

## 2. 빠른 시작 (Getting Started)

### 2.1 환경 및 실행

```bash
cd game
npm install          # 의존성 설치
npm run dev          # 로컬 개발 서버 실행 → http://localhost:5173/
npm run build        # 팔레트 리매핑 + 아틀라스 빌드 + 프로덕션 번들링
npm run preview      # 빌드 결과물 로컬 미리보기
```

### 2.2 품질 및 불변식 검증 (Zero Regression Pipeline)

```bash
npm test             # 전체 88개 테스트 (26개 스위트, 10,000시드 맵 불변식 검증)
npm run lint         # node --check 문법 검사 + ESLint 정적 분석 + 에셋 라이선스 전수 감사
npm run build        # 빌드 타임 팔레트 리매핑 및 Vite 번들링
```

---

## 3. 조작법 (Controls)

| 입력 | 기능 | 비고 |
|---|---|---|
| **W, A, S, D** | 8방향 이동 | 기본 4.0 m/s, 가드 시 2.4 m/s, 2슬롯 중량템 보유 시 -10% |
| **Shift** | 전력질주 | 6.5 m/s, 스태미나 초당 22 소모 |
| **마우스 좌클릭** | 근접 공격 (베기) | 쿨다운 0.55초, 사거리 1.6m, 공격 전조 텔레그래프 |
| **마우스 우클릭 (홀드)** | 방패 가드 | 피해 70% 감소, 이동속도 -40% |
| **Space** | 구르기 회피 | 무적 시간 0.3초, 쿨다운 1.2초, 소음 반경 20m |
| **Q** | 성수 등불 | 3초간 시선 상승 정지 및 몹 탐지 -30%, 쿨다운 18초 |
| **E** | 상호작용 | 상자 약탈, 제단 기도(시선 감소), 계단 이동, 보스 조우 |
| **F (홀드)** | 탈출 게이트 충전 | 18분 게이트 활성화 후 8초간 충전 탈출 (피격 시 초기화, 전 층 경보) |
| **Tab** | 약탈 가방 열기/닫기 | 8슬롯 인벤토리 (무게 추 ⚖ 및 희귀도 홈 ▪ 표시) |
| **1 / 2 / 3 / 4** | 퀵슬롯 소모품 | 성수병(시선 -30), 치유 물약(HP +40), 붕대(지속 회복), 등불 기름(Q 초기화) |
| **Esc** | 일시정지 / 설정 메뉴 | 볼륨 조절, 화면 흔들림, 깜빡임 감소, 색각 보조 모드, 언어 설정 |

---

## 4. 아키텍처 및 핵심 시스템 (Architecture)

### 4.1 엔진과 렌더러의 완전한 분리
- `src/run/RunEngine.js`: Canvas/DOM에 의존하지 않는 순수 결정론적 규칙 및 물리 시뮬레이션 엔진. Node.js 환경에서 1런 전체를 헤드리스로 시뮬레이션 가능.
- `src/render/DungeonRenderer.js`: 0x72 스프라이트 아틀라스 렌더링, 오토타일, 벽화/랜드마크 렌더링, 보스 3단계 시각적 변형.
- `src/render/LightmapSystem.js`: 1/2 해상도 오프스크린 캔버스 기반 동적 조명/어둠 시스템 (`#0A0806` 어둠 + `destination-out` 방사형 광원). 시선(31/61/91+) 및 조수(1~3단계 안개) 레이어 완벽 연동.
- `src/render/ParticleSystem.js`: 400개 상한의 Zero-GC 파티클 풀(먼지, 혈흔, 금화, 위액, 성수 빛), 히트스톱(60~90ms), 트라우마 기반 화면 흔들림.
- `src/render/HudRenderer.js`: "강탈자의 장부" 메타포 UI, 상시 5대 필수 정보, 8슬롯 2칸 점유(무게추 ⚖2) 및 희귀도 이중 부호화(색상 + 테두리 홈 1/2/3/4개).
- `src/input/InputController.js`: 브라우저 이벤트와 게임 입력 상태 분리.

### 4.2 타일맵 & 충돌 월드 (World & Hit Detection)
- `src/core/tilemap.js` & `src/core/collision.js`: 방 그래프를 16px 그리드로 래스터화. 원-AABB 슬라이드 충돌, DDA 알고리즘 기반 가시선(LOS) 판정, 부채꼴/원/직선 공격 텔레그래프 영역 일치화. 10분간 자동 봇 테스트에서 벽 통과 0건 보장.

### 4.3 프로덕트급 오디오 디자인 (Audio & Mixer)
- `src/systems/audioManager.js`: 5-Bus 오디오 믹서(`master`, `sfx`, `music`, `ambience`, `ui`), `DynamicsCompressorNode`(-3 dBFS) 마스터 리미터 탑재로 32채널 동시 재생 시에도 클리핑 방지.
- 거리 감쇠 및 스테레오 패닝, 바닥 재질별 발소리 피치 지터(±5%), 게이트/조수 4단계 고유 리듬, 심연 박동(60→120 BPM), 시선 61+ 속삭임 레이어.

### 4.4 데이터 기반 메타 진행 & 퀘스트
- `src/data/metaUnlocks.js`: 12개 메타 해금 노드(강철 체력, 세관 친분, 톨렌의 우정 등) 트리 구조 및 계정 레벨 10 상한.
- `src/data/quests.js` & `src/core/settlement.js`: 튜토리얼 의뢰 3종 + 메인 1~2막('병장의 반지', '예순하나') + 사이드 SQ-01~02 의뢰 상태 머신.
- 원자적 세이브 트랜잭션(`commitState`): 저장 실패 시 원상복구 및 복구 모달 지원. 3세대 자동 백업 순환(`bak1`, `bak2`, `bak3`) 및 손상 복구.

### 4.5 층별 랜드마크 & 환경 서사
- 1층: 세관 기중기 & 주화 금고문 (Customs Crane & Vault)
- 2층: 뼈 마구간 감시탑 (Bone Stable Watchtower)
- 3층: 뒤집힌 거대 종과 제단 (Inverted Bell & Altar)
- 4층: 기울어진 대관 회랑 (Tilted Coronation Colonnade)
- 5층: 심장 왕좌 (Heart Throne)
- 왕실 행렬 벽화: 1층(선명한 왕실) → 2층(부식 균열) → 3층(얼굴 지워짐) → 4층(흉곽 절개) → 5층(소화된 신체와 심장만 잔존)

---

## 5. 에셋 출처 및 라이선스 (Asset Compliance)

모든 외부 에셋은 상업적 사용이 보장된 **CC0 1.0 Universal (Public Domain)** 및 **SIL OFL 1.1** 라이선스를 준수하며, `tools/check-licenses.mjs` 스크립트를 통해 미등록 파일이 0개임을 자동 검증합니다.

| 에셋명 | 저작자 | 라이선스 | 용도 |
|---|---|---|---|
| **0x72 DungeonTileset II (v1.7)** | 0x72 | CC0 1.0 Universal | 벽, 바닥, 문, 상자, 플레이어/적 스프라이트 (32색 램프 팔레트로 빌드타임 리매핑) |
| **Kenney Roguelike Characters** | Kenney (Kenney.nl) | CC0 1.0 Universal | 보조 캐릭터 스프라이트 및 파츠 |
| **Kenney Roguelike RPG Pack** | Kenney (Kenney.nl) | CC0 1.0 Universal | 아이템, 보물 상자, UI 소품 아이콘 |
| **Kenney RPG Audio Pack** | Kenney (Kenney.nl) | CC0 1.0 Universal | 베기, 타격, 동전 소리, 발소리, 문/상자 효과음 |
| **Galmuri / Noto Sans KR** | quiple / Google Fonts | SIL OFL 1.1 | 픽셀 HUD 및 본문 다국어 폰트 |

상세 라이선스 전문 및 출처 링크는 [public/assets/LICENSES.md](file:///C:/Users/Admin/Desktop/claude/team/workspace/goingdark/game/public/assets/LICENSES.md) 및 [THIRD_PARTY_NOTICES.md](file:///C:/Users/Admin/Desktop/claude/team/workspace/goingdark/game/THIRD_PARTY_NOTICES.md)에 수록되어 있습니다.

---

## 6. 결함 해결 현황 (Defect Resolution: D-01 ~ D-15)

- [x] **D-01 (P0)**: 스프라이트 아틀라스 렌더 파이프라인 연동 (`DungeonRenderer.js`, 53개 스프라이트 자동 생성 아틀라스)
- [x] **D-02 (P0)**: Web Audio manifest 프리로더 및 AudioBuffer 디코딩 믹서 (`assets.js`, `audioManager.js`)
- [x] **D-03 (P0)**: `commitState` 원자적 커밋 및 실패 시 롤백 UI (`save.js`)
- [x] **D-04 (P1)**: 타일맵 래스터화 및 원-AABB 연속 충돌, DDA 가시선 판정 (`tilemap.js`, `collision.js`)
- [x] **D-05 (P1)**: 방 그래프 10,000시드 무결성 검증 (보물방 누락 0, 보스 거리 >= 3, 게이트 불변식 100% 충족)
- [x] **D-06 (P1)**: 1/60초 고정 누산기 루프, `RULES_VERSION`, `snapshotHash` 결정론 검증 (`rng.js`, `RunEngine.js`)
- [x] **D-07 (P1)**: `getCustomsRate` 세관 환전 공제율 단일화 (`economy.js`)
- [x] **D-08 (P1)**: 거점 접근성 `<button>` 태그, 일시정지(Esc) 및 설정 모달(볼륨, 흔들림, 깜빡임, 색각, 언어)
- [x] **D-09 (P1)**: 스프라이트 키와 0x72 실제 타일명 정합 및 세계관 스킨 오버레이
- [x] **D-10 (P2)**: 중복 에셋 폴더 정리 (`game/assets` 제거, `public/assets` 단일화)
- [x] **D-11 (P2)**: 던전 앰비언스 무압축 WAV 제거 및 OGG Vorbis 경량화
- [x] **D-12 (P2)**: `DungeonScene` 분리 (`RunEngine`, `DungeonRenderer`, `HudRenderer`, `InputController`)
- [x] **D-13 (P2)**: README.md 및 아키텍처 문서 최신화
- [x] **D-14 (P2)**: ESLint Flat Config + 문법 검사 + 라이선스 전수 검증 파이프라인 (`tools/lint.mjs`)
- [x] **D-15 (P2)**: 실 엔진 API 기반 통합 테스트 스위트 구축 (`test/economy.test.js`, `test/escape_path.test.js`)
