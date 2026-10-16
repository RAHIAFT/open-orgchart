// SPDX-License-Identifier: Apache-2.0
/**
 * THE ONE RULE FOR WHO ANSWERS TO WHOM, on a day.
 *
 * Read in this order: the person named by hand for them; else the seat their own seat reports to; else the head of
 * their department; and for a head, the head of the department above. A vacant seat is passed through - one
 * answers to whoever is above it, never to nobody because a chair is empty. Nobody answers to themselves (someone
 * holding the head seat and a seat under it answers upward). A person with several seats answers by their primary
 * one. Every answer is as of a day (assignments are dated): today unless asked.
 *
 * Everything is read from ONE snapshot of the chart on that day (`Chart`: a handful of queries, kept while nothing
 * in it changed), so a page of a hundred people costs what one person does.
 */
import { fieldsFor } from './fields.js';
import { parsed } from './util.js';

export const CHAIN_LIMIT = 20;
export const NAME_SEP = ' / ';

const displayName = (p) => (p ? (String(p.name || '').trim() || p.email || '') : '');
const byName = (a, b) => displayName(a).toLowerCase().localeCompare(displayName(b).toLowerCase());

export class Chart {
  constructor(store, day) {
    this.day = day;
    this.depts = new Map(store.all('SELECT * FROM departments ORDER BY sort_order, name').map((d) => [d.id, { ...d, active: !!d.active, extra: parsed(d.extra, {}) }]));
    const seats = store.all('SELECT * FROM positions WHERE active = 1 ORDER BY is_head DESC, title, created_at');
    this.seats = new Map(seats.map((p) => [p.id, { ...p, is_head: !!p.is_head, extra: parsed(p.extra, {}) }]));
    this.headSeat = new Map();
    for (const seat of this.seats.values()) if (seat.is_head && !this.headSeat.has(seat.department_id)) this.headSeat.set(seat.department_id, seat.id);
    this.people = new Map(store.all('SELECT * FROM people').map((p) => [p.id, { ...p, active: !!p.active, extra: parsed(p.extra, {}) }]));
    this.holders = new Map();
    this.assignments = new Map();
    this.seatsOf = new Map();
    const rows = store.all(`SELECT a.* FROM assignments a JOIN positions s ON s.id = a.position_id JOIN people p ON p.id = a.person_id
      WHERE a.valid_from <= ? AND (a.valid_to IS NULL OR a.valid_to >= ?) AND s.active = 1 AND p.active = 1
      ORDER BY a.acting, a.is_primary DESC, a.valid_from, a.created_at`, day, day);
    for (const a of rows) {
      if (!this.seats.has(a.position_id)) continue;
      const one = { ...a, is_primary: !!a.is_primary, acting: !!a.acting, extra: parsed(a.extra, {}) };
      push(this.holders, a.position_id, a.person_id);
      push(this.assignments, a.person_id, one);
    }
    for (const [personId, mine] of this.assignments) {
      mine.sort((a, b) => (Number(!a.is_primary) - Number(!b.is_primary)) || (Number(a.acting) - Number(b.acting))
        || a.valid_from.localeCompare(b.valid_from) || a.created_at.localeCompare(b.created_at));
      this.seatsOf.set(personId, mine.map((a) => a.position_id));
    }
    this.organisations = new Map(store.all('SELECT * FROM organisations ORDER BY is_default DESC, name').map((o) => [o.id, {
      ...o, is_default: !!o.is_default, active: !!o.active, names: parsed(o.names, {}), domains: parsed(o.domains, []) }]));
    this.store = store;
    this._manager = new Map();
    this._reports = null;
    this._paths = new Map();
  }

  // ── the seat above a seat
  above(seatId) {
    const seat = this.seats.get(seatId);
    if (!seat) return null;
    if (seat.reports_to && this.seats.has(seat.reports_to) && seat.reports_to !== seatId) return seat.reports_to;
    if (!seat.is_head) {
      const head = this.headSeat.get(seat.department_id);
      if (head && head !== seatId) return head;
    }
    return this.headAbove(seat.department_id);
  }

  /** The head seat of the nearest department ABOVE `deptId` that has one. */
  headAbove(deptId) {
    let dept = this.depts.get(deptId);
    let guard = 0;
    while (dept && dept.parent_id && guard < 64) {
      guard += 1;
      dept = this.depts.get(dept.parent_id);
      if (dept && this.headSeat.get(dept.id)) return this.headSeat.get(dept.id);
    }
    return null;
  }

  holder(seatId, notPerson = null) {
    return (this.holders.get(seatId) || []).find((p) => p !== notPerson) ?? null;
  }

  /** Who is over a seat: the holder of the first seat above it that someone (else) holds. */
  over(seatId, notPerson = null) {
    const seen = new Set([seatId]);
    let up = this.above(seatId);
    while (up !== null && !seen.has(up)) {
      seen.add(up);
      const boss = this.holder(up, notPerson);
      if (boss !== null) return boss;
      up = this.above(up);                 // a vacant seat is passed through
    }
    return null;
  }

  manager(personId) {
    if (this._manager.has(personId)) return this._manager.get(personId);
    let found = null;
    const person = this.people.get(personId);
    if (person && person.manager_id && person.manager_id !== personId && this.alive(person.manager_id)) {
      found = person.manager_id;
    } else {
      const seats = this.seatsOf.get(personId) || [];
      if (seats.length) found = this.over(seats[0], personId);
    }
    this._manager.set(personId, found);
    return found;
  }

  /** Who said a person's manager: 'hand' (named for them), 'chart' (the seats say it), '' (nobody is over them). */
  saidBy(personId) {
    const boss = this.manager(personId);
    if (boss === null) return '';
    const person = this.people.get(personId);
    return person && person.manager_id === boss ? 'hand' : 'chart';
  }

  chain(personId) {
    const out = [];
    const seen = new Set([personId]);
    let at = this.manager(personId);
    while (at !== null && !seen.has(at) && out.length < CHAIN_LIMIT) {
      out.push(at);
      seen.add(at);
      at = this.manager(at);
    }
    return out;
  }

  reports(personId, deep = false) {
    if (this._reports === null) {
      this._reports = new Map();
      for (const one of this.people.keys()) {
        if (!this.alive(one)) continue;
        const boss = this.manager(one);
        if (boss !== null) push(this._reports, boss, one);
      }
    }
    const direct = [...(this._reports.get(personId) || [])];
    if (!deep) return direct;
    const out = [];
    const seen = new Set([personId]);
    const queue = [...direct];
    while (queue.length) {
      const one = queue.shift();
      if (seen.has(one)) continue;
      seen.add(one);
      out.push(one);
      queue.push(...(this._reports.get(one) || []));
    }
    return out;
  }

  /** Who leads a department: its head - or, the seat vacant (or there being none), whoever leads above it. */
  head(deptId) {
    const seat = this.headSeat.get(deptId);
    if (seat) {
      const boss = this.holder(seat);
      return boss !== null ? boss : this.over(seat);
    }
    const up = this.headAbove(deptId);
    if (up === null) return null;
    const boss = this.holder(up);
    return boss !== null ? boss : this.over(up);
  }

  // ── people
  alive(personId) {
    const p = this.people.get(personId);
    return !!(p && p.active);
  }

  person(personId) {
    return this.alive(personId) ? this.people.get(personId) : null;
  }

  persons(ids) {
    return ids.map((id) => this.person(id)).filter(Boolean);
  }

  /** A department's place, from the top: [department, ...] ending with itself. */
  path(deptId) {
    if (this._paths.has(deptId)) return this._paths.get(deptId);
    const out = [];
    const seen = new Set();
    let at = this.depts.get(deptId);
    while (at && !seen.has(at.id) && out.length < 64) {
      out.unshift(at);
      seen.add(at.id);
      at = at.parent_id ? this.depts.get(at.parent_id) : null;
    }
    this._paths.set(deptId, out);
    return out;
  }

  level(deptId) {
    return Math.max(0, this.path(deptId).length - 1);
  }

  /** Is `deptId` the department `rootId` or under it? */
  within(deptId, rootId) {
    return this.path(deptId).some((d) => d.id === rootId);
  }

  // ── whose chart
  home() {
    for (const o of this.organisations.values()) if (o.is_default && o.active) return o;
    for (const o of this.organisations.values()) if (o.active) return o;
    return [...this.organisations.values()][0] || null;
  }

  organisationOf(person) {
    for (const seatId of this.seatsOf.get(person.id) || []) {
      const dept = this.depts.get(this.seats.get(seatId).department_id);
      if (dept && dept.organisation_id) return this.organisations.get(dept.organisation_id) || this.home();
    }
    if (person.organisation_id && this.organisations.has(person.organisation_id)) return this.organisations.get(person.organisation_id);
    const domain = String(person.email || '').split('@')[1]?.toLowerCase();
    if (domain) {
      for (const o of this.organisations.values()) if (o.active && o.domains.map((d) => String(d).toLowerCase()).includes(domain)) return o;
    }
    return this.home();
  }
}

function push(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

// ── the chart on a day, kept while nothing in it changed ──────────────────────────────────────────────────────

const kept = new WeakMap();

export function chartOf(store, day) {
  let mine = kept.get(store);
  if (!mine) { mine = new Map(); kept.set(store, mine); }
  const stamp = store.stamp();
  const have = mine.get(day);
  if (have && have.stamp === stamp) return have.chart;
  if (mine.size > 8) mine.clear();
  const chart = new Chart(store, day);
  mine.set(day, { stamp, chart });
  return chart;
}

// ── what is told of a person, a department, the tree ──────────────────────────────────────────────────────────

/** A person, named: who they are, - `contact` - how to reach them, and - `sub` - who they are to the sign-in service. */
export function personRef(p, { contact = true, sub = false } = {}) {
  const out = { id: p.id, name: displayName(p) };
  if (sub) out.sub = p.sub || '';
  if (contact) out.email = p.email || '';
  return out;
}

export function organisationJson(o) {
  return { id: o.id, key: o.key, name: o.name, names: o.names || {}, domains: o.domains || [], is_default: !!o.is_default };
}

function deptRef(c, deptId) {
  const dept = c.depts.get(deptId);
  if (!dept) return null;
  const path = c.path(deptId);
  return { id: dept.id, name: dept.name, path: path.map((d) => d.name), path_ids: path.map((d) => d.id) };
}

const telling = (keys) => (values) => {
  const all = values && typeof values === 'object' ? values : {};
  if (keys === null || keys === undefined) return { ...all };
  return Object.fromEntries(Object.entries(all).filter(([k]) => keys.has(k)));
};

/**
 * A person as the organisation knows them. `contact`: with how to reach people. `extraKeys`: which of the
 * organisation's own fields are told (null: all of them).
 */
export function card(c, p, { contact = true, extraKeys = null } = {}) {
  const told = telling(extraKeys);
  const organisation = c.organisationOf(p);
  const seats = (c.assignments.get(p.id) || []).map((a) => {
    const seat = c.seats.get(a.position_id);
    return {
      position: { id: seat.id, title: seat.title, code: seat.code, extra: told(seat.extra) }, department: deptRef(c, seat.department_id),
      is_head: seat.is_head, primary: a.is_primary, acting: a.acting, since: a.valid_from || null, until: a.valid_to || null, extra: told(a.extra),
    };
  });
  const first = seats[0] || null;
  const bossId = c.manager(p.id);
  const boss = bossId !== null ? c.person(bossId) : null;
  return {
    ...personRef(p, { contact, sub: true }),
    organisation: organisation ? { key: organisation.key, name: organisation.name } : null,
    code: p.code || '', seats, department: first ? first.department : null, position: first ? first.position : null,
    is_head: !!(first && first.is_head), manager: boss ? personRef(boss, { contact }) : null, extra: told(p.extra), as_of: c.day,
  };
}

/** What a person's sign-in carries about them - flat, small, and only what the chart says. */
export function claims(c, p) {
  const organisation = c.organisationOf(p);
  const seats = c.seatsOf.get(p.id) || [];
  const seat = seats.length ? c.seats.get(seats[0]) : null;
  const bossId = c.manager(p.id);
  const boss = bossId !== null ? c.person(bossId) : null;
  const path = seat ? c.path(seat.department_id) : [];
  const departments = [];
  for (const seatId of seats) for (const d of c.path(c.seats.get(seatId).department_id)) if (!departments.includes(d.id)) departments.push(d.id);
  const marked = new Set(fieldsFor(c.store, 'person', organisation).filter((f) => f.in_claims).map((f) => f.key));
  const out = {
    org: organisation ? organisation.key : '', org_name: organisation ? organisation.name : '',
    department: path.length ? path[path.length - 1].name : '', department_id: path.length ? path[path.length - 1].id : '',
    department_path: path.map((d) => d.name).join(NAME_SEP), departments,
    position: seat ? seat.title : '', position_id: seat ? seat.id : '', position_code: seat ? seat.code : '', is_head: !!(seat && seat.is_head),
    heads: seats.filter((s) => c.seats.get(s).is_head).map((s) => c.seats.get(s).department_id),
    manager: boss ? boss.email || '' : '', manager_name: boss ? displayName(boss) : '', code: p.code || '',
  };
  const fields = Object.fromEntries(Object.entries(p.extra || {}).filter(([k]) => marked.has(k)));
  if (Object.keys(fields).length) out.fields = fields;
  return out;
}

/**
 * The departments of an organisation (or the part under `root`), each with its seats and - `holders` - who holds
 * them. Flat, parents before children; `parent` ties them.
 */
export function tree(c, { organisation = null, root = null, holders = true, contact = true, extraKeys = null } = {}) {
  const told = telling(extraKeys);
  let depts = [...c.depts.values()].sort((a, b) => (c.level(a.id) - c.level(b.id)) || (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));
  if (organisation) depts = depts.filter((d) => d.organisation_id === organisation.id);
  if (root) depts = depts.filter((d) => c.within(d.id, root.id));
  const seatsBy = new Map();
  for (const seat of c.seats.values()) push(seatsBy, seat.department_id, seat);
  const out = [];
  for (const d of depts) {
    if (!d.active) continue;
    const seats = (seatsBy.get(d.id) || []).slice().sort((a, b) => (Number(b.is_head) - Number(a.is_head)) || a.title.localeCompare(b.title)).map((seat) => {
      const one = { id: seat.id, title: seat.title, code: seat.code, is_head: seat.is_head, reports_to: seat.reports_to || null, extra: told(seat.extra) };
      if (holders) one.holders = c.persons(c.holders.get(seat.id) || []).map((p) => personRef(p, { contact }));
      return one;
    });
    const row = { id: d.id, name: d.name, parent: d.parent_id || null, level: c.level(d.id), path: c.path(d.id).map((x) => x.name), positions: seats, extra: told(d.extra) };
    if (holders) {
      const seat = c.headSeat.get(d.id);
      const head = seat ? c.person(c.holder(seat)) : null;
      row.head = head ? personRef(head, { contact }) : null;
    }
    out.push(row);
  }
  return out;
}

export const managerOf = (c, p) => { const id = c.manager(p.id); return id !== null ? c.person(id) : null; };
export const chainOf = (c, p) => c.persons(c.chain(p.id));
export const reportsOf = (c, p, deep = false) => c.persons(c.reports(p.id, deep)).sort(byName);
export function peersOf(c, p) {
  const boss = c.manager(p.id);
  if (boss === null) return [];
  return c.persons(c.reports(boss).filter((id) => id !== p.id)).sort(byName);
}
export { displayName, byName };
