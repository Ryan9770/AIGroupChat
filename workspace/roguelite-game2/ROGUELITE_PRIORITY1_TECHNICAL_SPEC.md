# Dungeon of the Abyss 핵심 업그레이드 테크니컬 스펙

> 대상: `ROGUELITE_UPGRADE_LIST.md`의 U-01, U-02, U-03 및 유물 시너지(U-04)  
> 기준 코드: 현재 단일 페이지 구조(`index.html`, `style.css`, `game.js`)  
> 목적: 기존 저장 데이터와 게임 루프를 깨지 않고 구현자가 그대로 옮길 수 있는 함수·상태·호출 계약 정의

## 0. 통합 원칙

- 공개 메서드는 기존 `RetroAudioEngine`, `DungeonFloor`, `RogueliteGame`에 추가한다. 데이터 카탈로그와 순수 헬퍼는 클래스 밖 상수/함수로 둔다.
- 랜덤 판정 함수는 반드시 `rng = Math.random`을 받는다. 확률 경계 테스트에서 `0`, 임계값 직전, 임계값을 주입할 수 있어야 한다.
- 게임 내 객체는 카탈로그 원본을 직접 변경하지 않고 얕은 복제하여 사용한다. `ITEM_CATALOG`, `RELIC_CATALOG`, 신규 트랙/상점/시너지 카탈로그는 불변 데이터다.
- 모달 진입 시 `gameState`를 먼저 변경하고, 닫을 때만 `PLAYING`으로 복귀한다. 모달이 열린 동안 키보드 이동·스킬·몬스터 턴은 진행하지 않는다.
- 구매, 상자 보상, 유물 지급은 검증 후 한 번에 커밋한다. 실패 시 골드·재고·인벤토리 중 어느 것도 일부만 바뀌면 안 된다.
- `DOTA_ROGUELITE_DATA_V2` 형식은 변경하지 않는다. BGM 설정은 별도 키 `DOTA_AUDIO_SETTINGS_V1`에 저장하고, 나머지 신규 상태는 런 한정 상태로 둔다.
- 기존 직접 호출(`audio.playHit()`, `hasRelic()`, `addItemToInventory()`)은 계속 동작해야 한다.

### 공통 식별자와 반환 형식

```js
/** @typedef {'PLAYING'|'SHOP'|'LEVEL_UP'|'SHRINE_EVENT'|'CLASS_SELECT'|'GAME_OVER'|'VICTORY'} GameState */
/** @typedef {{x:number, y:number}} TilePos */
/** @typedef {{ok:true, code:string, [key:string]:unknown}|{ok:false, code:string, reason:string}} ActionResult */

const FEATURE_RULES = Object.freeze({
  merchantFloors: [2, 4],
  mimicChance: 0.15,
  secretRoomChance: 0.55,
  maxSecretRoomsPerFloor: 1,
});
```

`ActionResult.code`는 UI가 문구와 효과를 선택하는 안정적인 키다. 게임 규칙 함수가 DOM을 직접 변경하지 않고 결과를 반환하면 실패 경로를 테스트하기 쉽다.

## 1. U-01 Web Audio API 절차적 8-bit BGM

### 1.1 데이터 계약

```js
/** @typedef {0|1|2|3|4|5|6|7|null} Note */
/**
 * @typedef {Object} BgmChannel
 * @property {'square'|'sawtooth'|'triangle'|'noise'} wave
 * @property {number} octave
 * @property {number} gain
 * @property {Note[]} pattern       // null은 쉼표, 숫자는 track.scale 인덱스
 * @property {number=} gate         // 스텝 길이 대비 발음 비율, 기본 0.72
 */
/**
 * @typedef {Object} BgmTrack
 * @property {string} id
 * @property {number} bpm
 * @property {number} stepsPerBeat
 * @property {number} rootHz
 * @property {number[]} scale       // rootHz에 곱할 주파수 비율
 * @property {BgmChannel[]} channels
 */

const BGM_TRACKS = Object.freeze({
  lobby:       { /* 장엄한 단조 아르페지오 */ },
  crypt:       { /* B1F 느린 펄스파 */ },
  fungal:      { /* B2F 저음 드론 */ },
  boss_b3:     { /* B3F 빠른 베이스 + 노이즈 드럼 */ },
  inferno:     { /* B4F 불규칙 아르페지오 */ },
  boss_b5:     { /* B5F 최고 템포 베이스 + 노이즈 드럼 */ },
});
```

트랙 패턴은 최소 공배수 길이에서 반복한다. `noise` 채널만 `AudioBufferSourceNode`를 사용하고 나머지는 오실레이터를 사용한다. 동시에 발음되는 채널의 합산 게인은 `0.18` 이하로 제한한다.

### 1.2 `RetroAudioEngine` 인터페이스

```js
class RetroAudioEngine {
  /** 사용자 제스처 안에서 AudioContext와 master/sfx/bgm GainNode를 준비한다. */
  init() {}

  /**
   * @param {boolean} enabled
   * @param {{persist?:boolean}=} options
   * @returns {boolean} 최종 활성 상태
   */
  setEnabled(enabled, { persist = true } = {}) {}

  /**
   * 같은 trackId가 이미 재생 중이면 아무 일도 하지 않는다.
   * 다른 곡이면 기존 곡을 fade-out한 뒤 스텝 0부터 시작한다.
   * @param {keyof typeof BGM_TRACKS} trackId
   * @param {{fadeMs?:number, restart?:boolean}=} options
   * @returns {boolean} 유효한 트랙을 실제 시작했는지
   */
  startBgm(trackId, { fadeMs = 180, restart = false } = {}) {}

  /**
   * 예약된 소스와 스케줄 타이머를 모두 해제한다. 여러 번 호출해도 안전하다.
   * preserveRequest=true는 음소거/탭 숨김 뒤 같은 장면을 재개할 때만 사용한다.
   */
  stopBgm({ fadeMs = 120, preserveRequest = false } = {}) {}

  /**
   * 게임 장면을 트랙 ID로 매핑하고 startBgm을 호출한다.
   * @param {'LOBBY'|'FLOOR'|'BOSS'|'GAME_OVER'|'VICTORY'} scene
   * @param {{floorNumber?:number}=} context
   * @returns {string|null} 선택한 trackId; 정지 장면은 null
   */
  setScene(scene, { floorNumber } = {}) {}

  /** look-ahead 창 안의 스텝을 Web Audio 절대 시각으로 예약한다. */
  scheduleBgmWindow() {}

  /** @private */
  scheduleBgmStep(track, stepIndex, when) {}

  /** @private SFX와 BGM 모두 masterGain을 거치게 한다. */
  createVoice(freq, wave, when, duration, gain, destination) {}
}
```

추가 인스턴스 상태는 다음으로 고정한다.

```js
this.masterGain = null;
this.sfxGain = null;
this.bgmGain = null;
this.requestedTrackId = null;
this.currentTrackId = null;
this.bgmStep = 0;
this.nextStepAt = 0;
this.schedulerId = null;
this.scheduledSources = new Set();
this.lookAheadMs = 25;
this.scheduleAheadSec = 0.12;
```

### 1.3 호출 지점과 수명주기

- 첫 사용자 키/버튼 입력: 기존 `audio.init()` 후 현재 장면의 곡을 시작한다. 자동재생 정책 때문에 생성자에서 즉시 오디오를 재생하지 않는다.
- `startNewRun()`: `audio.setScene('FLOOR', { floorNumber: 1 })` 예약.
- `loadFloor(floorNum)`: B3F/B5F는 `BOSS`, 나머지는 `FLOOR`로 전환한다.
- `triggerGameOver()`와 `triggerVictory()`: `audio.stopBgm({ fadeMs: 500 })`; 해당 SFX는 계속 재생한다.
- `btnSoundToggle`: `audio.enabled` 직접 대입을 없애고 `audio.setEnabled(!audio.enabled)`만 호출한다. 끄면 `requestedTrackId`를 보존한 채 예약 타이머와 예약 소스를 모두 취소하고, 켜면 그 한 곡만 재개한다.
- 탭이 숨겨지면 `visibilitychange`에서 정지하고, 다시 보이면 현재 장면 스텝 0부터 재개한다. 백그라운드 타이머 누적으로 여러 루프가 겹치면 안 된다.

## 2. U-02 방랑 상인 그리드와 암시장

### 2.1 데이터·상태 계약

```js
const SHOP_RULES = Object.freeze({
  guaranteedFloors: [2, 4],
  offersPerShop: 5,
  stealTriggersBoss: true,
});

/**
 * @typedef {Object} ShopOffer
 * @property {string} offerId
 * @property {'item'|'relic'} kind
 * @property {string} catalogId
 * @property {number} price
 * @property {boolean} sold
 */
/**
 * @typedef {Object} Merchant
 * @property {string} id
 * @property {number} floorNumber
 * @property {number} x
 * @property {number} y
 * @property {'friendly'|'hostile'|'defeated'} state
 * @property {boolean} theftAttempted
 * @property {ShopOffer[]} stock
 */
```

상점 풀에는 기존 장비/소모품과 신규 `invisibility_pot`, `invulnerability_pot`, 획득하지 않은 유물이 들어간다. 가격은 카탈로그에 `shopPrice`가 있으면 우선하고, 없으면 `common 25 / rare 60 / epic 110 / legendary 180`, 유물은 `160`을 기본값으로 사용한다. 동일 상점 재고에는 같은 `catalogId`를 중복 배치하지 않는다.

`DungeonFloor`에 `this.merchant = null`, `RogueliteGame`에 `this.currentMerchant = null`을 추가한다. B2F와 B4F에는 정확히 한 명을 생성하고 다른 층에는 생성하지 않는 것이 MVP 계약이다.

### 2.2 생성 및 순수 헬퍼

```js
/**
 * 현재 런의 보유 유물과 층을 반영하되 게임 상태를 변경하지 않는다.
 * @param {number} floorNumber
 * @param {{ownedRelicIds:Set<string>, rng?:()=>number}} context
 * @returns {ShopOffer[]}
 */
function createMerchantStock(floorNumber, { ownedRelicIds, rng = Math.random }) {}

class DungeonFloor {
  /**
   * 시작방/보스방/계단/제단과 겹치지 않는 방 중앙에 상인을 배치한다.
   * @param {{ownedRelicIds?:Set<string>, rng?:()=>number}=} context
   * @returns {Merchant|null}
   */
  placeMerchant({ ownedRelicIds = new Set(), rng = Math.random } = {}) {}
}
```

호출 순서는 `DungeonFloor.generate()`로 지형을 만든 뒤 `RogueliteGame.loadFloor()`가 `placeMerchant()`를 호출하는 방식으로 한다. 유물 보유 상태가 `DungeonFloor` 생성자에 침투하지 않게 하며, 이후 `spawnEntities()`는 상인 좌표에 몬스터와 아이템을 놓지 않는다.

### 2.3 상호작용·트랜잭션 인터페이스

```js
class RogueliteGame {
  /** 이동 목표가 상인 타일이면 이동하지 않고 SHOP 상태/모달로 진입한다. */
  interactWithMerchant(merchant) {}

  /** DOM을 stock의 읽기 전용 뷰로 렌더링한다. */
  renderShopModal(merchant) {}

  /**
   * 구매 가능 여부만 검사한다. 상태를 변경하지 않는다.
   * @returns {ActionResult} codes: CAN_BUY, SOLD, NOT_FOUND, NO_GOLD, INVENTORY_FULL, ALREADY_OWNED
   */
  canBuyShopOffer(offerId) {}

  /**
   * 검증 성공 시 지급 -> 골드 차감 -> sold=true 순으로 한 번만 커밋한다.
   * @returns {ActionResult} 성공 시 code PURCHASED와 offer/item 포함
   */
  buyShopOffer(offerId) {}

  /**
   * 런당 상점마다 1회. 상인을 공격하는 명시적 확인 버튼에서만 호출한다.
   * 물건을 즉시 훔치는 판정이 아니라 상인을 히든 보스로 전환한다.
   * @returns {ActionResult} codes: MERCHANT_HOSTILE, THEFT_ALREADY_ATTEMPTED, NO_MERCHANT
   */
  attemptShopTheft() {}

  /** SHOP 모달과 currentMerchant를 정리하고, friendly일 때만 PLAYING으로 복귀한다. */
  closeShopModal() {}

  /**
   * friendly 상인을 제거하고 같은 좌표에 shop_guard를 생성한다.
   * 보스 처치 시 팔리지 않은 재고 중 1개를 rng로 드롭한다.
   */
  awakenMerchantBoss(merchant, rng = Math.random) {}
}
```

`attemptShopTheft()`는 로드맵의 “상점 주인을 공격해 훔치기”를 확정 위험 선택으로 해석한다. 버튼 클릭 즉시 `merchant.state='hostile'`, 모달 종료, `shop_guard` 생성, `endTurn()` 1회로 처리한다. 숨은 보스를 쓰러뜨리기 전에는 구매할 수 없으며, 처치 보상은 `handleMonsterDeath()`의 `monster.type === 'shop_guard'` 분기에서 단 한 번 지급한다.

### 2.4 UI 계약

`index.html`에 다음 ID를 추가한다.

- `modalDungeonShop`, `shopGoldCount`, `shopOfferList`
- `btnShopSteal`, `btnShopLeave`

동적 구매 버튼은 `data-offer-id`만 보유하고 이벤트 위임으로 `buyShopOffer()`를 호출한다. 표시 가격은 `ShopOffer.price`에서만 읽으며 DOM 값을 다시 파싱하지 않는다. 상인 타일은 캔버스에서 `G` 또는 `🧙`로, 미니맵에서는 발견한 뒤 금색 점으로 표시한다.

## 3. U-03 비밀방·균열 벽·미믹 상자

### 3.1 탐험 객체 계약

기존 `tiles`의 `0=벽`, `1=바닥`은 그대로 유지하고 특수 상태를 별도 배열에 둔다. 이 방식은 `isWalkable()`/FOV/렌더러의 대규모 변경을 피한다.

```js
/** @typedef {{id:string,x:number,y:number,hp:number,revealed:boolean,destroyed:boolean,secretRoomId:string}} CrackedWall */
/** @typedef {{id:string,x1:number,y1:number,x2:number,y2:number,entrance:TilePos,revealed:boolean,lootClaimed:boolean}} SecretRoom */
/** @typedef {{id:string,x:number,y:number,source:'normal'|'secret',opened:boolean,resolved:boolean,mimicRoll:number|null}} TreasureChest */

class DungeonFloor {
  constructor(floorNumber) {
    this.secretRooms = [];
    this.crackedWalls = [];
    this.chests = [];
  }
}
```

### 3.2 생성 인터페이스와 불변식

```js
class DungeonFloor {
  /**
   * 지도의 외곽 1칸을 침범하지 않고, 기존 방/복도와 겹치지 않는 4x4 후보를 찾는다.
   * 후보가 없으면 정상적으로 null을 반환한다.
   * @returns {SecretRoom|null}
   */
  generateSecretRoom(rng = Math.random) {}

  /** 일반 방에 상자를 배치하며 시작/계단/제단/상인/몬스터 예약 좌표를 피한다. */
  placeTreasureChests(rng = Math.random) {}

  /** 계단/시작점/제단/함정/상인/상자 등 특수 좌표의 공통 중복 검사를 제공한다. */
  isTileReserved(x, y) {}

  /** 파괴 전 균열 벽은 false, 파괴 후에는 기존 tiles 판정을 반환한다. */
  isWalkable(x, y) {}

  /** 파괴 전 균열 벽은 true. 비밀방 내부 바닥은 입구가 열리기 전 FOV에 노출되지 않는다. */
  isOpaque(x, y) {}

  getCrackedWallAt(x, y) {}
  getChestAt(x, y) {}
}
```

비밀방 생성은 B1F~B4F에서 층당 최대 1회, `rng() < 0.55`일 때만 시도한다. 방 내부는 바닥으로 파되 유일한 연결점인 입구 좌표의 `tiles[y][x]`는 벽으로 유지한다. 균열 벽이 파괴될 때 해당 타일을 `1`로 바꾸고, `secretRoom.revealed=true`로 바꾼 뒤 FOV를 재계산한다. 생성 실패는 일반 층 생성 실패로 취급하지 않는다. 층 로드 순서는 `generateSecretRoom()` → `placeMerchant()` → `placeTreasureChests()` → `spawnEntities()`이며, 공통 `isTileReserved()`로 좌표 중복을 막는다.

### 3.3 균열 파괴 인터페이스

```js
/**
 * @typedef {Object} WallHit
 * @property {'bomb'|'charge'|'power_strike'|'other'} source
 * @property {number} damage
 * @property {boolean} canBreach
 */

class RogueliteGame {
  /**
   * @returns {ActionResult} codes: WALL_DAMAGED, WALL_BROKEN, NOT_CRACKED, CANNOT_BREACH
   */
  damageCrackedWall(x, y, hit) {}

  /** 폭탄 1개를 찾고, 성공 가능한 경우에만 소비한 뒤 인접 균열 벽에 99 피해를 준다. */
  useBlastBombAt(x, y) {}
}
```

신규 아이템 `blast_bomb`은 `type:'bomb'`, `effect:{wallDamage:99}`를 가진다. 현재 전사에게 별도 Charge 스킬이 없으므로 MVP에서는 인접 적이 없는 상태에서 `power_strike` 사용 시 인접 균열 벽을 우선 탐색해 `canBreach:true`로 1회 타격한다. 향후 Charge가 추가되면 동일 `damageCrackedWall(..., {source:'charge'})` 계약을 재사용한다. 일반 이동으로 벽에 부딪히거나 기본 공격으로는 균열을 파괴하지 못한다.

### 3.4 상자와 미믹 인터페이스

```js
class RogueliteGame {
  /**
   * 이동 목표가 닫힌 상자면 플레이어를 이동시키지 않고 상자를 연다.
   * mimicRoll은 최초 호출에만 저장되어 저장/렌더 반복으로 재추첨되지 않는다.
   * @returns {ActionResult} codes: CHEST_LOOTED, MIMIC_AWAKENED, CHEST_ALREADY_OPEN
   */
  openChest(chest, rng = Math.random) {}

  /**
   * 상자를 제거하고 같은 좌표에 mimic을 생성한다. 인접 상태에서 기존
   * monsterTurn(mimic)을 즉시 1회 호출한 뒤 skipNextTurn=true로 둔다.
   * 따라서 회피/전사 피해 감소/보호막/가시 망토를 포함한 공격 규칙을 재사용하고,
   * 직후 endTurn에서는 두 번째 공격을 하지 않는다.
   */
  awakenMimic(chest) {}

  /** source가 secret이면 고급 가중치, 아니면 일반 가중치로 보상 명세를 반환한다. */
  rollChestReward(chest, rng = Math.random) {}

  /** 인벤토리 공간/중복 유물 규칙을 검증한 후 골드·아이템·유물을 한 번만 지급한다. */
  grantChestReward(chest, reward) {}
}
```

모든 미개봉 상자는 최초 개봉 시 정확히 `15%`(`rng() < 0.15`)로 미믹이 된다. 비밀방 상자도 예외가 아니다. `MONSTER_TEMPLATES.mimic`은 해당 층 일반 몬스터보다 높은 체력/공격력과 `isMimic:true`를 갖는다.

렌더 순서는 지형 → 균열 벽 → 상자 → 제단/상인 → 아이템 → 몬스터 → 플레이어다. 미니맵은 열린 비밀방만 그리며, 닫힌 비밀방과 미확인 균열은 표시하지 않는다.

## 4. U-04 유물 2세트 시너지

### 4.1 카탈로그 계약

기존 유물 5종은 유지하고 아래 유물 4종을 추가한다: `void_talisman`(공허의 부적), `emperor_signet`(황제의 인장), `sun_medal`(태양의 메달), `blood_chalice`(피의 성배).

```js
const RELIC_SYNERGY_CATALOG = Object.freeze([
  {
    id: 'dark_empire_legacy',
    name: '암흑 제국의 유산',
    requiredRelicIds: ['void_talisman', 'emperor_signet'],
    threshold: 2,
    description: '공격 적중 시 20% 확률로 15 암흑 추가 피해',
  },
  {
    id: 'phoenix_oath',
    name: '불사조의 맹세',
    requiredRelicIds: ['phoenix_feather', 'sun_medal'],
    threshold: 2,
    description: '부활 시 HP 100%, 주변 모든 적에게 50 화염 피해',
  },
  {
    id: 'vampire_feast',
    name: '흡혈귀의 연회',
    requiredRelicIds: ['vampire_fang', 'blood_chalice'],
    threshold: 2,
    description: '출혈 중인 적 대상 흡혈량 2배',
  },
]);
```

`RogueliteGame`에 `this.activeSynergyIds = new Set()`을 추가하고 새 런 시작 시 비운다. 활성 여부는 저장하지 않고 보유 유물에서 언제든 재계산 가능해야 한다.

### 4.2 활성화와 UI 인터페이스

```js
/**
 * @param {Iterable<string>} ownedRelicIds
 * @returns {Set<string>}
 */
function computeActiveSynergies(ownedRelicIds) {}

class RogueliteGame {
  /** 이전/새 Set의 차이를 구해 새 활성화만 로그·SFX 처리하고 UI를 갱신한다. */
  recomputeRelicSynergies({ announce = true } = {}) {}

  hasSynergy(synergyId) {}

  /** 기존 유물 배지와 활성 세트 배지를 함께 그리되 카탈로그 객체를 변경하지 않는다. */
  updateRelicsUI() {}
}
```

`addRelic()` 성공 직후 `recomputeRelicSynergies()`를 호출한다. 중복 유물이 영혼으로 환원되는 경로에서는 호출하지 않는다. 도감의 각 시너지는 `보유 수/2`를 표시하고 활성 세트에는 `.synergy-badge--active`를 적용한다.

### 4.3 전투 이벤트 인터페이스

분산된 `hasRelic()` 분기를 더 늘리지 않도록 세 가지 명시적 해석기를 둔다.

```js
class RogueliteGame {
  /**
   * 기본 공격 피해를 적용한 직후, 사망 처리 전에 호출한다.
   * proc당 rng는 한 번만 소비한다.
   * @returns {{extraDamage:number, procs:string[]}}
   */
  resolveOnHitRelicEffects({ target, damage, isCrit }, rng = Math.random) {}

  /**
   * 기존 흡혈 송곳니가 발동할 때 사용한다.
   * vampire_feast 활성 + 타격 직전 target.statusEffects.bleed>0이면 기본 회복량의 2배.
   * @returns {number} 실제 회복량(최소 1, 최대 잃은 HP)
   */
  resolveVampireHeal({ target, damage, isCrit }) {}

  /**
   * 사망 판정에서 한 번만 호출한다.
   * @returns {ActionResult} codes: REVIVED, CANNOT_REVIVE
   */
  tryRelicRevive() {}
}
```

적중 처리 순서는 다음으로 고정한다.

1. 치명타를 포함한 기본 피해 산출 및 적용.
2. 타격 직전 상태 스냅샷을 사용해 `resolveVampireHeal()` 적용.
3. `resolveOnHitRelicEffects()`가 `dark_empire_legacy` 활성 시 한 번만 20% 판정하고 15 피해 적용.
4. 기본+추가 피해를 모두 적용한 뒤 `handleMonsterDeath()`를 최대 한 번 호출.

출혈 상태가 현재 엔진에 없으므로 몬스터 `statusEffects`에 `bleed:0`, `bleedDamage:0`을 추가하고 `processMonsterStatusEffects()`가 턴당 피해와 지속시간 감소를 담당한다. `blood_chalice` 자체의 기본 효과는 치명타 시 2턴 출혈(턴당 4 피해)로 정의하여 시너지 조건이 실제 런에서 성립하게 한다. 출혈 틱으로 사망해도 `handleMonsterDeath()`는 한 번만 호출한다.

`tryRelicRevive()`는 `phoenix_feather` 보유 및 `!phoenixUsed`일 때만 성공한다. 기본은 최대 HP 50%로 부활하고, `phoenix_oath` 활성 시 최대 HP 100%와 플레이어 반경 3칸 내 모든 적에게 방어 무시 50 화염 피해를 적용한다. 광역 피해 사망자는 복사 배열에서 순회해 각각 한 번만 `handleMonsterDeath()`를 호출하며, 최종 보스 사망으로 Victory가 되면 이후 몬스터 처리를 즉시 중단한다.

## 5. 기존 함수 변경 요약

| 기존 함수 | 필요한 변경 | 유지해야 할 계약 |
|---|---|---|
| `RetroAudioEngine.init()` | GainNode 그래프 및 BGM 재개 준비 | SFX 호출 전 여러 번 호출해도 안전 |
| `RogueliteGame.startNewRun()` | 신규 런 상태와 시너지 Set 초기화, 장면 지정 | 메타 업그레이드와 시작 아이템 보존 |
| `RogueliteGame.loadFloor()` | 상인/비밀방/상자 배치 후 엔티티 스폰, BGM 전환 | FOV·카메라·HUD·배너 순서 보존 |
| `RogueliteGame.spawnEntities()` | 특수 객체 좌표 제외 | 보스 및 미니보스 보장 스폰 |
| `RogueliteGame.handlePlayerMove()` | 상인→상자→몬스터→바닥 순 상호작용 | 성공 행동당 `endTurn()` 최대 1회 |
| `RogueliteGame.playerAttack()` | 적중/흡혈/추가 피해/사망 파이프라인 | 치명타·SFX·로그·파티클 보존 |
| `RogueliteGame.endTurn()` | `tryRelicRevive()` 호출, mimic skip 처리 | 비 PLAYING 상태에서 즉시 반환 |
| `RogueliteGame.addRelic()` | 성공 시 시너지 재계산 | 중복 환원 규칙 보존 |
| `RogueliteGame.render()` | 균열·상자·상인 레이어 추가 | 미탐색 타일 정보 누출 금지 |
| `RogueliteGame.initDOM()` | 상점 위임 이벤트 및 오디오 setter | 활성 모달 중 게임 입력 차단 |

## 6. 완료 기준과 테스트 매트릭스

### 오디오

- 사용자 입력 전 `AudioContext.start/resume` 호출이 없어 자동재생 오류가 나지 않는다.
- 같은 층을 재렌더해도 scheduler가 하나뿐이고 동일 트랙이 중첩되지 않는다.
- B1F, B3F, B5F 진입 시 각각 `crypt`, `boss_b3`, `boss_b5`가 선택된다.
- 음소거 시 SFX와 BGM이 모두 멈추고, 다시 켜면 현재 장면에 맞는 한 곡만 재개된다.

### 상점

- B2F와 B4F에 정확히 한 명, 다른 층에는 0명이 생성된다.
- 골드 부족/가방 가득 참/판매 완료 상태에서 구매는 어떤 상태도 변경하지 않는다.
- 성공 구매는 골드를 정확히 한 번 차감하고 재고를 정확히 한 번 판매 완료로 만든다.
- 공격 선택은 취소할 수 없는 확인 이후 상인을 `shop_guard`로 바꾸며, 동시에 상점 모달과 전투 턴이 진행되지 않는다.

### 비밀방·미믹

- 비밀방 후보가 없는 맵도 층 로드에 성공한다.
- 균열 파괴 전에는 통행/FOV가 차단되고 파괴 후 즉시 진입·탐색 가능하다.
- `rng=0.149999`는 미믹, `rng=0.15`는 일반 보상이며 한 상자를 재호출해도 판정이 바뀌지 않는다.
- 미믹 기습과 직후 몬스터 턴이 겹쳐 한 행동에 두 번 공격하지 않는다.

### 유물 시너지와 회귀

- 각 세트는 요구 유물 1개일 때 비활성, 2개일 때 한 번만 활성화 안내된다.
- 암흑 추가 피해의 20% 경계와 추가 피해 후 사망 보상을 검증한다.
- 출혈 대상 치명타 흡혈은 2배, 비출혈 대상은 기존 25%이며 최대 HP를 넘지 않는다.
- 불사조 단독은 50%, 불사조 세트는 100% 부활·반경 3칸 50 피해이고 런당 한 번뿐이다.
- 기존 3직업, 5층 이동, 제단, 메타 상점, 인벤토리, 보스 Victory, Game Over 흐름이 그대로 동작한다.

## 7. 권장 구현 순서

1. 카탈로그/순수 헬퍼와 상태 필드를 추가하고 단위 경계 테스트를 만든다.
2. BGM 엔진을 기존 사운드 토글과 연결한다.
3. 상인 생성·상점 모달·원자적 구매·히든 보스 전환을 연결한다.
4. 비밀방 생성·균열 파괴·상자/미믹을 이동과 렌더 파이프라인에 연결한다.
5. 유물 시너지 재계산과 전투 해석기를 연결한 뒤 전체 회귀 테스트를 수행한다.
