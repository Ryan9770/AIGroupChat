// ============================================================================
// SpriteAtlas & SpriteLoader
// 0x72 DungeonTileset II 및 Kenney Roguelike 스프라이트 기반 렌더 파이프라인
// P2-01 (D-01, D-09): auto-generated spriteAtlasDefs 연동 및 스프라이트 렌더 지원
// ============================================================================

import { SPRITE_DEFS } from '../data/spriteAtlasDefs.js';

export { SPRITE_DEFS };

export class SpriteAtlas {
  constructor(imagePath = 'assets/sprites/0x72_DungeonTilesetII_remapped.png') {
    this.imagePath = imagePath;
    this.fallbackPath = 'assets/sprites/0x72_DungeonTilesetII_v1.7.png';
    this.img = null;
    this.loaded = false;
    this.load();
  }

  load() {
    if (typeof window === 'undefined' || typeof Image === 'undefined') return;
    this.img = new Image();
    this.img.src = this.imagePath;
    this.img.onload = () => {
      this.loaded = true;
    };
    this.img.onerror = () => {
      if (this.img.src.includes('remapped')) {
        this.img.src = this.fallbackPath;
      } else if (!this.imagePath.startsWith('/')) {
        this.img.src = '/' + this.imagePath;
      }
    };
  }

  draw(ctx, spriteKey, dx, dy, dw = 16, dh = 16, flipX = false) {
    if (!this.loaded || !this.img) return false;
    const def = SPRITE_DEFS[spriteKey];
    if (!def) return false;

    ctx.save();
    if (flipX) {
      ctx.translate(dx + dw, dy);
      ctx.scale(-1, 1);
      ctx.drawImage(this.img, def.x, def.y, def.w, def.h, 0, 0, dw, dh);
    } else {
      ctx.drawImage(this.img, def.x, def.y, def.w, def.h, dx, dy, dw, dh);
    }
    ctx.restore();
    return true;
  }

  drawEntity(ctx, entityKey, state, animTime, dx, dy, dw, dh, flipX = false, hitFlash = 0, scaleMul = 1.0) {
    if (!this.loaded || !this.img) return false;
    const group = SPRITE_DEFS[entityKey];
    if (!group) return false;

    let frames = group[state] ?? group.idle ?? group[Object.keys(group)[0]];
    if (hitFlash > 0 && group.hit) {
      frames = group.hit;
    }

    if (!Array.isArray(frames)) frames = [frames];
    const frameIndex = Math.floor(animTime * 6) % frames.length;
    const frame = frames[frameIndex] ?? frames[0];

    const finalW = dw * scaleMul * (group.scale ?? 1.0);
    const finalH = dh * scaleMul * (group.scale ?? 1.0);
    const offsetX = (finalW - dw) / 2;
    const offsetY = finalH - dh;

    ctx.save();
    if (hitFlash > 0) {
      ctx.filter = 'brightness(2.5)';
    }

    if (flipX) {
      ctx.translate(dx - offsetX + finalW, dy - offsetY);
      ctx.scale(-1, 1);
      ctx.drawImage(this.img, frame.x, frame.y, frame.w, frame.h, 0, 0, finalW, finalH);
    } else {
      ctx.drawImage(this.img, frame.x, frame.y, frame.w, frame.h, dx - offsetX, dy - offsetY, finalW, finalH);
    }
    ctx.restore();
    return true;
  }
}

export const spriteAtlas = new SpriteAtlas();
