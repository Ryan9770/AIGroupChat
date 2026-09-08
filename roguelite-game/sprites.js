// =============================================================================
// Sprite Forge — 절차적 픽셀 아트 캐릭터/적 스프라이트 생성기
// =============================================================================
//
// 외부 에셋 없이 게임 내에서 캐릭터·적 스프라이트를 "이미지 생성"으로 만든다.
// 각 아키타입은 16×16 디자인 공간에서 사각형만으로 그려지며, 1px 심연색
// (#08070B) 외곽선이 자동으로 입혀진다. 아트 바이블(LORE_AND_ART_GUIDE.md
// §4.1)의 원칙을 따른다: 순수 검정 대신 #08070B, 순수 흰색 대신 #E8E3D5,
// 안티앨리어싱/서브픽셀 이동 금지, 정수 좌표 스냅.
//
// 라이선스: 이 파일이 생성하는 모든 픽셀은 본 저장소에서 절차적으로
// 계산된 것으로, 서드파티 에셋을 포함하지 않는다.
// =============================================================================

(function (global) {
  'use strict';

  const INK = '#08070B';
  const WHITE = '#E8E3D5';

  function makeCanvas(s) {
    if (typeof document === 'undefined' || !document.createElement) return null;
    const c = document.createElement('canvas');
    c.width = s;
    c.height = s;
    const g = c.getContext('2d');
    if (!g) return null;
    g.imageSmoothingEnabled = false;
    return { c, g };
  }

  // 16×16 디자인 공간 → 실제 픽셀. 위치/크기를 각각 반올림해 빈틈을 막는다.
  function painter(g, S) {
    const k = S / 16;
    return function r(x, y, w, h, color) {
      if (!color) return;
      const x0 = Math.round(x * k);
      const y0 = Math.round(y * k);
      const x1 = Math.round((x + w) * k);
      const y1 = Math.round((y + h) * k);
      g.fillStyle = color;
      g.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
    };
  }

  // 실루엣 주위에 1px(스케일 비례) 외곽선을 입힌다.
  function outlined(drawFn, S) {
    const main = makeCanvas(S);
    if (!main) return null;
    drawFn(painter(main.g, S), main.g, S);

    const mask = makeCanvas(S);
    mask.g.drawImage(main.c, 0, 0);
    mask.g.globalCompositeOperation = 'source-in';
    mask.g.fillStyle = INK;
    mask.g.fillRect(0, 0, S, S);

    const out = makeCanvas(S);
    const o = Math.max(1, Math.round(S / 16));
    const offs = [
      [-o, 0], [o, 0], [0, -o], [0, o],
      [-o, -o], [o, o], [-o, o], [o, -o],
    ];
    for (let i = 0; i < offs.length; i++) {
      out.g.drawImage(mask.c, offs[i][0], offs[i][1]);
    }
    out.g.drawImage(main.c, 0, 0);
    return out.c;
  }

  // ---------------------------------------------------------------------------
  // 아키타입 렌더러 — (r, P) : r=사각형 페인터, P=팔레트
  // ---------------------------------------------------------------------------
  const ARCH = {
    slime(r, P) {
      r(4, 6, 8, 7, P.base);
      r(4, 6, 8, 3, P.light);
      r(4, 12, 8, 1, P.shade);
      r(5, 11, 6, 2, P.shade);
      r(5, 7, 2, 1, WHITE);
      r(6, 8, 1, 2, INK);
      r(9, 8, 1, 2, INK);
    },

    spore(r, P) {
      ARCH.slime(r, P);
      r(7, 2, 2, 5, P.shade);
      r(5, 1, 6, 2, P.light);
      r(5, 2, 1, 1, WHITE);
      r(10, 2, 1, 1, WHITE);
    },

    bat(r, P) {
      r(1, 5, 4, 4, P.wing);
      r(0, 4, 2, 2, P.wing);
      r(4, 4, 1, 2, P.wing);
      r(11, 5, 4, 4, P.wing);
      r(14, 4, 2, 2, P.wing);
      r(11, 4, 1, 2, P.wing);
      r(6, 5, 4, 5, P.base);
      r(6, 3, 1, 2, P.base);
      r(9, 3, 1, 2, P.base);
      r(7, 6, 1, 1, P.eye);
      r(8, 6, 1, 1, P.eye);
      r(7, 9, 2, 2, P.base);
    },

    rat(r, P) {
      r(2, 9, 3, 1, P.tail);
      r(3, 7, 7, 5, P.base);
      r(5, 6, 4, 1, P.shade);
      r(9, 6, 4, 4, P.base);
      r(9, 4, 2, 2, P.base);
      r(9, 5, 1, 1, P.shade);
      r(12, 8, 1, 1, P.eye);
      r(13, 8, 1, 1, P.tail);
      r(4, 12, 1, 2, P.dark);
      r(8, 12, 1, 2, P.dark);
    },

    goblin(r, P) {
      r(4, 2, 6, 4, P.hood);
      r(5, 3, 1, 1, WHITE);
      r(8, 4, 1, 1, WHITE);
      r(6, 5, 4, 3, P.skin);
      r(7, 6, 1, 1, P.eye);
      r(5, 8, 6, 5, P.cloth);
      r(12, 1, 1, 13, P.wood);
      r(11, 1, 1, 2, P.wood);
      r(11, 12, 1, 2, P.wood);
      r(11, 7, 1, 1, P.string);
      r(6, 13, 1, 2, P.dark);
      r(9, 13, 1, 2, P.dark);
    },

    spider(r, P) {
      r(1, 5, 4, 1, P.leg);
      r(1, 7, 4, 1, P.leg);
      r(11, 5, 4, 1, P.leg);
      r(11, 7, 4, 1, P.leg);
      r(1, 4, 1, 2, P.leg);
      r(3, 3, 1, 2, P.leg);
      r(12, 3, 1, 2, P.leg);
      r(14, 4, 1, 2, P.leg);
      r(2, 9, 3, 1, P.leg);
      r(11, 9, 3, 1, P.leg);
      r(5, 6, 6, 3, P.head);
      r(5, 8, 6, 5, P.base);
      r(7, 5, 2, 1, P.accent);
      r(6, 6, 1, 1, P.eye);
      r(9, 6, 1, 1, P.eye);
    },

    skeleton(r, P) {
      if (P.cape) r(9, 5, 3, 9, P.cape);
      r(2, 6, 3, 6, P.metal);
      r(3, 8, 1, 2, P.accent);
      r(6, 2, 4, 4, P.bone);
      r(6, 4, 1, 1, INK);
      r(8, 4, 1, 1, INK);
      r(7, 6, 2, 1, INK);
      r(6, 7, 4, 4, P.bone);
      r(6, 8, 4, 1, INK);
      r(6, 10, 4, 1, INK);
      r(6, 11, 1, 3, P.bone);
      r(9, 11, 1, 3, P.bone);
      r(11, 2, 1, 9, P.metal);
      r(10, 10, 3, 1, P.accent);
    },

    caster(r, P) {
      r(4, 7, 8, 7, P.robe);
      r(3, 12, 10, 2, P.robe);
      r(5, 10, 1, 1, P.spark);
      r(9, 11, 1, 1, P.spark);
      r(5, 2, 6, 5, P.hood);
      r(6, 5, 4, 3, INK);
      r(7, 6, 1, 1, P.eye);
      r(9, 6, 1, 1, P.eye);
      r(12, 1, 1, 13, P.staff);
      r(11, 0, 3, 3, P.orb);
      if (P.book) {
        r(1, 7, 3, 2, P.book);
        r(1, 7, 3, 1, WHITE);
      }
    },

    imp(r, P) {
      r(2, 5, 3, 4, P.wing);
      r(11, 5, 3, 4, P.wing);
      r(5, 5, 6, 7, P.base);
      r(5, 3, 1, 2, P.base);
      r(10, 3, 1, 2, P.base);
      r(6, 4, 1, 1, P.flame);
      r(9, 4, 1, 1, P.flame);
      r(6, 7, 1, 1, P.eye);
      r(9, 7, 1, 1, P.eye);
      r(11, 10, 3, 1, P.base);
      r(13, 9, 1, 2, P.base);
      r(6, 12, 1, 2, P.base);
      r(9, 12, 1, 2, P.base);
    },

    hound(r, P) {
      r(3, 6, 8, 6, P.base);
      r(9, 5, 4, 4, P.base);
      r(12, 7, 2, 1, INK);
      r(13, 6, 1, 1, P.eye);
      r(4, 4, 1, 2, P.flame);
      r(6, 4, 1, 2, P.flame);
      r(8, 3, 1, 3, P.flame);
      r(1, 7, 3, 1, P.base);
      r(4, 12, 1, 3, P.dark);
      r(6, 12, 1, 3, P.dark);
      r(9, 12, 1, 3, P.dark);
      r(11, 12, 1, 3, P.dark);
    },

    golem(r, P) {
      r(2, 4, 12, 10, P.rock);
      r(2, 4, 12, 3, P.light);
      r(1, 6, 2, 6, P.rock);
      r(13, 6, 2, 6, P.rock);
      r(4, 3, 8, 2, P.rock);
      r(4, 7, 1, 4, P.magma);
      r(8, 6, 1, 5, P.magma);
      r(6, 9, 3, 1, P.magma);
      r(5, 4, 6, 1, P.magma);
      r(3, 14, 3, 2, P.dark);
      r(10, 14, 3, 2, P.dark);
    },

    drake(r, P) {
      r(1, 2, 6, 7, P.wing);
      r(2, 1, 3, 2, P.wing);
      r(1, 8, 5, 1, P.wing);
      r(1, 10, 5, 1, P.base);
      r(4, 7, 8, 5, P.base);
      r(5, 10, 6, 1, P.belly);
      r(5, 12, 2, 3, P.base);
      r(9, 12, 2, 3, P.base);
      r(9, 3, 3, 4, P.base);
      r(11, 4, 4, 3, P.base);
      r(9, 1, 1, 2, P.base);
      r(11, 1, 1, 2, P.base);
      r(13, 5, 1, 1, P.eye);
      if (P.chalice) r(6, 9, 2, 2, P.chalice);
    },

    merchant(r, P) {
      r(4, 8, 8, 6, P.robe);
      r(3, 13, 10, 1, P.robe);
      r(6, 4, 4, 3, P.skin);
      r(5, 7, 6, 3, P.beard);
      r(4, 2, 8, 2, P.hat);
      r(6, 1, 4, 2, P.hat);
      r(7, 5, 1, 1, P.eye);
      r(12, 3, 1, 11, P.staff);
      r(11, 2, 3, 2, P.gem);
      r(2, 9, 3, 3, P.gold);
    },

    mimic(r, P) {
      r(3, 7, 10, 7, P.wood);
      r(3, 7, 10, 1, P.gold);
      r(3, 13, 10, 1, P.gold);
      r(7, 10, 2, 3, P.gold);
      r(3, 3, 10, 3, P.wood);
      r(3, 5, 10, 1, P.gold);
      r(4, 7, 8, 2, INK);
      r(4, 6, 8, 1, WHITE);
      r(5, 6, 1, 1, P.wood);
      r(7, 6, 1, 1, P.wood);
      r(9, 6, 1, 1, P.wood);
      r(11, 6, 1, 1, P.wood);
      r(4, 9, 8, 1, WHITE);
      r(6, 4, 1, 1, P.eye);
      r(9, 4, 1, 1, P.eye);
      r(7, 9, 2, 2, P.tongue);
    },

    knight(r, P) {
      r(9, 6, 3, 7, P.cape);
      r(2, 6, 4, 7, P.metal);
      r(2, 6, 4, 1, P.light);
      r(3, 8, 2, 3, P.accent);
      r(5, 7, 5, 6, P.metal);
      r(5, 7, 5, 1, P.light);
      r(6, 13, 1, 2, P.dark);
      r(8, 13, 1, 2, P.dark);
      r(6, 2, 4, 4, P.metal);
      r(6, 4, 4, 1, INK);
      r(7, 1, 2, 1, P.accent);
      r(11, 2, 1, 9, P.steel);
      r(10, 10, 3, 1, P.accent);
    },

    rogue(r, P) {
      r(4, 6, 7, 7, P.base);
      r(3, 11, 9, 2, P.base);
      r(4, 11, 7, 1, P.accent);
      r(5, 2, 5, 4, P.base);
      r(6, 5, 3, 2, INK);
      r(7, 5, 1, 1, P.accent);
      r(2, 7, 1, 4, P.steel);
      r(2, 7, 1, 1, P.accent);
      r(13, 6, 1, 4, P.steel);
      r(13, 9, 1, 1, P.accent);
      r(6, 13, 1, 2, P.dark);
      r(8, 13, 1, 2, P.dark);
    },
  };

  // ---------------------------------------------------------------------------
  // 몬스터 템플릿 키 / 플레이어 classId → [아키타입, 팔레트]
  // ---------------------------------------------------------------------------
  const VARIANTS = {
    slime: ['slime', { base: '#2ecc71', light: '#5be08e', shade: '#1c8f4c' }],
    spore: ['spore', { base: '#26de81', light: '#7defb0', shade: '#12a35c' }],
    bat: ['bat', { base: '#8a5fc9', wing: '#4a2d75', eye: '#ff3b3b' }],
    rat: ['rat', { base: '#b6a34a', shade: '#8a7a2e', tail: '#d98cae', eye: '#ff3838', dark: '#4a4020' }],
    goblin: ['goblin', { hood: '#b5423a', skin: '#6aa84a', eye: '#f7d038', cloth: '#4a5540', wood: '#7a5a34', string: '#d8d8d8', dark: '#2f3a28' }],
    spider: ['spider', { base: '#2a1a22', head: '#3a2530', leg: '#1a1016', eye: '#eb3b5a', accent: '#c9a24a' }],
    skeleton: ['skeleton', { bone: '#d9d2bf', metal: '#7d7a72', accent: '#b5892f' }],
    necromancer: ['caster', { robe: '#5b3a86', hood: '#3d2a5c', eye: '#26de81', staff: '#d1d8e0', orb: '#26de81', spark: '#9b7fd6' }],
    death_knight: ['skeleton', { bone: '#b9b2a0', metal: '#3f4652', accent: '#fc5c65', cape: '#7a1f26' }],
    imp: ['imp', { base: '#e0392b', wing: '#7a1c15', eye: '#ffd23f', flame: '#ff9f1a' }],
    hound: ['hound', { base: '#8b4fb0', eye: '#ff9f1a', flame: '#c56cf0', dark: '#3a2350' }],
    golem: ['golem', { rock: '#6d5b4a', light: '#8a7461', magma: '#ff7b1a', dark: '#3a2f26' }],
    void_hatchling: ['drake', { base: '#6a4a8a', belly: '#8a6aaa', wing: '#43305f', eye: '#d8b0ff' }],
    boss: ['drake', { base: '#2b2436', belly: '#4a4358', wing: '#181426', eye: '#00F0FF', chalice: '#f1c40f' }],
    shop_guard: ['merchant', { robe: '#b5451c', skin: '#d8a878', beard: '#e8e3d5', hat: '#7a2a10', eye: '#ff3b3b', staff: '#5a3a24', gem: '#ff3b3b', gold: '#f1c40f' }],
    merchant: ['merchant', { robe: '#d98a2b', skin: '#d8a878', beard: '#cfcfcf', hat: '#b5701c', eye: '#4a3010', staff: '#7a5a34', gem: '#f1c40f', gold: '#f1c40f' }],
    mimic: ['mimic', { wood: '#9a6b3a', gold: '#e0b53f', eye: '#f7d038', tongue: '#c0392b' }],
    warrior: ['knight', { metal: '#8ea0b8', light: '#c3d0e0', dark: '#3a4358', steel: '#d5deea', accent: '#f1c40f', cape: '#cfe0ef' }],
    rogue: ['rogue', { base: '#7a2b52', accent: '#26de81', steel: '#d5deea', dark: '#2a1220', light: '#b6437f' }],
    mage: ['caster', { robe: '#2e8b9b', hood: '#1f5f6b', eye: '#7ce0ff', staff: '#b98b5a', orb: '#7ce0ff', spark: '#7ce0ff', book: '#cfe0ef' }],
  };

  const cache = {};

  function get(key, size) {
    const v = VARIANTS[key];
    if (!v) return null;
    const S = size || 32;
    const ck = key + '@' + S;
    if (Object.prototype.hasOwnProperty.call(cache, ck)) return cache[ck];
    let canvas = null;
    try {
      const fn = ARCH[v[0]];
      canvas = outlined((r) => fn(r, v[1]), S);
    } catch (e) {
      canvas = null;
    }
    cache[ck] = canvas;
    return canvas;
  }

  function dataURL(key, size) {
    const c = get(key, size || 48);
    try {
      return c ? c.toDataURL('image/png') : null;
    } catch (e) {
      return null;
    }
  }

  global.SpriteForge = {
    get,
    dataURL,
    keys: Object.keys(VARIANTS),
  };
})(typeof window !== 'undefined' ? window : globalThis);
