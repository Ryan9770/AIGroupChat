// ============================================================================
// 프로젝트 팔레트 정의 (src/data/palette.js)
// 11_creative_direction.md §5 및 14_antigravity_production_brief.md P2-03 준수
// 핵심 팔레트 8색 + 32색 램프 확장 + 층별 LUT 5종 + 색각보조 시뮬레이션
// ============================================================================

export const CORE_PALETTE = {
  VOID: '#0A0806',            // 숯갈색: 화면 최대 면적, 공허/배경 (완전 검정 금지)
  STONE: '#3A2F1E',           // 장부 갈색: 거점, 인간 구조물, 석재/가죽
  OLD_GOLD: '#D8B45C',        // 낡은 금: 전리품, 상점, 왕실 강조
  HOLY_LIGHT: '#CFE6FF',      // 성수 청백: 제단, 게이트, 안전한 빛
  COAGULATED_RED: '#A83A3A',  // 응고 적색: HP, 직접 피해, 생명 위험, 육벽
  BILE_GREEN: '#78A83D',      // 담즙 녹색: 지속 위험, 조수, 위액, 산
  BRUISED_PURPLE: '#8D5A91',  // 멍든 자주: 61+ 시선 환각, 거짓 정보
  ALARM_VERMILION: '#E6503C', // 경보 주홍: 91+ 추적선, 적 외곽선, 수색대
};

export const RAMP_PALETTE_32 = [
  // 숯갈색 / 공허 램프
  '#050403', '#0A0806', '#18130E', '#261F17',
  // 장부 갈색 / 석재 램프
  '#2A2215', '#3A2F1E', '#54442C', '#735D3D',
  // 낡은 금 / 왕실 램프
  '#6C5320', '#9E7B2F', '#D8B45C', '#F3D586',
  // 성수 청백 / 안전 램프
  '#384C66', '#6A89B0', '#A5C5E8', '#CFE6FF',
  // 응고 적색 / 피해 램프
  '#4A1515', '#782626', '#A83A3A', '#D65555',
  // 담즙 녹색 / 조수 램프
  '#283B12', '#4C6E23', '#78A83D', '#A2D85C',
  // 멍든 자주 / 환각 램프
  '#38203B', '#5E3A63', '#8D5A91', '#BE86C4',
  // 경보 주홍 / 수색 램프
  '#691A10', '#A12E1F', '#E6503C', '#FF7E6B',
];

export const FLOOR_LUTS = {
  1: {
    name: '주화 해안 (Coin Coast)',
    primary: '#D8B45C',   // 낡은 금
    secondary: '#E3DCBE', // 젖은 석회
    dark: '#1C1712',      // 젖은 암반
    accent: '#CFE6FF',    // 은빛 개울 반사
    danger: '#A83A3A',
  },
  2: {
    name: '골격 막사 (Skeleton Barracks)',
    primary: '#5C6266',   // 철회색
    secondary: '#D8D2C4', // 마른 뼈
    dark: '#16181A',      // 검은 목재
    accent: '#8C9298',    // 낡은 철기
    danger: '#E6503C',
  },
  3: {
    name: '속삭이는 전당 (Whispering Halls)',
    primary: '#1F2E3D',   // 먹청
    secondary: '#D2C4A8', // 바랜 양피지
    dark: '#111820',      // 어둠 속 성당
    accent: '#8D5A91',    // 멍든 자주 환각
    danger: '#A83A3A',
  },
  4: {
    name: '왕가의 복도 (Royal Corridor)',
    primary: '#6B2D25',   // 적갈
    secondary: '#C2903C', // 산화 금
    dark: '#181416',      // 검은 대리석
    accent: '#E0B660',    // 왕실 광택
    danger: '#E6503C',
  },
  5: {
    name: '위장·어좌 (Visceral Throne)',
    primary: '#7D1B1B',   // 응고 적색
    secondary: '#EADDC6', // 상아
    dark: '#0D0606',      // 심연의 어둠
    accent: '#A83A3A',    // 젖은 막
    danger: '#E6503C',
  },
};

// ============================================================================
// 색각 보조 및 전조(Telegraph) 시각 정보 계층
// ============================================================================

export const TELEGRAPH_KINDS = {
  IMMEDIATE: 'immediate',     // 즉시 피해 (적색 계열)
  PERSISTENT: 'persistent',   // 지속 피해 / 장판 / 위액 (녹색 계열)
  HALLUCINATION: 'hallucination', // 거짓 정보 / 시선 환각 (자주 계열)
  SAFE: 'safe',               // 안전 영역 / 성수 / 게이트 (청백 계열)
};

export const TELEGRAPH_STYLES = {
  [TELEGRAPH_KINDS.IMMEDIATE]: {
    color: CORE_PALETTE.ALARM_VERMILION,
    fill: 'rgba(230, 80, 60, 0.25)',
    dash: [], // 실선
    pattern: 'solid',
    symbol: '!',
    name: '즉시 피해',
  },
  [TELEGRAPH_KINDS.PERSISTENT]: {
    color: CORE_PALETTE.BILE_GREEN,
    fill: 'rgba(120, 168, 61, 0.28)',
    dash: [6, 4], // 점선 (색각이상에서도 구분)
    pattern: 'dashed',
    symbol: '≈',
    name: '지속 위험',
  },
  [TELEGRAPH_KINDS.HALLUCINATION]: {
    color: CORE_PALETTE.BRUISED_PURPLE,
    fill: 'rgba(141, 90, 145, 0.28)',
    dash: [2, 4], // 촘촘한 점선
    pattern: 'pulse',
    symbol: '?',
    name: '거짓 신호',
  },
  [TELEGRAPH_KINDS.SAFE]: {
    color: CORE_PALETTE.HOLY_LIGHT,
    fill: 'rgba(207, 230, 255, 0.25)',
    dash: [], // 이중선 또는 실선
    pattern: 'double',
    symbol: '◆',
    name: '안전 구역',
  },
};

// HEX -> RGB 변환
export function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const bigint = parseInt(clean, 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  };
}

// RGB -> HEX 변환
export function rgbToHex(r, g, b) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return '#' + [clamp(r), clamp(g), clamp(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// 가중치 유클리드 색거리 (인간 지각 근사)
export function colorDistance(r1, g1, b1, r2, g2, b2) {
  const rmean = (r1 + r2) / 2;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt((((512 + rmean) * dr * dr) >> 8) + 4 * dg * dg + (((767 - rmean) * db * db) >> 8));
}

// 가장 가까운 32색 램프 팔레트 색상 찾기
const RAMP_RGB_CACHE = RAMP_PALETTE_32.map((hex) => ({ hex, ...hexToRgb(hex) }));

export function findNearestPaletteColor(r, g, b, paletteRgb = RAMP_RGB_CACHE) {
  let bestDist = Infinity;
  let bestHex = paletteRgb[0].hex;
  for (const c of paletteRgb) {
    const d = colorDistance(r, g, b, c.r, c.g, c.b);
    if (d < bestDist) {
      bestDist = d;
      bestHex = c.hex;
    }
  }
  return bestHex;
}

// 색각이상 시뮬레이션 (Deuteranopia: 제2색맹 / Protanopia: 제1색맹)
export function simulateColorblindness(hex, type = 'deuteranopia') {
  const { r, g, b } = hexToRgb(hex);
  let simR = r;
  let simG = g;
  let simB = b;

  if (type === 'deuteranopia') {
    // 녹색 감각 상실 근사 행렬 (Brettel/Viénot 모델 근사)
    simR = 0.625 * r + 0.375 * g;
    simG = 0.700 * r + 0.300 * g;
    simB = 0.000 * r + 0.300 * g + 0.700 * b;
  } else if (type === 'protanopia') {
    // 적색 감각 상실 근사 행렬
    simR = 0.56667 * r + 0.43333 * g;
    simG = 0.55833 * r + 0.44167 * g;
    simB = 0.00000 * r + 0.24167 * g + 0.75833 * b;
  } else if (type === 'monochrome') {
    // 완전 흑백 (휘도 채도 0)
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    simR = lum;
    simG = lum;
    simB = lum;
  }

  return rgbToHex(simR, simG, simB);
}
