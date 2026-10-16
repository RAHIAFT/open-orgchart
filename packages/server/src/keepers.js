// SPDX-License-Identifier: Apache-2.0
/**
 * FOR THE PEOPLE WHO KEEP THE ORGANISATION: `/api/org/pillar/` - keepers only. Every change is written down (who,
 * what, before and after: `changes`).
 *
 *   organisations, departments, positions, people, assignments, fields, clients, shares    list, add, read, change, remove
 *   clients/<id>/key        a new key for a system (shown once; the old one stops opening anything)
 *   keepers                 the keepers' keys (a new one is shown once; the last one is never removed)
 *   access                  the last questions applications asked, against the share that answered each
 *   changes                 every change, after `?since=<id>`
 *   import                  departments, positions, people and who holds which, from CSV or JSON (`?dry=1`: only say what it would do)
 *   export                  the same, as CSV (the columns the import reads) or JSON (everything)
 */
import { CLIENT_PREFIX, DEPTHS, KEEPER_PREFIX } from './auth.js';
import { NAME_SEP, card, chainOf, chartOf, organisationJson, personRef, reportsOf } from './chart.js';
import { parseCsv, writeCsv } from './csv.js';
import { EMAIL, cleanExtra, cleanField, fieldJson, fieldsFor, readField } from './fields.js';
import { OrgError, dayOf, flag, hashOf, newId, newKey, now, parsed, text, today } from './util.js';

const MAX_IMPORT_ROWS = 20000;
const ORG_KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/;

// ── reading rows back ────────────────────────────────────────────────────────────────────────────────────────

const orgRow = (o) => o && { ...o, is_default: !!o.is_default, active: !!o.active, names: parsed(o.names, {}), domains: parsed(o.domains, []) };
const orgOut = (o) => ({ ...organisationJson(o), active: o.active, created_at: o.created_at, updated_at: o.updated_at });

function deptOut(c, d) {
  return { id: d.id, name: d.name, description: d.description, parent: d.parent_id || null, organisation: d.organisation_id || null,
    sort_order: d.sort_order, active: !!d.active, extra: typeof d.extra === 'string' ? parsed(d.extra, {}) : d.extra, external_id: d.external_id,
    level: c.level(d.id), path: c.path(d.id).map((x) => x.name), created_at: d.created_at, updated_at: d.updated_at };
}

function seatOut(p) {
  return { id: p.id, department: p.department_id, title: p.title, code: p.code, is_head: !!p.is_head, reports_to: p.reports_to || null, active: !!p.active,
    extra: typeof p.extra === 'string' ? parsed(p.extra, {}) : p.extra, external_id: p.external_id, created_at: p.created_at, updated_at: p.updated_at };
}

function personOut(p) {
  return { id: p.id, name: p.name, email: p.email || '', sub: p.sub || '', code: p.code, manager: p.manager_id ?? null, organisation: p.organisation_id || null,
    active: !!p.active, extra: typeof p.extra === 'string' ? parsed(p.extra, {}) : p.extra, external_id: p.external_id, created_at: p.created_at, updated_at: p.updated_at };
}

function assignmentOut(a) {
  return { id: a.id, person: a.person_id, position: a.position_id, primary: !!a.is_primary, acting: !!a.acting, valid_from: a.valid_from, valid_to: a.valid_to || null,
    extra: typeof a.extra === 'string' ? parsed(a.extra, {}) : a.extra, created_at: a.created_at, updated_at: a.updated_at };
}

function clientOut(c) {
  return { id: c.id, organisation: c.organisation_id, name: c.name, client_id: c.client_id, has_key: !!c.key_hash, key_hint: c.key_hint, contact: c.contact,
    note: c.note, active: !!c.active, created_by: c.created_by, created_at: c.created_at, updated_at: c.updated_at, last_seen_at: c.last_seen_at || null };
}

function shareOut(s) {
  return { id: s.id, client: s.client_id, department: s.department_id || null, depth: s.depth, fields: parsed(s.fields, []), purpose: s.purpose,
    valid_from: s.valid_from || null, valid_to: s.valid_to || null, active: !!s.active, created_by: s.created_by, created_at: s.created_at, updated_at: s.updated_at };
}

const keeperOut = (k) => ({ id: k.id, name: k.name, key_hint: k.key_hint, active: !!k.active, created_at: k.created_at, last_seen_at: k.last_seen_at || null });

// ── small checks ─────────────────────────────────────────────────────────────────────────────────────────────

function must(ctx) {
  if (!ctx.who || ctx.who.kind !== 'keeper') throw new OrgError('Only the people who keep the organisation can do this.', 'forbidden');
}

const body = (ctx) => (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? ctx.body : {});
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const day = (ctx) => today(ctx.config.timeZone);

function one(store, table, id, what) {
  const found = id === null || id === undefined || id === '' ? null : store.get(`SELECT * FROM ${table} WHERE id = ?`, table === 'people' ? Number(id) : String(id));
  if (!found) throw new OrgError(`No such ${what}.`, 'not_found');
  return found;
}

function name(value, what, most = 255) {
  const said = text(value, most);
  if (!said) throw new OrgError(`${what} has a name`, 'invalid');
  return said;
}

function organisationOf(store, ref) {
  if (ref === null || ref === undefined || ref === '') {
    return orgRow(store.get('SELECT * FROM organisations WHERE is_default = 1 AND active = 1')
      || store.get('SELECT * FROM organisations WHERE active = 1 ORDER BY created_at'));
  }
  const found = store.get('SELECT * FROM organisations WHERE id = ? OR key = ?', String(ref), String(ref));
  if (!found) throw new OrgError('No such organisation.', 'not_found');
  return orgRow(found);
}

function emailOf(value) {
  const said = text(value, 255).toLowerCase();
  if (!said) return null;
  if (!EMAIL.test(said)) throw new OrgError('That is not an e-mail address', 'invalid');
  return said;
}

function personRefOf(store, ref) {
  if (ref === null || ref === undefined || ref === '') return null;
  const said = String(ref).trim().replace(/^(person|user):/, '');
  const found = /^\d+$/.test(said) ? store.get('SELECT * FROM people WHERE id = ?', Number(said))
    : said.includes('@') ? store.get('SELECT * FROM people WHERE email = ? COLLATE NOCASE', said) : null;
  if (!found) throw new OrgError('No such person.', 'not_found');
  return found;
}

function dates(from, to) {
  if (to && from && to < from) throw new OrgError('An assignment ends on or after the day it begins', 'invalid');
}

const unique = (fn) => {
  try { return fn(); } catch (err) {
    if (/UNIQUE constraint failed/i.test(String(err.message))) throw new OrgError('Something with that name, address or key is already here.', 'conflict');
    throw err;
  }
};

// ── organisations ────────────────────────────────────────────────────────────────────────────────────────────

/** Make sure there is an organisation to keep: on a new database, the first one (`main`). */
export function ensureOrganisation(store) {
  if (store.get('SELECT id FROM organisations LIMIT 1')) return;
  const at = now();
  store.run('INSERT INTO organisations (id, key, name, is_default, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)', newId(), 'main', 'Organisation', at, at);
}

function cleanOrganisation(raw, existing) {
  const out = {};
  if (has(raw, 'key') || !existing) {
    const key = text(raw.key, 64).toLowerCase();
    if (!ORG_KEY.test(key)) throw new OrgError('An organisation has a short key: small letters, digits, - and _', 'invalid');
    out.key = key;
  }
  if (has(raw, 'name') || !existing) out.name = name(raw.name, 'An organisation');
  if (has(raw, 'names')) out.names = JSON.stringify(Object.fromEntries(Object.entries(raw.names && typeof raw.names === 'object' ? raw.names : {}).map(([k, v]) => [String(k).slice(0, 8), text(v, 255)])));
  if (has(raw, 'domains')) out.domains = JSON.stringify((Array.isArray(raw.domains) ? raw.domains : []).map((d) => text(d, 255).toLowerCase()).filter(Boolean).slice(0, 50));
  if (has(raw, 'is_default')) out.is_default = !!raw.is_default;
  if (has(raw, 'active')) out.active = !!raw.active;
  return out;
}

function update(store, table, id, values) {
  const keys = Object.keys(values);
  if (!keys.length) return;
  store.run(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...keys.map((k) => values[k]), now(), id);
}

export const organisations = {
  list(ctx) {
    must(ctx);
    return { organisations: ctx.store.all('SELECT * FROM organisations ORDER BY is_default DESC, name').map((o) => orgOut(orgRow(o))) };
  },
  create(ctx) {
    must(ctx);
    const values = cleanOrganisation(body(ctx), null);
    const id = newId();
    const at = now();
    ctx.store.tx(() => {
      if (values.is_default) ctx.store.run('UPDATE organisations SET is_default = 0');
      unique(() => ctx.store.run('INSERT INTO organisations (id, key, name, names, domains, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        id, values.key, values.name, values.names || '{}', values.domains || '[]', !!values.is_default, at, at));
      ctx.store.record(ctx.who.label, 'create', 'organisation', id, values.name, null, values);
    });
    return { status: 201, body: orgOut(orgRow(ctx.store.get('SELECT * FROM organisations WHERE id = ?', id))) };
  },
  read(ctx, id) { must(ctx); return orgOut(orgRow(one(ctx.store, 'organisations', id, 'organisation'))); },
  change(ctx, id) {
    must(ctx);
    const before = orgRow(one(ctx.store, 'organisations', id, 'organisation'));
    const values = cleanOrganisation(body(ctx), before);
    ctx.store.tx(() => {
      if (values.is_default) ctx.store.run('UPDATE organisations SET is_default = 0 WHERE id != ?', id);
      unique(() => update(ctx.store, 'organisations', id, values));
      ctx.store.record(ctx.who.label, 'update', 'organisation', id, before.name, orgOut(before), values);
    });
    return orgOut(orgRow(ctx.store.get('SELECT * FROM organisations WHERE id = ?', id)));
  },
  remove(ctx, id) {
    must(ctx);
    const before = orgRow(one(ctx.store, 'organisations', id, 'organisation'));
    if (ctx.store.get('SELECT id FROM departments WHERE organisation_id = ? LIMIT 1', id) || ctx.store.get('SELECT id FROM clients WHERE organisation_id = ? LIMIT 1', id)) {
      throw new OrgError('An organisation with departments or applications is not removed: move or remove them first.', 'conflict');
    }
    if (ctx.store.get('SELECT COUNT(*) AS n FROM organisations').n <= 1) throw new OrgError('The last organisation stays.', 'conflict');
    ctx.store.tx(() => {
      ctx.store.run('DELETE FROM organisations WHERE id = ?', id);
      ctx.store.record(ctx.who.label, 'delete', 'organisation', id, before.name, orgOut(before), null);
    });
    return { status: 204 };
  },
};

// ── departments ──────────────────────────────────────────────────────────────────────────────────────────────

export const departments = {
  list(ctx) {
    must(ctx);
    const c = chartOf(ctx.store, day(ctx));
    let rows = [...c.depts.values()];
    const org = ctx.query.get('organisation');
    if (org) { const o = organisationOf(ctx.store, org); rows = rows.filter((d) => d.organisation_id === o.id); }
    const root = ctx.query.get('root');
    if (root) rows = rows.filter((d) => c.within(d.id, root));
    rows.sort((a, b) => (c.level(a.id) - c.level(b.id)) || (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));
    return { departments: rows.map((d) => deptOut(c, d)) };
  },
  create(ctx) {
    must(ctx);
    const raw = body(ctx);
    const parent = raw.parent ? one(ctx.store, 'departments', raw.parent, 'department to put it under') : null;
    const organisation = parent ? organisationOf(ctx.store, parent.organisation_id) : organisationOf(ctx.store, raw.organisation);
    const id = newId();
    const at = now();
    const extra = cleanExtra(ctx.store, 'department', organisation, raw.extra, {}, true);
    const values = { name: name(raw.name, 'A department'), description: text(raw.description, 2000), sort_order: Math.trunc(Number(raw.sort_order) || 0), external_id: text(raw.external_id, 255) };
    ctx.store.tx(() => {
      ctx.store.run(`INSERT INTO departments (id, organisation_id, parent_id, name, description, sort_order, active, extra, external_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, organisation ? organisation.id : null, parent ? parent.id : null, values.name, values.description,
      values.sort_order, raw.active !== false, JSON.stringify(extra), values.external_id, at, at);
      ctx.store.record(ctx.who.label, 'create', 'department', id, values.name, null, { ...values, parent: parent ? parent.id : null, extra });
    });
    const c = chartOf(ctx.store, day(ctx));
    return { status: 201, body: deptOut(c, c.depts.get(id)) };
  },
  read(ctx, id) {
    must(ctx);
    const c = chartOf(ctx.store, day(ctx));
    const d = c.depts.get(id);
    if (!d) throw new OrgError('No such department.', 'not_found');
    const seats = ctx.store.all('SELECT * FROM positions WHERE department_id = ? ORDER BY is_head DESC, title', id).map((p) => ({
      ...seatOut(p), holders: c.persons(c.holders.get(p.id) || []).map((x) => personRef(x)) }));
    return { ...deptOut(c, d), positions: seats };
  },
  change(ctx, id) {
    must(ctx);
    const raw = body(ctx);
    const c = chartOf(ctx.store, day(ctx));
    const before = c.depts.get(id);
    if (!before) throw new OrgError('No such department.', 'not_found');
    const values = {};
    if (has(raw, 'name')) values.name = name(raw.name, 'A department');
    if (has(raw, 'description')) values.description = text(raw.description, 2000);
    if (has(raw, 'sort_order')) values.sort_order = Math.trunc(Number(raw.sort_order) || 0);
    if (has(raw, 'active')) values.active = !!raw.active;
    if (has(raw, 'external_id')) values.external_id = text(raw.external_id, 255);
    let organisation = organisationOf(ctx.store, before.organisation_id);
    let moveTo;
    if (has(raw, 'parent')) {
      const parent = raw.parent ? c.depts.get(String(raw.parent)) : null;
      if (raw.parent && !parent) throw new OrgError('No such department to put it under.', 'not_found');
      if (parent && c.within(parent.id, id)) throw new OrgError('A department is not put under itself, or under what is under it.', 'invalid');
      values.parent_id = parent ? parent.id : null;
      moveTo = parent ? parent.organisation_id : (has(raw, 'organisation') ? organisationOf(ctx.store, raw.organisation).id : before.organisation_id);
    } else if (has(raw, 'organisation')) {
      if (before.parent_id) throw new OrgError('A department belongs to the organisation of its top department: move that one.', 'invalid');
      moveTo = organisationOf(ctx.store, raw.organisation).id;
    }
    if (moveTo !== undefined) organisation = organisationOf(ctx.store, moveTo);
    if (has(raw, 'extra')) values.extra = JSON.stringify(cleanExtra(ctx.store, 'department', organisation, raw.extra, before.extra, true));
    ctx.store.tx(() => {
      update(ctx.store, 'departments', id, values);
      if (moveTo !== undefined && moveTo !== before.organisation_id) {
        // the department and everything under it follow their new top
        const under = [...c.depts.values()].filter((d) => c.within(d.id, id)).map((d) => d.id);
        for (const one of under) ctx.store.run('UPDATE departments SET organisation_id = ? WHERE id = ?', moveTo, one);
      }
      ctx.store.record(ctx.who.label, has(raw, 'parent') ? 'move' : 'update', 'department', id, before.name, deptOut(c, before), values);
    });
    const after = chartOf(ctx.store, day(ctx));
    return deptOut(after, after.depts.get(id));
  },
  remove(ctx, id) {
    must(ctx);
    const before = one(ctx.store, 'departments', id, 'department');
    if (ctx.store.get('SELECT id FROM departments WHERE parent_id = ? LIMIT 1', id)) {
      throw new OrgError('A department with departments under it is not removed: move or remove those first.', 'conflict');
    }
    ctx.store.tx(() => {
      ctx.store.run('DELETE FROM departments WHERE id = ?', id);
      ctx.store.record(ctx.who.label, 'delete', 'department', id, before.name, before, null);
    });
    return { status: 204 };
  },
};

// ── positions ────────────────────────────────────────────────────────────────────────────────────────────────

function checkSeat(store, values, id, deptId) {
  if (values.is_head && store.get('SELECT id FROM positions WHERE department_id = ? AND is_head = 1 AND active = 1 AND id != ?', deptId, id || '')) {
    throw new OrgError('A department has one head seat.', 'conflict');
  }
  if (values.reports_to) {
    if (values.reports_to === id) throw new OrgError('A seat does not answer to itself.', 'invalid');
    const seen = new Set([id]);
    let at = store.get('SELECT id, reports_to FROM positions WHERE id = ?', values.reports_to);
    if (!at) throw new OrgError('No such seat for it to answer to.', 'not_found');
    while (at) {
      if (seen.has(at.id)) throw new OrgError('A seat never answers, through any number of seats, to itself.', 'invalid');
      seen.add(at.id);
      at = at.reports_to ? store.get('SELECT id, reports_to FROM positions WHERE id = ?', at.reports_to) : null;
    }
  }
}

export const positions = {
  list(ctx) {
    must(ctx);
    const dept = ctx.query.get('department');
    const rows = dept ? ctx.store.all('SELECT * FROM positions WHERE department_id = ? ORDER BY is_head DESC, title', dept)
      : ctx.store.all('SELECT * FROM positions ORDER BY department_id, is_head DESC, title');
    return { positions: rows.map(seatOut) };
  },
  create(ctx) {
    must(ctx);
    const raw = body(ctx);
    const dept = one(ctx.store, 'departments', raw.department, 'department');
    const organisation = organisationOf(ctx.store, dept.organisation_id);
    const id = newId();
    const values = { title: name(raw.title, 'A position'), code: text(raw.code, 64), is_head: !!raw.is_head, reports_to: raw.reports_to ? String(raw.reports_to) : null,
      external_id: text(raw.external_id, 255) };
    checkSeat(ctx.store, values, id, dept.id);
    const extra = cleanExtra(ctx.store, 'position', organisation, raw.extra, {}, true);
    const at = now();
    ctx.store.tx(() => {
      ctx.store.run(`INSERT INTO positions (id, department_id, title, code, is_head, reports_to, active, extra, external_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, dept.id, values.title, values.code, values.is_head, values.reports_to, raw.active !== false,
      JSON.stringify(extra), values.external_id, at, at);
      ctx.store.record(ctx.who.label, 'create', 'position', id, values.title, null, { ...values, department: dept.id, extra });
    });
    return { status: 201, body: seatOut(ctx.store.get('SELECT * FROM positions WHERE id = ?', id)) };
  },
  read(ctx, id) {
    must(ctx);
    const seat = one(ctx.store, 'positions', id, 'position');
    const c = chartOf(ctx.store, day(ctx));
    return { ...seatOut(seat), holders: c.persons(c.holders.get(id) || []).map((p) => personRef(p)), answers_to: c.above(id) };
  },
  change(ctx, id) {
    must(ctx);
    const raw = body(ctx);
    const before = one(ctx.store, 'positions', id, 'position');
    const values = {};
    if (has(raw, 'title')) values.title = name(raw.title, 'A position');
    if (has(raw, 'code')) values.code = text(raw.code, 64);
    if (has(raw, 'is_head')) values.is_head = !!raw.is_head;
    if (has(raw, 'reports_to')) values.reports_to = raw.reports_to ? String(raw.reports_to) : null;
    if (has(raw, 'active')) values.active = !!raw.active;
    if (has(raw, 'external_id')) values.external_id = text(raw.external_id, 255);
    let deptId = before.department_id;
    if (has(raw, 'department')) { deptId = one(ctx.store, 'departments', raw.department, 'department').id; values.department_id = deptId; }
    checkSeat(ctx.store, { is_head: has(values, 'is_head') ? values.is_head : !!before.is_head, reports_to: values.reports_to }, id, deptId);
    if (has(raw, 'extra')) {
      const dept = ctx.store.get('SELECT organisation_id FROM departments WHERE id = ?', deptId);
      values.extra = JSON.stringify(cleanExtra(ctx.store, 'position', organisationOf(ctx.store, dept.organisation_id), raw.extra, parsed(before.extra, {}), true));
    }
    ctx.store.tx(() => {
      update(ctx.store, 'positions', id, values);
      ctx.store.record(ctx.who.label, 'update', 'position', id, before.title, seatOut(before), values);
    });
    return seatOut(ctx.store.get('SELECT * FROM positions WHERE id = ?', id));
  },
  remove(ctx, id) {
    must(ctx);
    const before = one(ctx.store, 'positions', id, 'position');
    ctx.store.tx(() => {
      ctx.store.run('DELETE FROM positions WHERE id = ?', id);
      ctx.store.record(ctx.who.label, 'delete', 'position', id, before.title, seatOut(before), null);
    });
    return { status: 204 };
  },
};

// ── people ───────────────────────────────────────────────────────────────────────────────────────────────────

function checkManager(ctx, personId, managerId) {
  if (managerId === null) return;
  if (managerId === personId) throw new OrgError('Nobody answers to themselves.', 'invalid');
  const c = chartOf(ctx.store, day(ctx));
  if (personId !== null && (c.chain(managerId).includes(personId))) throw new OrgError('That would close a circle: they answer, through others, to this person.', 'invalid');
}

export const people = {
  list(ctx) {
    must(ctx);
    const q = text(ctx.query.get('q'), 120).toLowerCase();
    const limit = Math.min(1000, Math.max(1, Number(ctx.query.get('limit')) || 200));
    const offset = Math.max(0, Number(ctx.query.get('offset')) || 0);
    const active = ctx.query.get('active');
    const where = [];
    const args = [];
    if (q) { where.push("(lower(name) LIKE ? ESCAPE '\\' OR lower(email) LIKE ? ESCAPE '\\' OR lower(code) LIKE ? ESCAPE '\\')"); const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`; args.push(like, like, like); }
    if (active !== null && active !== '') { where.push('active = ?'); args.push(flag(active) ? 1 : 0); }
    const sql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const count = ctx.store.get(`SELECT COUNT(*) AS n FROM people${sql}`, ...args).n;
    const rows = ctx.store.all(`SELECT * FROM people${sql} ORDER BY lower(name), id LIMIT ? OFFSET ?`, ...args, limit, offset);
    return { count, people: rows.map(personOut) };
  },
  create(ctx) {
    must(ctx);
    const raw = body(ctx);
    const email = emailOf(raw.email);
    const values = { name: text(raw.name, 255), email, sub: text(raw.sub, 255) || null, code: text(raw.code, 64), external_id: text(raw.external_id, 255) };
    if (!values.name && !values.email) throw new OrgError('A person has a name or an e-mail address', 'invalid');
    const organisation = raw.organisation ? organisationOf(ctx.store, raw.organisation) : null;
    const manager = raw.manager ? personRefOf(ctx.store, raw.manager) : null;
    const extra = cleanExtra(ctx.store, 'person', organisation || organisationOf(ctx.store, null), raw.extra, {}, true);
    const at = now();
    let id;
    ctx.store.tx(() => {
      const made = unique(() => ctx.store.run(`INSERT INTO people (name, email, sub, active, organisation_id, code, manager_id, extra, external_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, values.name, values.email, values.sub, raw.active !== false, organisation ? organisation.id : null, values.code,
      manager ? manager.id : null, JSON.stringify(extra), values.external_id, at, at));
      id = Number(made.lastInsertRowid);
      ctx.store.record(ctx.who.label, 'create', 'person', id, values.name || values.email, null, { ...values, manager: manager ? manager.id : null, extra });
    });
    return { status: 201, body: personOut(ctx.store.get('SELECT * FROM people WHERE id = ?', id)) };
  },
  read(ctx, id) {
    must(ctx);
    const row = one(ctx.store, 'people', id, 'person');
    const c = chartOf(ctx.store, dayOf(ctx.query.get('as_of'), day(ctx)));
    const p = c.people.get(row.id);
    return { ...personOut(row), card: card(c, p), chain: chainOf(c, p).map((x) => personRef(x)), reports: reportsOf(c, p).map((x) => personRef(x)), manager_said_by: c.saidBy(p.id) };
  },
  change(ctx, id) {
    must(ctx);
    const raw = body(ctx);
    const before = one(ctx.store, 'people', id, 'person');
    const values = {};
    if (has(raw, 'name')) values.name = text(raw.name, 255);
    if (has(raw, 'email')) values.email = emailOf(raw.email);
    if (has(raw, 'sub')) values.sub = text(raw.sub, 255) || null;
    if (has(raw, 'code')) values.code = text(raw.code, 64);
    if (has(raw, 'active')) values.active = !!raw.active;
    if (has(raw, 'external_id')) values.external_id = text(raw.external_id, 255);
    if (has(raw, 'organisation')) values.organisation_id = raw.organisation ? organisationOf(ctx.store, raw.organisation).id : null;
    if (has(raw, 'manager')) {
      const manager = raw.manager ? personRefOf(ctx.store, raw.manager) : null;
      checkManager(ctx, before.id, manager ? manager.id : null);
      values.manager_id = manager ? manager.id : null;
    }
    if (has(raw, 'extra')) {
      const c = chartOf(ctx.store, day(ctx));
      values.extra = JSON.stringify(cleanExtra(ctx.store, 'person', c.organisationOf(c.people.get(before.id)), raw.extra, parsed(before.extra, {}), true));
    }
    const nameAfter = has(values, 'name') ? values.name : before.name;
    const emailAfter = has(values, 'email') ? values.email : before.email;
    if (!nameAfter && !emailAfter) throw new OrgError('A person has a name or an e-mail address', 'invalid');
    ctx.store.tx(() => {
      unique(() => update(ctx.store, 'people', before.id, values));
      ctx.store.record(ctx.who.label, 'update', 'person', before.id, before.name || before.email, personOut(before), values);
    });
    return personOut(ctx.store.get('SELECT * FROM people WHERE id = ?', before.id));
  },
  remove(ctx, id) {
    must(ctx);
    const before = one(ctx.store, 'people', id, 'person');
    ctx.store.tx(() => {
      ctx.store.run('DELETE FROM people WHERE id = ?', before.id);
      ctx.store.record(ctx.who.label, 'delete', 'person', before.id, before.name || before.email, personOut(before), null);
    });
    return { status: 204 };
  },
};

// ── assignments: who holds which seat, from a day until a day ────────────────────────────────────────────────

export const assignments = {
  list(ctx) {
    must(ctx);
    const where = [];
    const args = [];
    if (ctx.query.get('person')) { where.push('person_id = ?'); args.push(Number(ctx.query.get('person'))); }
    if (ctx.query.get('position')) { where.push('position_id = ?'); args.push(ctx.query.get('position')); }
    if (flag(ctx.query.get('current') || '') === true) { const d = day(ctx); where.push('valid_from <= ? AND (valid_to IS NULL OR valid_to >= ?)'); args.push(d, d); }
    const rows = ctx.store.all(`SELECT * FROM assignments${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY valid_from DESC, created_at LIMIT 5000`, ...args);
    return { assignments: rows.map(assignmentOut) };
  },
  create(ctx) {
    must(ctx);
    const raw = body(ctx);
    const person = personRefOf(ctx.store, raw.person);
    if (!person) throw new OrgError('An assignment is of a person.', 'invalid');
    const seat = one(ctx.store, 'positions', raw.position, 'position');
    const from = dayOf(raw.valid_from, day(ctx), 'valid_from');
    const to = raw.valid_to ? dayOf(raw.valid_to, null, 'valid_to') : null;
    dates(from, to);
    const dept = ctx.store.get('SELECT organisation_id FROM departments WHERE id = ?', seat.department_id);
    const extra = cleanExtra(ctx.store, 'assignment', organisationOf(ctx.store, dept.organisation_id), raw.extra, {}, true);
    const current = ctx.store.get('SELECT id FROM assignments WHERE person_id = ? AND is_primary = 1 AND (valid_to IS NULL OR valid_to >= ?) LIMIT 1', person.id, from);
    const primary = has(raw, 'primary') ? !!raw.primary : !current;
    const id = newId();
    const at = now();
    ctx.store.tx(() => {
      if (primary) ctx.store.run('UPDATE assignments SET is_primary = 0 WHERE person_id = ?', person.id);
      ctx.store.run(`INSERT INTO assignments (id, person_id, position_id, is_primary, acting, valid_from, valid_to, extra, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, person.id, seat.id, primary, !!raw.acting, from, to, JSON.stringify(extra), at, at);
      ctx.store.record(ctx.who.label, 'create', 'assignment', id, `${person.name || person.email} - ${seat.title}`, null, { person: person.id, position: seat.id, primary, acting: !!raw.acting, valid_from: from, valid_to: to, extra });
    });
    return { status: 201, body: assignmentOut(ctx.store.get('SELECT * FROM assignments WHERE id = ?', id)) };
  },
  read(ctx, id) { must(ctx); return assignmentOut(one(ctx.store, 'assignments', id, 'assignment')); },
  change(ctx, id) {
    must(ctx);
    const raw = body(ctx);
    const before = one(ctx.store, 'assignments', id, 'assignment');
    const values = {};
    if (has(raw, 'position')) values.position_id = one(ctx.store, 'positions', raw.position, 'position').id;
    if (has(raw, 'primary')) values.is_primary = !!raw.primary;
    if (has(raw, 'acting')) values.acting = !!raw.acting;
    if (has(raw, 'valid_from')) values.valid_from = dayOf(raw.valid_from, before.valid_from, 'valid_from');
    if (has(raw, 'valid_to')) values.valid_to = raw.valid_to ? dayOf(raw.valid_to, null, 'valid_to') : null;
    dates(has(values, 'valid_from') ? values.valid_from : before.valid_from, has(values, 'valid_to') ? values.valid_to : before.valid_to);
    if (has(raw, 'extra')) {
      const seat = ctx.store.get('SELECT department_id FROM positions WHERE id = ?', values.position_id || before.position_id);
      const dept = ctx.store.get('SELECT organisation_id FROM departments WHERE id = ?', seat.department_id);
      values.extra = JSON.stringify(cleanExtra(ctx.store, 'assignment', organisationOf(ctx.store, dept.organisation_id), raw.extra, parsed(before.extra, {}), true));
    }
    ctx.store.tx(() => {
      if (values.is_primary) ctx.store.run('UPDATE assignments SET is_primary = 0 WHERE person_id = ? AND id != ?', before.person_id, id);
      update(ctx.store, 'assignments', id, values);
      ctx.store.record(ctx.who.label, 'update', 'assignment', id, '', assignmentOut(before), values);
    });
    return assignmentOut(ctx.store.get('SELECT * FROM assignments WHERE id = ?', id));
  },
  remove(ctx, id) {
    must(ctx);
    const before = one(ctx.store, 'assignments', id, 'assignment');
    ctx.store.tx(() => {
      ctx.store.run('DELETE FROM assignments WHERE id = ?', id);
      ctx.store.record(ctx.who.label, 'delete', 'assignment', id, '', assignmentOut(before), null);
    });
    return { status: 204 };
  },
};

// ── the organisation's own fields ────────────────────────────────────────────────────────────────────────────

export const fields = {
  list(ctx) {
    must(ctx);
    const all = flag(ctx.query.get('all') || '') === true;
    const t = ctx.query.get('target');
    const rows = ctx.store.all(`SELECT * FROM fields ${t ? 'WHERE target = ?' : ''} ORDER BY target, sort_order, key`, ...(t ? [t] : []))
      .map(readField).filter((f) => all || f.active);
    return { fields: rows.map(fieldJson) };
  },
  create(ctx) {
    must(ctx);
    const raw = body(ctx);
    const values = cleanField(raw, null);
    const organisation = raw.organisation ? organisationOf(ctx.store, raw.organisation) : null;
    const id = newId();
    const at = now();
    ctx.store.tx(() => {
      unique(() => ctx.store.run(`INSERT INTO fields (id, organisation_id, target, key, label, help, kind, options, required, shareable, in_claims, sort_order, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`, id, organisation ? organisation.id : null, values.target, values.key, JSON.stringify(values.label),
      JSON.stringify(values.help || {}), values.kind, JSON.stringify(values.options || []), !!values.required, !!values.shareable, !!values.in_claims, values.sort_order || 0, at, at));
      ctx.store.record(ctx.who.label, 'create', 'field', id, `${values.target}.${values.key}`, null, values);
    });
    return { status: 201, body: fieldJson(ctx.store.get('SELECT * FROM fields WHERE id = ?', id)) };
  },
  read(ctx, id) { must(ctx); return fieldJson(one(ctx.store, 'fields', id, 'field')); },
  change(ctx, id) {
    must(ctx);
    const before = readField(one(ctx.store, 'fields', id, 'field'));
    const values = cleanField(body(ctx), before);
    const stored = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, ['label', 'help', 'options'].includes(k) ? JSON.stringify(v) : v]));
    ctx.store.tx(() => {
      update(ctx.store, 'fields', id, stored);
      ctx.store.record(ctx.who.label, 'update', 'field', id, `${before.target}.${before.key}`, fieldJson(before), values);
    });
    return fieldJson(ctx.store.get('SELECT * FROM fields WHERE id = ?', id));
  },
  /** A field is retired, never wiped: what people filled in is kept, and no longer shown or told. */
  remove(ctx, id) {
    must(ctx);
    const before = readField(one(ctx.store, 'fields', id, 'field'));
    ctx.store.tx(() => {
      update(ctx.store, 'fields', id, { active: false });
      ctx.store.record(ctx.who.label, 'retire', 'field', id, `${before.target}.${before.key}`, fieldJson(before), { active: false });
    });
    return { status: 204 };
  },
};

// ── who may ask: applications, systems, and what each is shared ─────────────────────────────────────────────

export const clients = {
  list(ctx) { must(ctx); return { clients: ctx.store.all('SELECT * FROM clients ORDER BY name').map(clientOut) }; },
  create(ctx) {
    must(ctx);
    const raw = body(ctx);
    const organisation = organisationOf(ctx.store, raw.organisation);
    const clientId = text(raw.client_id, 255);
    const withKey = !!raw.key;
    if (!clientId && !withKey) throw new OrgError('An application is known by its client id at the sign-in service, or is given a key (key: true).', 'invalid');
    const key = withKey ? newKey(CLIENT_PREFIX) : '';
    const id = newId();
    const at = now();
    const values = { name: name(raw.name, 'An application'), client_id: clientId, contact: text(raw.contact, 255), note: text(raw.note, 2000) };
    ctx.store.tx(() => {
      ctx.store.run(`INSERT INTO clients (id, organisation_id, name, client_id, key_hash, key_hint, contact, note, active, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`, id, organisation.id, values.name, values.client_id, key ? hashOf(key) : '', key ? key.slice(-4) : '',
      values.contact, values.note, ctx.who.label, at, at);
      ctx.store.record(ctx.who.label, 'create', 'client', id, values.name, null, { ...values, key: !!key });
    });
    const out = { client: clientOut(ctx.store.get('SELECT * FROM clients WHERE id = ?', id)) };
    if (key) out.key = key;                       // shown this once; only its hash is kept
    return { status: 201, body: out };
  },
  read(ctx, id) {
    must(ctx);
    const c = one(ctx.store, 'clients', id, 'application');
    return { ...clientOut(c), shares: ctx.store.all('SELECT * FROM shares WHERE client_id = ? ORDER BY created_at', id).map(shareOut) };
  },
  change(ctx, id) {
    must(ctx);
    const raw = body(ctx);
    const before = one(ctx.store, 'clients', id, 'application');
    const values = {};
    if (has(raw, 'name')) values.name = name(raw.name, 'An application');
    if (has(raw, 'client_id')) values.client_id = text(raw.client_id, 255);
    if (has(raw, 'contact')) values.contact = text(raw.contact, 255);
    if (has(raw, 'note')) values.note = text(raw.note, 2000);
    if (has(raw, 'active')) values.active = !!raw.active;
    ctx.store.tx(() => {
      update(ctx.store, 'clients', id, values);
      ctx.store.record(ctx.who.label, 'update', 'client', id, before.name, clientOut(before), values);
    });
    return clientOut(ctx.store.get('SELECT * FROM clients WHERE id = ?', id));
  },
  remove(ctx, id) {
    must(ctx);
    const before = one(ctx.store, 'clients', id, 'application');
    ctx.store.tx(() => {
      ctx.store.run('DELETE FROM clients WHERE id = ?', id);
      ctx.store.record(ctx.who.label, 'delete', 'client', id, before.name, clientOut(before), null);
    });
    return { status: 204 };
  },
  /** A new key: shown once; the old one opens nothing from now on. */
  key(ctx, id) {
    must(ctx);
    const before = one(ctx.store, 'clients', id, 'application');
    const key = newKey(CLIENT_PREFIX);
    ctx.store.tx(() => {
      update(ctx.store, 'clients', id, { key_hash: hashOf(key), key_hint: key.slice(-4) });
      ctx.store.record(ctx.who.label, 'new_key', 'client', id, before.name, null, { key_hint: key.slice(-4) });
    });
    return { client: clientOut(ctx.store.get('SELECT * FROM clients WHERE id = ?', id)), key };
  },
};

function cleanShare(ctx, raw, existing) {
  const out = {};
  const client = existing ? one(ctx.store, 'clients', existing.client_id, 'application') : one(ctx.store, 'clients', raw.client, 'application');
  if (!existing) out.client_id = client.id;
  if (has(raw, 'department') || !existing) {
    if (raw.department) {
      const dept = one(ctx.store, 'departments', raw.department, 'department');
      if (dept.organisation_id !== client.organisation_id) throw new OrgError("A share is of the application's own organisation.", 'invalid');
      out.department_id = dept.id;
    } else out.department_id = null;
  }
  if (has(raw, 'depth') || !existing) {
    const depth = String(raw.depth || 'structure');
    if (!DEPTHS.includes(depth)) throw new OrgError('A share tells the structure, who holds the seats, or how to reach them (structure, holders, contact).', 'invalid');
    out.depth = depth;
  }
  if (has(raw, 'fields') || !existing) {
    const organisation = organisationOf(ctx.store, client.organisation_id);
    const tellable = new Set(['department', 'position', 'assignment', 'person'].flatMap((t) => fieldsFor(ctx.store, t, organisation).filter((f) => f.shareable).map((f) => f.key)));
    const keys = (Array.isArray(raw.fields) ? raw.fields : []).map((k) => String(k));
    const not = keys.filter((k) => !tellable.has(k));
    if (not.length) throw new OrgError(`Only fields marked as tellable are shared: ${not.slice(0, 5).join(', ')}`, 'invalid');
    out.fields = JSON.stringify([...new Set(keys)]);
  }
  if (has(raw, 'purpose')) out.purpose = text(raw.purpose, 500);
  if (has(raw, 'valid_from')) out.valid_from = raw.valid_from ? dayOf(raw.valid_from, null, 'valid_from') : null;
  if (has(raw, 'valid_to')) out.valid_to = raw.valid_to ? dayOf(raw.valid_to, null, 'valid_to') : null;
  if (has(raw, 'active')) out.active = !!raw.active;
  const from = has(out, 'valid_from') ? out.valid_from : existing?.valid_from;
  const to = has(out, 'valid_to') ? out.valid_to : existing?.valid_to;
  if (from && to && to < from) throw new OrgError('A share ends on or after the day it begins', 'invalid');
  return out;
}

export const shares = {
  list(ctx) {
    must(ctx);
    const client = ctx.query.get('client');
    const rows = client ? ctx.store.all('SELECT * FROM shares WHERE client_id = ? ORDER BY created_at', client) : ctx.store.all('SELECT * FROM shares ORDER BY created_at');
    return { shares: rows.map(shareOut) };
  },
  create(ctx) {
    must(ctx);
    const values = cleanShare(ctx, body(ctx), null);
    const id = newId();
    const at = now();
    ctx.store.tx(() => {
      ctx.store.run(`INSERT INTO shares (id, client_id, department_id, depth, fields, purpose, valid_from, valid_to, active, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, values.client_id, values.department_id, values.depth, values.fields, values.purpose || '', values.valid_from || null,
      values.valid_to || null, values.active !== false, ctx.who.label, at, at);
      ctx.store.record(ctx.who.label, 'create', 'share', id, values.depth, null, values);
    });
    return { status: 201, body: shareOut(ctx.store.get('SELECT * FROM shares WHERE id = ?', id)) };
  },
  read(ctx, id) { must(ctx); return shareOut(one(ctx.store, 'shares', id, 'share')); },
  change(ctx, id) {
    must(ctx);
    const before = one(ctx.store, 'shares', id, 'share');
    const values = cleanShare(ctx, body(ctx), before);
    ctx.store.tx(() => {
      update(ctx.store, 'shares', id, values);
      ctx.store.record(ctx.who.label, 'update', 'share', id, before.depth, shareOut(before), values);
    });
    return shareOut(ctx.store.get('SELECT * FROM shares WHERE id = ?', id));
  },
  remove(ctx, id) {
    must(ctx);
    const before = one(ctx.store, 'shares', id, 'share');
    ctx.store.tx(() => {
      ctx.store.run('DELETE FROM shares WHERE id = ?', id);
      ctx.store.record(ctx.who.label, 'delete', 'share', id, before.depth, shareOut(before), null);
    });
    return { status: 204 };
  },
};

// ── the keepers' own keys ────────────────────────────────────────────────────────────────────────────────────

/** A keeper key, made: its hash kept, the key itself handed back once. */
export function makeKeeperKey(store, label, by = 'cli', given = '') {
  const key = given || newKey(KEEPER_PREFIX);
  const id = newId();
  store.tx(() => {
    store.run('INSERT INTO keepers (id, name, key_hash, key_hint, active, created_at) VALUES (?, ?, ?, ?, 1, ?)', id, text(label, 120) || 'keeper', hashOf(key), key.slice(-4), now());
    store.record(by, 'create', 'keeper', id, label, null, { key_hint: key.slice(-4) });
  });
  return { id, key };
}

export const keepers = {
  list(ctx) { must(ctx); return { keepers: ctx.store.all('SELECT * FROM keepers ORDER BY created_at').map(keeperOut) }; },
  create(ctx) {
    must(ctx);
    const made = makeKeeperKey(ctx.store, name(body(ctx).name, 'A keeper key', 120), ctx.who.label);
    return { status: 201, body: { keeper: keeperOut(ctx.store.get('SELECT * FROM keepers WHERE id = ?', made.id)), key: made.key } };
  },
  remove(ctx, id) {
    must(ctx);
    const before = one(ctx.store, 'keepers', id, 'keeper key');
    if (before.active && ctx.store.get('SELECT COUNT(*) AS n FROM keepers WHERE active = 1').n <= 1) {
      throw new OrgError('The last keeper key stays: make another one first.', 'conflict');
    }
    ctx.store.tx(() => {
      ctx.store.run('DELETE FROM keepers WHERE id = ?', id);
      ctx.store.record(ctx.who.label, 'delete', 'keeper', id, before.name, keeperOut(before), null);
    });
    return { status: 204 };
  },
};

// ── the record: questions asked, changes made ────────────────────────────────────────────────────────────────

export function access(ctx) {
  must(ctx);
  const limit = Math.min(500, Math.max(1, Number(ctx.query.get('limit')) || 100));
  const client = ctx.query.get('client');
  const rows = client ? ctx.store.all('SELECT * FROM access_log WHERE client_id = ? ORDER BY id DESC LIMIT ?', client, limit)
    : ctx.store.all('SELECT * FROM access_log ORDER BY id DESC LIMIT ?', limit);
  return { access: rows.map((r) => ({ id: r.id, client: r.client_id, share: r.share_id, subject: r.subject, what: r.what, about: r.about, answered: !!r.answered, at: r.at })) };
}

export function changes(ctx) {
  must(ctx);
  const since = Math.max(0, Number(ctx.query.get('since')) || 0);
  const limit = Math.min(1000, Math.max(1, Number(ctx.query.get('limit')) || 200));
  const rows = ctx.store.all('SELECT * FROM changes WHERE id > ? ORDER BY id LIMIT ?', since, limit)
    .map((r) => ({ id: r.id, at: r.at, by: r.actor, action: r.action, kind: r.kind, object: r.object_id, label: r.label, before: parsed(r.before, null), after: parsed(r.after, null) }));
  return { changes: rows, last: rows.length ? rows[rows.length - 1].id : since };
}

// ── in and out ───────────────────────────────────────────────────────────────────────────────────────────────

export const IMPORT_COLUMNS = ['department', 'position', 'code', 'is_head', 'email', 'name', 'person_code', 'primary', 'valid_from', 'valid_to'];

/**
 * Departments (by their path, `Company / Tech / Platform`), positions (by title within a department), people (by
 * e-mail) and who holds which, from rows - all of it or, on the first row that cannot be read, none of it.
 */
export function importRows(ctx, rows, { dry = false, organisation: orgRef = null } = {}) {
  must(ctx);
  if (!Array.isArray(rows)) throw new OrgError('An import is a list of rows.', 'invalid');
  if (rows.length > MAX_IMPORT_ROWS) throw new OrgError(`An import holds at most ${MAX_IMPORT_ROWS} rows.`, 'too_large');
  const store = ctx.store;
  const organisation = organisationOf(store, orgRef);
  const told = { rows: rows.length, departments: 0, positions: 0, people: 0, assignments: 0 };
  const errors = [];
  const at = now();
  const d0 = day(ctx);
  const work = () => {
    const deptByPath = new Map();
    const c = chartOf(store, d0);
    for (const d of c.depts.values()) if (d.organisation_id === organisation.id) deptByPath.set(c.path(d.id).map((x) => x.name.toLowerCase()).join('\u0000'), d.id);
    rows.forEach((raw, i) => {
      const line = i + 2;
      try {
        const r = Object.fromEntries(Object.entries(raw && typeof raw === 'object' ? raw : {}).map(([k, v]) => [String(k).trim().toLowerCase(), v]));
        const parts = String(r.department ?? '').split(/\s*\/\s*/).map((s) => text(s, 255)).filter(Boolean);
        if (!parts.length) throw new OrgError('Every row names its department', 'invalid');
        let parent = null;
        for (let k = 0; k < parts.length; k += 1) {
          const key = parts.slice(0, k + 1).map((s) => s.toLowerCase()).join('\u0000');
          let id = deptByPath.get(key);
          if (!id) {
            id = newId();
            store.run(`INSERT INTO departments (id, organisation_id, parent_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`, id, organisation.id, parent, parts[k], at, at);
            deptByPath.set(key, id);
            told.departments += 1;
          }
          parent = id;
        }
        const deptId = parent;
        let seat = null;
        const title = text(r.position, 255);
        if (title) {
          seat = store.get('SELECT * FROM positions WHERE department_id = ? AND lower(title) = lower(?) AND active = 1', deptId, title);
          const head = flag(r.is_head ?? '') === true;
          if (!seat) {
            const id = newId();
            const headTaken = head && store.get('SELECT id FROM positions WHERE department_id = ? AND is_head = 1 AND active = 1', deptId);
            if (headTaken) throw new OrgError(`${parts.join(NAME_SEP)} already has a head seat`, 'conflict');
            store.run('INSERT INTO positions (id, department_id, title, code, is_head, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, deptId, title, text(r.code, 64), head, at, at);
            seat = { id, title };
            told.positions += 1;
          }
        }
        const email = r.email ? emailOf(r.email) : null;
        if (email) {
          let person = store.get('SELECT * FROM people WHERE email = ? COLLATE NOCASE', email);
          if (!person) {
            const made = store.run('INSERT INTO people (name, email, code, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', text(r.name, 255), email, text(r.person_code, 64), at, at);
            person = { id: Number(made.lastInsertRowid), email };
            told.people += 1;
          } else if (r.name && !person.name) {
            store.run('UPDATE people SET name = ?, updated_at = ? WHERE id = ?', text(r.name, 255), at, person.id);
          }
          if (seat) {
            const from = dayOf(r.valid_from, d0, 'valid_from');
            const to = r.valid_to ? dayOf(r.valid_to, null, 'valid_to') : null;
            dates(from, to);
            const holds = store.get('SELECT id FROM assignments WHERE person_id = ? AND position_id = ? AND (valid_to IS NULL OR valid_to >= ?)', person.id, seat.id, from);
            if (!holds) {
              const primary = r.primary === undefined || r.primary === '' ? !store.get('SELECT id FROM assignments WHERE person_id = ? AND is_primary = 1 AND (valid_to IS NULL OR valid_to >= ?)', person.id, from) : flag(r.primary) === true;
              if (primary) store.run('UPDATE assignments SET is_primary = 0 WHERE person_id = ?', person.id);
              store.run('INSERT INTO assignments (id, person_id, position_id, is_primary, valid_from, valid_to, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                newId(), person.id, seat.id, primary, from, to, at, at);
              told.assignments += 1;
            }
          }
        }
      } catch (err) {
        if (!(err instanceof OrgError)) throw err;
        errors.push({ row: line, error: err.message });
        if (errors.length >= 50) throw new OrgError('Too many rows cannot be read.', 'invalid');
      }
    });
    if (errors.length || dry) throw Object.assign(new Error('roll back'), { rollBack: true });
  };
  try {
    store.tx(work);
  } catch (err) {
    if (!err.rollBack && !(err instanceof OrgError && errors.length)) throw err;
  }
  if (errors.length) {
    const refused = new OrgError(`${errors.length} row${errors.length === 1 ? '' : 's'} could not be read: nothing was changed.`, 'invalid');
    refused.details = { errors };
    throw refused;
  }
  if (!dry) store.record(ctx.who.label, 'import', 'organisation', organisation.id, organisation.name, null, told);
  return { dry, organisation: organisation.key, ...told };
}

export function importBody(ctx) {
  const dry = flag(ctx.query.get('dry') || '') === true;
  const organisation = ctx.query.get('organisation');
  if (typeof ctx.body === 'string') return importRows(ctx, parseCsv(ctx.body, MAX_IMPORT_ROWS + 1), { dry, organisation });
  const raw = body(ctx);
  return importRows(ctx, raw.rows, { dry, organisation: organisation || raw.organisation });
}

export function exportAll(ctx) {
  must(ctx);
  const format = String(ctx.query.get('format') || 'json').toLowerCase();
  const c = chartOf(ctx.store, day(ctx));
  if (format === 'csv') {
    const rows = [];
    const depts = [...c.depts.values()].filter((d) => d.active).sort((a, b) => c.path(a.id).map((x) => x.name).join(NAME_SEP).localeCompare(c.path(b.id).map((x) => x.name).join(NAME_SEP)));
    const seatsBy = new Map();
    for (const s of c.seats.values()) { if (!seatsBy.has(s.department_id)) seatsBy.set(s.department_id, []); seatsBy.get(s.department_id).push(s); }
    const heldBy = new Map();
    for (const a of [...c.assignments.values()].flat()) { if (!heldBy.has(a.position_id)) heldBy.set(a.position_id, []); heldBy.get(a.position_id).push(a); }
    for (const d of depts) {
      const path = c.path(d.id).map((x) => x.name).join(NAME_SEP);
      const seats = (seatsBy.get(d.id) || []).sort((a, b) => (Number(b.is_head) - Number(a.is_head)) || a.title.localeCompare(b.title));
      if (!seats.length) rows.push({ department: path });
      for (const s of seats) {
        const held = heldBy.get(s.id) || [];
        if (!held.length) rows.push({ department: path, position: s.title, code: s.code, is_head: s.is_head });
        for (const a of held) {
          const p = c.people.get(a.person_id);
          rows.push({ department: path, position: s.title, code: s.code, is_head: s.is_head, email: p.email || '', name: p.name, person_code: p.code,
            primary: a.is_primary, valid_from: a.valid_from, valid_to: a.valid_to || '' });
        }
      }
    }
    return { raw: writeCsv(IMPORT_COLUMNS, rows), type: 'text/csv; charset=utf-8', file: `organisation-${day(ctx)}.csv` };
  }
  if (format !== 'json') throw new OrgError('An export is csv or json.', 'invalid');
  const out = {
    format: 'open-orgchart', version: 1, exported_at: now(),
    organisations: ctx.store.all('SELECT * FROM organisations ORDER BY created_at').map((o) => orgOut(orgRow(o))),
    departments: [...c.depts.values()].map((d) => deptOut(c, d)),
    positions: ctx.store.all('SELECT * FROM positions ORDER BY created_at').map(seatOut),
    people: ctx.store.all('SELECT * FROM people ORDER BY id').map(personOut),
    assignments: ctx.store.all('SELECT * FROM assignments ORDER BY created_at').map(assignmentOut),
    fields: ctx.store.all('SELECT * FROM fields ORDER BY target, sort_order, key').map((f) => fieldJson(f)),
  };
  return { raw: JSON.stringify(out, null, 2), type: 'application/json; charset=utf-8', file: `organisation-${day(ctx)}.json` };
}
