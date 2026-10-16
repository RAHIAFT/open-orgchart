// SPDX-License-Identifier: Apache-2.0
/**
 * The chart's words. The key is the English the chart says; each language is a dictionary of those keys (a key a
 * language leaves out answers the English). English and Persian come with it; any other is handed in (`words`).
 */
import fa from './fa.js';

export const LANGUAGES = { en: {}, fa };

/** Languages written from right to left. */
const RTL = new Set(['ar', 'arc', 'ckb', 'dv', 'fa', 'he', 'ku', 'ps', 'sd', 'ug', 'ur', 'yi']);

export function directionOf(language) {
  return RTL.has(String(language || '').toLowerCase().split('-')[0]) ? 'rtl' : 'ltr';
}

/** `t(key, vars)` for a language, with `extra` words over the ones that come with it. */
export function makeT(language = 'en', extra = null) {
  const base = String(language || 'en').toLowerCase().split('-')[0];
  const dict = { ...(LANGUAGES[base] || {}), ...(extra || {}) };
  return (key, vars) => {
    const said = Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key;
    if (!vars) return said;
    return String(said).replace(/\{(\w+)\}/g, (whole, name) => (vars[name] === undefined || vars[name] === null ? whole : String(vars[name])));
  };
}

/** A number written in the reader's digits. */
export function numberText(value, language = 'en') {
  const n = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(n)) return String(value ?? '');
  try { return n.toLocaleString(language || 'en'); } catch { return String(n); }
}
