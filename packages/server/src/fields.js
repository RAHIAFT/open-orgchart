// SPDX-License-Identifier: Apache-2.0
/**
 * The organisation's own fields: what it wants to know of its departments, positions, assignments and people beyond
 * what every chart holds - a cost centre, a grade, a location. A field is defined once; its values are kept on the
 * thing (`extra`), checked by kind, so a new field is no change to the tables. A field retired keeps what people
 * filled in, and is no longer shown or told.
 */
import { OrgError, flag, parsed } from './util.js';

export const TARGETS = ['department', 'position', 'assignment', 'person'];
export const KINDS = ['text', 'long', 'number', 'date', 'yesno', 'choice', 'choices', 'person', 'email', 'phone', 'url'];
const KEY = /^[a-z][a-z0-9_]{0,47}$/;
export const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

function row(f) {
  return { ...f, label: parsed(f.label, {}), help: parsed(f.help, {}), options: parsed(f.options, []), required: !!f.required,
    shareable: !!f.shareable, in_claims: !!f.in_claims, active: !!f.active };
}

/** The fields of `target` an organisation has: its own and those of every organisation. */
export function fieldsFor(store, target, organisation = null, onlyActive = true) {
  const rows = organisation
    ? store.all(`SELECT * FROM fields WHERE target = ? AND (organisation_id IS NULL OR organisation_id = ?) ${onlyActive ? 'AND active = 1' : ''} ORDER BY sort_order, key`, target, organisation.id)
    : store.all(`SELECT * FROM fields WHERE target = ? ${onlyActive ? 'AND active = 1' : ''} ORDER BY sort_order, key`, target);
  return rows.map(row);
}

export function fieldJson(f) {
  const r = typeof f.label === 'string' ? row(f) : f;
  return { id: r.id, organisation: r.organisation_id || null, target: r.target, key: r.key, label: r.label || {}, help: r.help || {}, kind: r.kind,
    options: r.options || [], required: r.required, shareable: r.shareable, in_claims: r.in_claims, order: r.sort_order, active: r.active };
}

export const readField = row;

/** A field's definition, as given: checked. -> the values to keep. */
export function cleanField(raw, existing = null) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  if (!existing) {
    const target = String(r.target || '');
    const key = String(r.key || '').trim().toLowerCase();
    if (!TARGETS.includes(target)) throw new OrgError('A field is of a department, a position, an assignment or a person', 'invalid');
    if (!KEY.test(key)) throw new OrgError('A field has a short name of its own: small letters, digits and _ (it begins with a letter)', 'invalid');
    Object.assign(out, { target, key });
  }
  if ('kind' in r || !existing) {
    const kind = String(r.kind || 'text');
    if (!KINDS.includes(kind)) throw new OrgError('That is not a kind of field', 'invalid');
    out.kind = kind;
  }
  for (const name of ['label', 'help']) {
    if (name in r || !existing) {
      let value = r[name];
      if (typeof value === 'string') value = { en: value };
      value = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      out[name] = Object.fromEntries(Object.entries(value).filter(([, v]) => String(v ?? '').trim())
        .map(([lang, v]) => [String(lang).slice(0, 8), String(v).trim().slice(0, name === 'label' ? 200 : 500)]));
    }
  }
  if (!existing && !Object.keys(out.label).length) throw new OrgError('A field has a name people read', 'invalid');
  if ('options' in r || !existing) {
    const options = [];
    for (let one of (Array.isArray(r.options) ? r.options : []).slice(0, 200)) {
      if (typeof one === 'string') one = { value: one, label: { en: one } };
      const value = String((one && one.value) ?? '').trim().slice(0, 120);
      if (!value || options.some((o) => o.value === value)) continue;
      const label = one.label && typeof one.label === 'object' ? one.label : { en: String(one.label || value) };
      options.push({ value, label: Object.fromEntries(Object.entries(label).filter(([, v]) => String(v ?? '').trim()).map(([k, v]) => [String(k).slice(0, 8), String(v).slice(0, 200)])) });
    }
    out.options = options;
  }
  const kind = out.kind || (existing ? existing.kind : 'text');
  const options = 'options' in out ? out.options : (existing ? existing.options : []);
  if ((kind === 'choice' || kind === 'choices') && !options.length) throw new OrgError('A list to choose from has at least one choice', 'invalid');
  for (const name of ['required', 'shareable', 'in_claims', 'active']) if (name in r) out[name] = !!r[name];
  if ('order' in r) {
    const n = Number(r.order || 0);
    if (!Number.isFinite(n)) throw new OrgError("A field's place is a number", 'invalid');
    out.sort_order = Math.max(0, Math.min(9999, Math.trunc(n)));
  }
  return out;
}

/** One value of one field, as its kind keeps it - or a refusal. `null` means "not given". */
export function cleanValue(store, field, value) {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) return null;
  const label = (field.label && field.label.en) || field.key;
  const kind = field.kind;
  if (kind === 'text' || kind === 'long' || kind === 'phone' || kind === 'url') {
    const said = String(value).trim().slice(0, kind === 'long' ? 4000 : 255);
    if (kind === 'url' && !/^https?:\/\/\S+$/i.test(said)) throw new OrgError(`${label} is a web address (https://...)`, 'invalid');
    return said || null;
  }
  if (kind === 'email') {
    const said = String(value).trim().toLowerCase().slice(0, 255);
    if (!EMAIL.test(said)) throw new OrgError(`${label} is an e-mail address`, 'invalid');
    return said;
  }
  if (kind === 'number') {
    const n = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isFinite(n) || (typeof value === 'string' && !String(value).trim())) throw new OrgError(`${label} is a number`, 'invalid');
    return n;
  }
  if (kind === 'date') {
    const said = String(value).slice(0, 10);
    const d = new Date(`${said}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(said) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== said) throw new OrgError(`${label} is a day (YYYY-MM-DD)`, 'invalid');
    return said;
  }
  if (kind === 'yesno') {
    const yes = flag(value);
    if (yes === null) throw new OrgError(`${label} is yes or no`, 'invalid');
    return yes;
  }
  const allowed = new Set((field.options || []).map((o) => o.value));
  if (kind === 'choice') {
    if (!allowed.has(String(value))) throw new OrgError(`${label} is one of its choices`, 'invalid');
    return String(value);
  }
  if (kind === 'choices') {
    const picked = (Array.isArray(value) ? value : [value]).map(String);
    if (picked.some((v) => !allowed.has(v))) throw new OrgError(`${label} is of its choices`, 'invalid');
    return [...new Set(picked)];
  }
  if (kind === 'person') {
    const said = String(value).trim();
    const bare = said.replace(/^person:/, '');
    const who = said.includes('@')
      ? store.get('SELECT id, email FROM people WHERE email = ? COLLATE NOCASE AND active = 1', said)
      : /^\d+$/.test(bare) ? store.get('SELECT id, email FROM people WHERE id = ? AND active = 1', Number(bare)) : null;
    if (!who) throw new OrgError(`${label} is a person of the organisation`, 'invalid');
    return who.email || `person:${who.id}`;
  }
  return null;
}

/**
 * The organisation's own fields of one thing, as given: only fields that exist, each as its kind keeps it.
 * `before`: what the thing holds now (what is not given stays). `whole`: a required field must end up filled.
 */
export function cleanExtra(store, target, organisation, values, before = {}, whole = false) {
  const given = values && typeof values === 'object' && !Array.isArray(values) ? values : {};
  const out = { ...(before || {}) };
  const known = new Map(fieldsFor(store, target, organisation).map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(given)) {
    const field = known.get(String(key));
    if (!field) throw new OrgError(`There is no field "${String(key).slice(0, 60)}" here`, 'invalid');
    const cleaned = cleanValue(store, field, value);
    if (cleaned === null) delete out[field.key]; else out[field.key] = cleaned;
  }
  if (whole) {
    for (const field of known.values()) {
      if (field.required && !(field.key in out)) throw new OrgError(`${(field.label && field.label.en) || field.key} is needed`, 'invalid');
    }
  }
  // what is kept of a field that no longer exists is not carried on
  return Object.fromEntries(Object.entries(out).filter(([k]) => known.has(k)));
}
