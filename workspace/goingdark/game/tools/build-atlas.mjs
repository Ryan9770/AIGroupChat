// ============================================================================
// 스프라이트 아틀라스 자동 생성기 (tools/build-atlas.mjs)
// 0x72 DungeonTileset II의 tile_list_v1.7.txt를 파싱하여
// 게임 개념명과 정확히 매핑된 src/data/spriteAtlasDefs.js 자동 생성
// P2-01 (D-01, D-09): 수작업 좌표 제거 및 기획서 §5.3 매핑표 준수
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TILE_LIST_PATH = path.resolve(__dirname, '../public/assets/sprites/tile_list_v1.7.txt');
const OUTPUT_PATH = path.resolve(__dirname, '../src/data/spriteAtlasDefs.js');

function parseTileList(content) {
  const tiles = {};
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 5) {
      const [name, x, y, w, h] = parts;
      tiles[name] = {
        x: parseInt(x, 10),
        y: parseInt(y, 10),
        w: parseInt(w, 10),
        h: parseInt(h, 10),
      };
    }
  }
  return tiles;
}

function generateAtlas() {
  const content = fs.readFileSync(TILE_LIST_PATH, 'utf-8');
  const raw = parseTileList(content);

  const get = (name) => {
    if (!raw[name]) {
      console.warn(`[WARN] Tile '${name}' not found in tile_list_v1.7.txt`);
      return { x: 0, y: 0, w: 16, h: 16 };
    }
    return raw[name];
  };

  const getFrames = (prefix, count) => {
    const frames = [];
    for (let i = 0; i < count; i++) {
      frames.push(get(`${prefix}_f${i}`));
    }
    return frames;
  };

  // §5.3 매핑표 준수
  const defs = {
    // 환경 타일
    floor_1: get('floor_1'),
    floor_2: get('floor_2'),
    floor_3: get('floor_3'),
    floor_4: get('floor_4'),
    floor_5: get('floor_5'),
    floor_6: get('floor_6'),
    floor_7: get('floor_7'),
    floor_8: get('floor_8'),

    // 벽 타일 세트 (오토타일용)
    wall_mid: get('wall_mid'),
    wall_left: get('wall_left'),
    wall_right: get('wall_right'),
    wall_top_mid: get('wall_top_mid'),
    wall_top_left: get('wall_top_left'),
    wall_top_right: get('wall_top_right'),
    wall_edge_left: get('wall_edge_left'),
    wall_edge_right: get('wall_edge_right'),
    wall_edge_mid_left: get('wall_edge_mid_left'),
    wall_edge_mid_right: get('wall_edge_mid_right'),
    wall_edge_bottom_left: get('wall_edge_bottom_left'),
    wall_edge_bottom_right: get('wall_edge_bottom_right'),
    wall_edge_top_left: get('wall_edge_top_left'),
    wall_edge_top_right: get('wall_edge_top_right'),

    // 문 및 통로
    door_closed: get('doors_leaf_closed'),
    door_open: get('doors_leaf_open'),
    doors_frame_left: get('doors_frame_left'),
    doors_frame_right: get('doors_frame_right'),

    // 계단
    stairs_down: get('floor_stairs'),
    stairs_up: get('floor_ladder'),

    // 상자 및 미믹
    chest_closed: get('chest_empty_open_anim_f0'),
    chest_open: get('chest_full_open_anim_f2'),
    chest_mimic_open: get('chest_mimic_open_anim_f2'),

    // 함정
    trap_spike_down: get('floor_spikes_anim_f0'),
    trap_spike_up: get('floor_spikes_anim_f3'),

    // 제단 및 탈출 게이트 (0x72 타일 오류 정정: 빨간 샘물 -> 청백 샘물/구멍)
    altar: get('wall_fountain_mid_blue_anim_f0'),
    altar_basin: get('wall_fountain_basin_blue_anim_f0'),
    gate_crystal: get('hole'),
    hole: get('hole'),

    // 무기
    weapon_knife: get('weapon_knife'),
    weapon_sword: get('weapon_regular_sword'),
    weapon_axe: get('weapon_axe'),
    weapon_mace: get('weapon_mace'),
    weapon_bow: get('weapon_bow'),

    // 캐릭터 및 적 애니메이션
    player: {
      idle: getFrames('knight_m_idle_anim', 4),
      run: getFrames('knight_m_run_anim', 4),
      hit: [get('knight_m_hit_anim_f0')],
    },

    skeleton: {
      idle: getFrames('skelet_idle_anim', 4),
      run: getFrames('skelet_run_anim', 4),
      hit: [get('skelet_idle_anim_f0')],
    },

    skeletonCaptain: {
      idle: getFrames('skelet_idle_anim', 4),
      run: getFrames('skelet_run_anim', 4),
      hit: [get('skelet_idle_anim_f0')],
      scale: 1.25,
    },

    royalGuard: {
      idle: getFrames('knight_f_idle_anim', 4),
      run: getFrames('knight_f_run_anim', 4),
      hit: [get('knight_f_hit_anim_f0')],
    },

    mite: {
      idle: getFrames('tiny_slug_anim', 4),
      run: getFrames('tiny_slug_anim', 4),
      hit: [get('tiny_slug_anim_f0')],
    },

    golem: {
      idle: getFrames('ogre_idle_anim', 4),
      run: getFrames('ogre_run_anim', 4),
      hit: [get('ogre_idle_anim_f0')],
    },

    cultist: {
      idle: getFrames('necromancer_anim', 4),
      run: getFrames('necromancer_anim', 4),
      hit: [get('necromancer_anim_f0')],
    },

    wraith: {
      idle: getFrames('chort_idle_anim', 4),
      run: getFrames('chort_run_anim', 4),
      hit: [get('chort_idle_anim_f0')],
    },

    mimic: {
      idle: [get('chest_mimic_open_anim_f0')],
      open: getFrames('chest_mimic_open_anim', 3),
      hit: [get('chest_mimic_open_anim_f1')],
    },

    boss_warden: {
      idle: getFrames('big_demon_idle_anim', 4),
      run: getFrames('big_demon_run_anim', 4),
      hit: [get('big_demon_idle_anim_f0')],
    },

    boss_hart: {
      idle: getFrames('big_zombie_idle_anim', 4),
      run: getFrames('big_zombie_run_anim', 4),
      hit: [get('big_zombie_idle_anim_f0')],
    },
  };

  const outputCode = `// Auto-generated by tools/build-atlas.mjs - DO NOT EDIT DIRECTLY\n` +
    `export const SPRITE_DEFS = ${JSON.stringify(defs, null, 2)};\n`;

  fs.writeFileSync(OUTPUT_PATH, outputCode, 'utf-8');
  console.log(`✓ Generated ${OUTPUT_PATH} with ${Object.keys(defs).length} sprite definitions.`);
}

generateAtlas();
