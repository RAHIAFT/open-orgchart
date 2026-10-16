// SPDX-License-Identifier: Apache-2.0
/**
 * THE ONE RULE: who answers to whom, on a day - the person named by hand; else the seat their seat reports to; else
 * the head of their department; for a head, the head above. A vacant seat is passed through; nobody answers to
 * themselves; a person with several seats answers by their primary one; every answer is as of a day.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Chart, card, chainOf, claims, managerOf, peersOf, reportsOf, tree } from '../src/chart.js';
import { Store } from '../src/db.js';
import { ensureOrganisation } from '../src/keepers.js';

const AT = '2026-01-01T00:00:00.000Z';

/** A small firm: the company over two units, one of them with a team inside it, and a lab under that. */
function firm() {
  const store = new Store(':memory:');
  ensureOrganisation(store);
  const org = store.get('SELECT id FROM organisations').id;
  const dept = (id, name, parent = null, active = 1) => store.run('INSERT INTO departments (id, organisation_id, parent_id, name, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, org, parent, name, active, AT, AT);
  const seat = (id, d, title, more = {}) => store.run('INSERT INTO positions (id, department_id, title, code, is_head, reports_to, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id, d, title, more.code || '', more.head ? 1 : 0, more.reportsTo || null, AT, AT);
  const person = (name, extra = {}) => Number(store.run('INSERT INTO people (name, email, sub, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', name, `${name.toLowerCase()}@corp.example`, extra.sub || null, AT, AT).lastInsertRowid);
  const holds = (p, s, more = {}) => store.run('INSERT INTO assignments (id, person_id, position_id, is_primary, acting, valid_from, valid_to, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    `a-${p}-${s}`, p, s, more.primary === false ? 0 : 1, more.acting ? 1 : 0, more.from || '2024-01-01', more.to || null, AT, AT);
  dept('co', 'Company'); dept('sales', 'Sales', 'co'); dept('tech', 'Tech', 'co'); dept('lab', 'Lab', 'tech');
  seat('p-ceo', 'co', 'Chief executive', { head: true, code: 'CEO' });
  seat('p-sh', 'sales', 'Head of sales', { head: true });
  seat('p-rep', 'sales', 'Sales representative');
  seat('p-cto', 'tech', 'Chief technology officer', { head: true });
  seat('p-lead', 'tech', 'Team lead');
  seat('p-dev', 'tech', 'Developer', { reportsTo: 'p-lead' });
  seat('p-ops', 'tech', 'Operations');
  seat('p-lab', 'lab', 'Researcher');
  const people = { cyrus: person('Cyrus', { sub: 'sub-cyrus' }), tara: person('Tara'), lena: person('Lena'), dan: person('Dan'), dora: person('Dora'), omid: person('Omid'), ali: person('Ali'), rui: person('Rui') };
  holds(people.cyrus, 'p-ceo'); holds(people.tara, 'p-cto'); holds(people.lena, 'p-lead'); holds(people.dan, 'p-dev');
  holds(people.dora, 'p-dev', { to: '2025-12-31' }); holds(people.omid, 'p-ops'); holds(people.ali, 'p-rep'); holds(people.rui, 'p-lab');
  return { store, people };
}

const names = (list) => list.map((p) => p.name);

test('a person answers to the seat above theirs; a vacant seat is passed through; a head answers to the head above', () => {
  const { store, people } = firm();
  const c = new Chart(store, '2026-06-01');
  const p = (k) => c.people.get(people[k]);
  assert.equal(managerOf(c, p('dan')).name, 'Lena');                    // the seat his seat reports to
  assert.equal(managerOf(c, p('lena')).name, 'Tara');                   // the head of her department
  assert.equal(managerOf(c, p('tara')).name, 'Cyrus');                  // a head: the head above
  assert.equal(managerOf(c, p('ali')).name, 'Cyrus');                   // through the vacant head of sales
  assert.equal(managerOf(c, p('rui')).name, 'Tara');                    // a unit without a head: whoever leads above
  assert.equal(managerOf(c, p('cyrus')), null);
  assert.deepEqual(names(chainOf(c, p('dan'))), ['Lena', 'Tara', 'Cyrus']);
  assert.deepEqual(names(reportsOf(c, p('tara'))), ['Lena', 'Omid', 'Rui']);
  assert.deepEqual(names(reportsOf(c, p('tara'), true)).sort(), ['Dan', 'Lena', 'Omid', 'Rui']);
  assert.equal(c.saidBy(people.dan), 'chart');
  assert.equal(c.person(c.head('sales')).name, 'Cyrus');                // who leads Sales, in fact
});

test('every answer is as of a day: an assignment that ended is not a seat held', () => {
  const { store, people } = firm();
  const now = new Chart(store, '2026-06-01');
  const then = new Chart(store, '2025-06-01');
  assert.deepEqual(names(peersOf(now, now.people.get(people.dan))), []);
  assert.deepEqual(names(peersOf(then, then.people.get(people.dan))), ['Dora']);
  assert.equal(managerOf(now, now.people.get(people.dora)), null);
  assert.equal(managerOf(then, then.people.get(people.dora)).name, 'Lena');
});

test('a manager named by hand comes first, and nobody answers to themselves', () => {
  const { store, people } = firm();
  store.run('UPDATE people SET manager_id = ? WHERE id = ?', people.cyrus, people.omid);
  // Lena holds the team lead seat and - acting - the head seat of Tech: she answers upward, not to herself
  store.run('INSERT INTO assignments (id, person_id, position_id, is_primary, acting, valid_from, created_at, updated_at) VALUES (?, ?, ?, 0, 1, ?, ?, ?)', 'a-x', people.lena, 'p-cto', '2024-01-01', AT, AT);
  const c = new Chart(store, '2026-06-01');
  assert.equal(managerOf(c, c.people.get(people.omid)).name, 'Cyrus');
  assert.equal(c.saidBy(people.omid), 'hand');
  assert.equal(managerOf(c, c.people.get(people.lena)).name, 'Tara');
  store.run('UPDATE assignments SET valid_to = ? WHERE person_id = ? AND position_id = ?', '2025-01-01', people.tara, 'p-cto');
  const later = new Chart(store, '2026-06-01');
  assert.equal(managerOf(later, later.people.get(people.lena)).name, 'Cyrus');
});

test('a card, the claims and the tree say what the chart says', () => {
  const { store, people } = firm();
  const c = new Chart(store, '2026-06-01');
  const dan = card(c, c.people.get(people.dan));
  assert.equal(dan.position.title, 'Developer');
  assert.deepEqual(dan.department.path, ['Company', 'Tech']);
  assert.equal(dan.manager.name, 'Lena');
  assert.equal(dan.organisation.key, 'main');
  const said = claims(c, c.people.get(people.cyrus));
  assert.equal(said.is_head, true);
  assert.equal(said.department_path, 'Company');
  assert.equal(said.position_code, 'CEO');
  assert.deepEqual(said.heads, ['co']);
  const rows = tree(c);
  assert.deepEqual(rows.map((r) => r.id), ['co', 'sales', 'tech', 'lab']);
  assert.equal(rows.find((r) => r.id === 'sales').head, null);
  assert.equal(rows.find((r) => r.id === 'tech').positions[0].title, 'Chief technology officer');
  assert.deepEqual(rows.find((r) => r.id === 'lab').path, ['Company', 'Tech', 'Lab']);
});
