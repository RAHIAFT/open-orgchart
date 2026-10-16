// SPDX-License-Identifier: Apache-2.0
/** Small things every part of the service leans on: its error, days, ids, JSON columns. */
import crypto from 'node:crypto';

/** A refusal the asker is told: a sentence, a code a program can test, and the HTTP status. */
export class OrgError extends Error {
  constructor(message, code = 'invalid', status = null) {
    super(message);
    this.code = code;
    this.status = status || STATUS[code] || 400;
  }
}

const STATUS = {
  invalid: 400, no_person: 400, unauthenticated: 401, forbidden: 403, no_share: 403, not_shared: 403, unknown_client: 403,
  not_found: 404, not_allowed: 405, conflict: 409, too_large: 413, unsupported: 415, rate_limited: 429,
};

export const newId = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

/** A JSON column, read back: what it holds, or `fallback` when it holds nothing readable. */
export function parsed(text, fallback) {
  if (text === null || text === undefined || text === '') return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
}

/** Today, in the organisation's time zone (`ORG_TZ`; the server's own when none). */
export function today(timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A day as asked ('2026-03-03'), checked; `fallback` when nothing is asked. A day that is not one is refused. */
export function dayOf(value, fallback, what = 'as_of') {
  if (value === null || value === undefined || value === '') return fallback;
  const text = String(value).slice(0, 10);
  const m = DAY.exec(text);
  const date = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  if (!date || date.toISOString().slice(0, 10) !== text) throw new OrgError(`${what} is a day (YYYY-MM-DD)`, 'invalid');
  return text;
}

const TRUE = new Set(['1', 'true', 't', 'yes', 'y', 'x', 'on']);
const FALSE = new Set(['0', 'false', 'f', 'no', 'n', 'off', '']);

/** yes / no, from what a person or a spreadsheet writes; `null` when it is neither. */
export function flag(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = String(value ?? '').trim().toLowerCase();
  if (TRUE.has(text)) return true;
  if (FALSE.has(text)) return false;
  return null;
}

/** A string as given, trimmed and cut to `most` characters. */
export const text = (value, most = 255) => String(value ?? '').trim().slice(0, most);

/** The hash a key is kept as. Keys are long and random, so one round of SHA-256 is what they need. */
export const hashOf = (key) => crypto.createHash('sha256').update(String(key), 'utf8').digest('hex');

/** A new key: a prefix that says what it opens, then 32 random bytes. */
export const newKey = (prefix) => `${prefix}_${crypto.randomBytes(32).toString('base64url')}`;
