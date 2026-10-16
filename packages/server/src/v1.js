// SPDX-License-Identifier: Apache-2.0
/**
 * THE CONTRACT: `/api/org/v1/` - what anyone who may ask is told. GET only; every question takes `as_of=YYYY-MM-DD`
 * (today when not asked), and a closing slash or none.
 *
 *   /                          what this is, who you are to it, what you may ask
 *   me                         the person behind the sign-in: their card     (me/manager, me/chain ... too)
 *   people/<ref>               a person's card    (<ref>: an id, an e-mail address, a sign-in subject)
 *   people/<ref>/manager       who they answer to
 *   people/<ref>/chain         ... and on up
 *   people/<ref>/reports       who answers to them   (?deep=1: everyone under them)
 *   people/<ref>/peers         who answers to the same person
 *   claims/<ref>               what their sign-in carries (`me` for oneself)
 *   tree                       the departments, their seats, who holds them   (?root=<department>)
 *   reporting                  who answers to whom, as one list: the lines of a chart of people and of positions
 *   departments/<id>           one department, and who leads it
 *   fields                     the organisation's own fields   (?target=person|position|...)
 *
 * The same contract Divan's organisation answers, so a program written against one works against the other.
 */
import { DEPTHS, Cover, note } from './auth.js';
import { card, chainOf, chartOf, claims as claimsOf, managerOf, organisationJson, peersOf, personRef, reportsOf, tree as treeOf, byName } from './chart.js';
import { TARGETS, fieldJson, fieldsFor } from './fields.js';
import { OrgError, dayOf, flag, today } from './util.js';
import { VERSION as SERVICE_VERSION } from './version.js';

export const VERSION = '1';
const ASKS = ['me', 'people/<ref>', 'people/<ref>/manager', 'people/<ref>/chain', 'people/<ref>/reports', 'people/<ref>/peers',
  'claims/<ref>', 'tree', 'reporting', 'departments/<id>', 'fields'];

/** (chart, cover, day) for a question - or the refusal. */
function open(ctx, what) {
  const day = dayOf(ctx.query.get('as_of'), today(ctx.config.timeZone));
  const chart = chartOf(ctx.store, day);
  const tellableOf = (target, organisation) => new Set(fieldsFor(ctx.store, target, organisation).filter((f) => f.shareable).map((f) => f.key));
  const cover = new Cover(ctx.store, chart, ctx.who, day, tellableOf);
  if (ctx.who.kind === 'client' && !cover.shares.length) {
    note(ctx.store, ctx.who, cover, what, { answered: false });
    throw new OrgError('Nothing of the organisation is shared with this application.', 'no_share');
  }
  return { chart, cover, day };
}

const organisationsFor = (ctx, chart) => (ctx.who.kind === 'client'
  ? [chart.organisations.get(ctx.who.client.organisation_id)].filter(Boolean)
  : [...chart.organisations.values()].filter((o) => o.active));

/** The person a reference means: an id ('7', 'person:7', 'user:7'), an address, a sign-in subject. */
export function findPerson(store, ref) {
  const said = String(ref || '').trim();
  if (!said) return null;
  const bare = said.replace(/^(person|user):/, '');
  if (/^\d+$/.test(bare)) return store.get('SELECT * FROM people WHERE id = ? AND active = 1', Number(bare)) || null;
  if (said.includes('@')) return store.get('SELECT * FROM people WHERE email = ? COLLATE NOCASE AND active = 1', said) || null;
  return store.get('SELECT * FROM people WHERE sub = ? AND active = 1', said) || null;
}

function target(ctx, chart, ref) {
  if (ref === 'me') {
    if (!ctx.who.person) throw new OrgError('There is no person behind this question.', 'no_person');
    return chart.people.get(ctx.who.person.id) || ctx.who.person;
  }
  const found = findPerson(ctx.store, ref);
  if (!found) throw new OrgError('Nobody the organisation knows.', 'not_found');
  return chart.people.get(found.id) || found;
}

/** A card of `p` as this asker may see it - or the refusal. */
function personAnswer(ctx, chart, cover, p, what) {
  const { who } = ctx;
  const organisation = chart.organisationOf(p);
  const own = !!(who.person && who.person.id === p.id);
  let [depth, deptId] = cover.ofPerson(p, chart);
  if (who.kind === 'client' && (!organisation || who.client.organisation_id !== organisation.id)) depth = null;
  if ((depth === null || depth === 'structure') && !own) {
    note(ctx.store, who, cover, what, { about: p.id, answered: false });
    throw new OrgError('This person is not among what is shared with the application.', 'not_shared');
  }
  const extraKeys = cover.tellable('person', organisation, deptId);
  const out = card(chart, p, { contact: own || depth === 'contact', extraKeys });
  if (who.kind === 'client' && out.manager && depth !== 'contact') delete out.manager.email;   // one's own card says WHO one answers to, not how to reach them
  note(ctx.store, who, cover, what, { about: p.id, deptId });
  return out;
}

/** Other people, named as this asker may see them (those not shared are left out). */
function others(ctx, chart, cover, list, what, about) {
  const out = [];
  for (const p of list) {
    const [depth] = cover.ofPerson(p, chart);
    if (depth === null || depth === 'structure') continue;
    out.push(personRef(p, { contact: depth === 'contact' }));
  }
  note(ctx.store, ctx.who, cover, what, { about });
  return out;
}

export function index(ctx) {
  const { chart, cover, day } = open(ctx, 'index');
  const you = { kind: ctx.who.kind };
  if (ctx.who.kind === 'client') {
    you.client = ctx.who.client.name;
    you.shares = cover.shares.map((s) => ({ department: s.department_id || null, depth: s.depth, fields: s.fields, until: s.valid_to || null }));
  }
  if (ctx.who.person) you.person = personRef(ctx.who.person, { sub: true });
  return { service: 'organisation', version: VERSION, implementation: { name: 'open-orgchart', version: SERVICE_VERSION }, as_of: day, you,
    organisations: organisationsFor(ctx, chart).map(organisationJson), asks: ASKS };
}

export function person(ctx, ref = 'me', ask = '') {
  const what = ask ? `people/${ask}` : 'people';
  const { chart, cover, day } = open(ctx, what);
  const p = target(ctx, chart, ref);
  const answer = personAnswer(ctx, chart, cover, p, what);
  if (!ask) return answer;
  if (ask === 'manager') return { of: answer.id, manager: answer.manager, as_of: day };
  if (ask === 'chain') return { of: answer.id, chain: others(ctx, chart, cover, chainOf(chart, p), what, p.id), as_of: day };
  if (ask === 'reports') {
    const deep = flag(ctx.query.get('deep') || '') === true;
    return { of: answer.id, deep, reports: others(ctx, chart, cover, reportsOf(chart, p, deep), what, p.id), as_of: day };
  }
  if (ask === 'peers') return { of: answer.id, peers: others(ctx, chart, cover, peersOf(chart, p), what, p.id), as_of: day };
  throw new OrgError('That is not something to ask of a person.', 'not_found');
}

export function claims(ctx, ref = 'me') {
  const { chart, cover } = open(ctx, 'claims');
  const p = target(ctx, chart, ref);
  const own = !!(ctx.who.person && ctx.who.person.id === p.id);
  const [depth, deptId] = cover.ofPerson(p, chart);
  if (!own && depth !== 'contact') {
    note(ctx.store, ctx.who, cover, 'claims', { about: p.id, answered: false });
    throw new OrgError("A person's claims are theirs, or of an application told how to reach them.", 'not_shared');
  }
  const out = claimsOf(chart, p);
  if (ctx.who.kind === 'client' && depth !== 'contact') delete out.manager;
  const tellable = cover.tellable('person', chart.organisationOf(p), deptId);
  if (tellable !== null && out.fields) out.fields = Object.fromEntries(Object.entries(out.fields).filter(([k]) => tellable.has(k)));
  note(ctx.store, ctx.who, cover, 'claims', { about: p.id, deptId });
  return out;
}

function treeFor(ctx, chart, cover, root = null) {
  const out = [];
  for (const organisation of organisationsFor(ctx, chart)) {
    const rows = treeOf(chart, { organisation, root, holders: true, contact: true, extraKeys: null });
    for (const row of rows) {
      const depth = cover.depth(row.id);
      if (depth === null) continue;
      row.organisation = organisation.key;
      if (ctx.who.kind !== 'keeper') {
        const keepD = cover.tellable('department', organisation, row.id) || new Set();
        const keepP = cover.tellable('position', organisation, row.id) || new Set();
        row.extra = Object.fromEntries(Object.entries(row.extra || {}).filter(([k]) => keepD.has(k)));
        for (const seat of row.positions) seat.extra = Object.fromEntries(Object.entries(seat.extra || {}).filter(([k]) => keepP.has(k)));
      }
      if (depth === 'structure') {
        delete row.head;
        for (const seat of row.positions) delete seat.holders;
      } else if (depth === 'holders') {
        if (row.head) delete row.head.email;
        for (const seat of row.positions) for (const holder of seat.holders || []) delete holder.email;
      }
      row.depth = depth;
      out.push(row);
    }
  }
  return out;
}

export function tree(ctx) {
  const { chart, cover, day } = open(ctx, 'tree');
  let root = null;
  const asked = ctx.query.get('root');
  if (asked) {
    root = chart.depts.get(asked) || null;
    if (!root) throw new OrgError('No such department.', 'not_found');
  }
  const departments = treeFor(ctx, chart, cover, root);
  note(ctx.store, ctx.who, cover, 'tree', { about: root ? root.id : '' });
  return { as_of: day, departments };
}

/**
 * Who answers to whom, as one list - the lines of a chart of PEOPLE: everyone who holds a seat (or was named a
 * manager by hand, or is one), as this asker may be told them, each with who they answer to by the one rule; and
 * the same of the SEATS - the lines of a chart of positions: each seat with the seat it answers to.
 */
export function reporting(ctx) {
  const { chart, cover, day } = open(ctx, 'reporting');
  const { who } = ctx;
  const ids = new Set(chart.seatsOf.keys());
  for (const p of chart.people.values()) if (p.manager_id && p.active) ids.add(p.id);
  for (const id of [...ids]) { const boss = chart.manager(id); if (boss !== null) ids.add(boss); }
  const rows = [];
  const shown = new Set();
  for (const p of chart.persons([...ids]).sort(byName)) {
    let [depth] = cover.ofPerson(p, chart);
    if (who.kind === 'client' && chart.organisationOf(p)?.id !== who.client.organisation_id) depth = null;
    if (depth === null || depth === 'structure') continue;
    const seats = chart.seatsOf.get(p.id) || [];
    const seat = seats.length ? chart.seats.get(seats[0]) : null;
    const dept = seat ? chart.depts.get(seat.department_id) : null;
    rows.push({ ...personRef(p, { contact: depth === 'contact' }), position: seat ? seat.title : '', position_id: seat ? seat.id : '',
      department: dept ? dept.name : '', department_id: dept ? dept.id : '', is_head: !!(seat && seat.is_head), manager: chart.manager(p.id) });
    shown.add(p.id);
  }
  for (const row of rows) if (!shown.has(row.manager)) row.manager = null;   // who is not among what is shared is not named: the line ends there
  const seats = [];
  const ordered = [...chart.seats.values()].sort((a, b) => a.department_id.localeCompare(b.department_id) || (Number(b.is_head) - Number(a.is_head)) || a.title.localeCompare(b.title));
  for (const seat of ordered) {
    const dept = chart.depts.get(seat.department_id);
    const depth = cover.depth(seat.department_id);
    if (!dept || !dept.active || depth === null) continue;
    if (who.kind === 'client' && dept.organisation_id !== who.client.organisation_id) continue;
    const above = chart.above(seat.id);
    const one = { id: seat.id, title: seat.title, code: seat.code, department: dept.name, department_id: dept.id, is_head: seat.is_head, answers_to: above || null };
    if (depth !== 'structure') one.holders = chart.persons(chart.holders.get(seat.id) || []).map((p) => personRef(p, { contact: depth === 'contact' }));
    seats.push(one);
  }
  const told = new Set(seats.map((s) => s.id));
  for (const one of seats) if (!told.has(one.answers_to)) one.answers_to = null;
  note(ctx.store, who, cover, 'reporting');
  return { as_of: day, people: rows, seats };
}

export function department(ctx, id) {
  const { chart, cover, day } = open(ctx, 'departments');
  const dept = chart.depts.get(id);
  const rows = dept ? treeFor(ctx, chart, cover, dept).filter((r) => r.id === id) : [];
  if (!rows.length) {
    note(ctx.store, ctx.who, cover, 'departments', { about: id, answered: false });
    throw new OrgError('No such department among what you may see.', 'not_found');
  }
  const row = rows[0];
  if (row.depth !== 'structure') {
    // who leads it in fact: its head - or, the seat vacant, whoever leads above
    const leads = chart.head(dept.id);
    const p = leads !== null ? chart.person(leads) : null;
    row.leads = p ? personRef(p, { contact: row.depth === 'contact' }) : null;
  }
  note(ctx.store, ctx.who, cover, 'departments', { about: id, deptId: dept.id });
  return { ...row, as_of: day };
}

export function fields(ctx) {
  const { chart, cover } = open(ctx, 'fields');
  const asked = ctx.query.get('target');
  const out = [];
  const seen = new Set();
  for (const organisation of organisationsFor(ctx, chart)) {
    for (const t of TARGETS.includes(asked) ? [asked] : TARGETS) {
      const keep = cover.tellable(t, organisation);
      for (const f of fieldsFor(ctx.store, t, organisation)) {
        if ((keep === null || keep.has(f.key)) && !seen.has(f.id)) { seen.add(f.id); out.push(fieldJson(f)); }
      }
    }
  }
  note(ctx.store, ctx.who, cover, 'fields');
  return { fields: out };
}

export { DEPTHS, managerOf };
