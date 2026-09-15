// ============================================================================
// 다국어 현지화 모듈 (src/core/i18n.js)
// 14_antigravity_production_brief.md P4-04 준수: 문자열 외부화 및 t(key, vars) 헬퍼
// ============================================================================

import koStrings from '../data/strings/ko.json' with { type: 'json' };
import enStrings from '../data/strings/en.json' with { type: 'json' };

const DICTIONARIES = {
  ko: koStrings,
  en: enStrings,
};

let currentLanguage = 'ko';

export function setLanguage(lang) {
  if (DICTIONARIES[lang]) {
    currentLanguage = lang;
  }
}

export function getLanguage() {
  return currentLanguage;
}

export function t(key, vars = {}) {
  const dict = DICTIONARIES[currentLanguage] ?? DICTIONARIES.ko;
  const fallbackDict = DICTIONARIES.ko;

  const parts = key.split('.');
  let val = dict;
  for (const part of parts) {
    if (val && typeof val === 'object' && part in val) {
      val = val[part];
    } else {
      val = null;
      break;
    }
  }

  // 폴백 검색
  if (typeof val !== 'string') {
    let fbVal = fallbackDict;
    for (const part of parts) {
      if (fbVal && typeof fbVal === 'object' && part in fbVal) {
        fbVal = fbVal[part];
      } else {
        fbVal = null;
        break;
      }
    }
    val = typeof fbVal === 'string' ? fbVal : key;
  }

  // 템플릿 치환: {name} -> vars.name
  let text = val;
  for (const [vKey, vVal] of Object.entries(vars)) {
    text = text.replaceAll(`{${vKey}}`, String(vVal));
  }

  return text;
}
