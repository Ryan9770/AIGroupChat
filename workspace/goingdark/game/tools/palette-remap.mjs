// ============================================================================
// 팔레트 리매핑 도구 (tools/palette-remap.mjs)
// 14_antigravity_production_brief.md P2-03 준수
// 빌드 타임에 스프라이트 시트의 픽셀을 프로젝트 32색 램프 팔레트로 리매핑
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { hexToRgb, findNearestPaletteColor } from '../src/data/palette.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INPUT_PNG = path.resolve(__dirname, '../public/assets/sprites/0x72_DungeonTilesetII_v1.7.png');
const OUTPUT_PNG = path.resolve(__dirname, '../public/assets/sprites/0x72_DungeonTilesetII_remapped.png');

export function remapSpritesheet(inputPath, outputPath) {
  if (!fs.existsSync(inputPath)) {
    console.error(`[ERROR] Input spritesheet not found: ${inputPath}`);
    return;
  }

  const data = fs.readFileSync(inputPath);
  const png = PNG.sync.read(data);

  const paletteMap = new Map();
  // 캐싱: 고유 24비트 RGB -> 리매핑된 RGB
  const getMappedRgb = (r, g, b) => {
    const key = (r << 16) | (g << 8) | b;
    if (paletteMap.has(key)) return paletteMap.get(key);
    const targetHex = findNearestPaletteColor(r, g, b);
    const mapped = hexToRgb(targetHex);
    paletteMap.set(key, mapped);
    return mapped;
  };

  const usedPaletteColors = new Set();
  let opaquePixels = 0;

  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const idx = (png.width * y + x) << 2;
      const alpha = png.data[idx + 3];

      if (alpha === 0) continue; // 투명 픽셀 유지
      opaquePixels++;

      const r = png.data[idx];
      const g = png.data[idx + 1];
      const b = png.data[idx + 2];

      const mapped = getMappedRgb(r, g, b);
      png.data[idx] = mapped.r;
      png.data[idx + 1] = mapped.g;
      png.data[idx + 2] = mapped.b;

      usedPaletteColors.add(((mapped.r << 16) | (mapped.g << 8) | mapped.b).toString(16).padStart(6, '0'));
    }
  }

  const buffer = PNG.sync.write(png);
  fs.writeFileSync(outputPath, buffer);

  console.log(`✓ Remapped ${opaquePixels} pixels from ${paletteMap.size} source colors into ${usedPaletteColors.size} palette colors.`);
  console.log(`✓ Saved remapped spritesheet to ${outputPath}`);
}

// 직접 실행 시
if (process.argv[1] === __filename) {
  remapSpritesheet(INPUT_PNG, OUTPUT_PNG);
}
