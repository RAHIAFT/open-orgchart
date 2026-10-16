// SPDX-License-Identifier: Apache-2.0
/**
 * The service over HTTP: who may ask and what each is told (keepers, the organisation's own people by their
 * sign-in, applications by the person's token, systems by key - each only what its shares cover), what the people
 * who keep it may change and what they may not, and what every answer wears.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { Store } from '../src/db.js';
import { demoRows } from '../src/demo.js';
import { createService, firstKeeper } from '../src/server.js';

const quiet = () => {};
let service;
let base;
let keeper;
let oidc;
let oidcUrl;
/** token -> the claims the sign-in service vouches for */
const vouched = new Map();

const tokenFor = (claims, payload) => {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = `${enc({ alg: 'RS256' })}.${enc(payload)}.signature-${Math.random().toString(36).slice(2)}`;
  vouched.set(token, claims);
  return token;
};

async function ask(path, { key = keeper, token = null, method = 'GET', body = undefined, type = 'application/json', headers = {} } = {}) {
  const h = { ...headers };
  if (key) h['X-Org-Key'] = key;
  if (token) h.Authorization = `Bearer ${token}`;
  if (body !== undefined) h['Content-Type'] = type;
  const r = await fetch(`${base}${path}`, { method, headers: h, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: r.status, json, text, headers: r.headers };
}

before(async () => {
  oidc = http.createServer((req, res) => {
    const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
    const claims = vouched.get(token);
    res.writeHead(claims ? 200 : 401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(claims || { error: 'invalid_token' }));
  });
  await new Promise((r) => oidc.listen(0, '127.0.0.1', r));
  oidcUrl = `http://127.0.0.1:${oidc.address().port}/userinfo`;
  const config = { ...loadConfig({}), db: ':memory:', port: 0, host: '127.0.0.1', rate: 1000, burst: 1000, bodyLimit: 4096, cors: ['https://app.example'],
    oidc: { issuer: '', userinfo: oidcUrl, memberClients: ['org-viewer'], keeperGroup: 'org-keepers' } };
  service = createService(config, { log: quiet, store: new Store(':memory:'), publicDir: null });
  keeper = firstKeeper(service.store, config, quiet);
  const at = await service.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${at.port}`;
  const told = await ask('/api/org/pillar/import', { method: 'POST', body: { rows: demoRows() } });
  assert.equal(told.status, 200, told.text);
});

after(async () => {
  await service.close();
  await new Promise((r) => oidc.close(r));
});

const person = async (email) => (await ask(`/api/org/pillar/people?q=${encodeURIComponent(email)}`)).json.people[0];
const dept = async (name) => (await ask('/api/org/pillar/departments')).json.departments.find((d) => d.name === name);

describe('who may ask', () => {
  test('nobody without a key or a token; a key that opens nothing is refused', async () => {
    const none = await ask('/api/org/v1/tree', { key: null });
    assert.equal(none.status, 401);
    assert.equal(none.json.code, 'unauthenticated');
    assert.equal((await ask('/api/org/v1/tree', { key: 'ook_nothing-at-all' })).status, 401);
    assert.equal((await ask('/healthz', { key: null })).json.ok, true);
  });

  test('every answer wears its armour, and no other site may ask from a browser unless named', async () => {
    const r = await ask('/api/org/v1/');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
    assert.equal(r.headers.get('x-powered-by'), null);
    const named = await ask('/api/org/v1/tree', { key: null, method: 'OPTIONS', headers: { Origin: 'https://app.example', 'Access-Control-Request-Method': 'GET' } });
    assert.equal(named.status, 204);
    assert.equal(named.headers.get('access-control-allow-origin'), 'https://app.example');
    assert.match(named.headers.get('access-control-allow-headers'), /X-Org-Key/);
    const other = await ask('/api/org/v1/tree', { key: null, method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
    assert.equal(other.status, 403);
    assert.equal(other.headers.get('access-control-allow-origin'), null);
  });

  test('a body is JSON, and no larger than its limit', async () => {
    const wrong = await ask('/api/org/pillar/departments', { method: 'POST', body: 'name=x', type: 'application/x-www-form-urlencoded' });
    assert.equal(wrong.status, 415);
    const big = await ask('/api/org/pillar/departments', { method: 'POST', body: { name: 'x'.repeat(5000) } });
    assert.equal(big.status, 413);
    const broken = await ask('/api/org/pillar/departments', { method: 'POST', body: '{"name":' });
    assert.equal(broken.status, 400);
  });
});

describe('the contract, for the people who keep it', () => {
  test('the tree, the lines and a person - each answered by the one rule', async () => {
    const index = await ask('/api/org/v1');
    assert.equal(index.json.service, 'organisation');
    assert.equal(index.json.version, '1');
    assert.equal(index.json.you.kind, 'keeper');
    const tree = await ask('/api/org/v1/tree/');
    assert.equal(tree.json.departments.length, 10);
    const sales = tree.json.departments.find((d) => d.name === 'Sales');
    assert.deepEqual(sales.path, ['Example Co.', 'Operations', 'Sales']);
    assert.equal(sales.head, null);
    const lines = await ask('/api/org/v1/reporting');
    const chloe = lines.json.people.find((p) => p.email === 'chloe@example.com');
    const lucas = lines.json.people.find((p) => p.email === 'lucas@example.com');
    assert.equal(chloe.manager, lucas.id);                                     // through the vacant head of sales
    const elena = await ask('/api/org/v1/people/elena@example.com/manager');
    assert.equal(elena.json.manager.name, 'Omid Rahimi');
    const chain = await ask('/api/org/v1/people/elena@example.com/chain');
    assert.deepEqual(chain.json.chain.map((p) => p.name), ['Omid Rahimi', 'Sara Ahmadi', 'Maya Lindqvist']);
    const peers = await ask('/api/org/v1/people/elena@example.com/peers');
    assert.deepEqual(peers.json.peers.map((p) => p.name), ['Priya Nair', 'Tom Becker']);
    const reports = await ask('/api/org/v1/people/sara@example.com/reports?deep=1');
    assert.equal(reports.json.reports.length, 6);
    const data = await dept('Data');
    const led = await ask(`/api/org/v1/departments/${data.id}`);
    assert.equal(led.json.leads.name, 'Sara Ahmadi');                       // its head seat vacant: whoever leads above
    assert.equal((await ask('/api/org/v1/people/nobody@example.com')).status, 404);
    assert.equal((await ask('/api/org/v1/tree?as_of=2026-02-30')).status, 400);
    assert.equal((await ask('/api/org/v1/tree?as_of=2023-01-01')).json.departments[0].positions[0].holders.length, 0);
  });

  test('a department never goes under itself; a seat never answers to itself; a department has one head seat', async () => {
    const tech = await dept('Technology');
    const platform = await dept('Platform');
    const moved = await ask(`/api/org/pillar/departments/${tech.id}`, { method: 'PATCH', body: { parent: platform.id } });
    assert.equal(moved.status, 400);
    const a = await ask('/api/org/pillar/positions', { method: 'POST', body: { department: platform.id, title: 'A' } });
    const b = await ask('/api/org/pillar/positions', { method: 'POST', body: { department: platform.id, title: 'B', reports_to: a.json.id } });
    assert.equal(b.status, 201);
    const circle = await ask(`/api/org/pillar/positions/${a.json.id}`, { method: 'PATCH', body: { reports_to: b.json.id } });
    assert.equal(circle.status, 400);
    const head = await ask('/api/org/pillar/positions', { method: 'POST', body: { department: platform.id, title: 'Second head', is_head: true } });
    assert.equal(head.status, 409);
    for (const id of [b.json.id, a.json.id]) assert.equal((await ask(`/api/org/pillar/positions/${id}`, { method: 'DELETE' })).status, 204);
    const notEmpty = await ask(`/api/org/pillar/departments/${tech.id}`, { method: 'DELETE' });
    assert.equal(notEmpty.status, 409);
  });

  test('a manager named by hand, and never one that closes a circle', async () => {
    const kai = await person('kai@example.com');
    const maya = await person('maya@example.com');
    const sara = await person('sara@example.com');
    assert.equal((await ask(`/api/org/pillar/people/${kai.id}`, { method: 'PATCH', body: { manager: 'maya@example.com' } })).status, 200);
    const card = await ask('/api/org/v1/people/kai@example.com');
    assert.equal(card.json.manager.name, 'Maya Lindqvist');
    assert.equal((await ask(`/api/org/pillar/people/${kai.id}`)).json.manager_said_by, 'hand');
    const circle = await ask(`/api/org/pillar/people/${maya.id}`, { method: 'PATCH', body: { manager: kai.id } });
    assert.equal(circle.status, 400);
    assert.equal((await ask(`/api/org/pillar/people/${sara.id}`, { method: 'PATCH', body: { manager: sara.id } })).status, 400);
    await ask(`/api/org/pillar/people/${kai.id}`, { method: 'PATCH', body: { manager: null } });
  });

  test('every change is written down', async () => {
    const r = await ask('/api/org/pillar/changes?since=0&limit=1000');
    assert.ok(r.json.changes.some((c) => c.action === 'import'));
    assert.ok(r.json.changes.some((c) => c.kind === 'person' && c.action === 'update' && c.by.startsWith('key:')));
  });
});

describe('applications and systems: only what is shared', () => {
  let system;
  let systemKey;

  test('a system with no share is told nothing, and its question is written down', async () => {
    const made = await ask('/api/org/pillar/clients', { method: 'POST', body: { name: 'Payroll', key: true } });
    assert.equal(made.status, 201);
    system = made.json.client;
    systemKey = made.json.key;
    assert.match(systemKey, /^ooc_/);
    assert.equal(made.json.client.key_hint, systemKey.slice(-4));
    const refused = await ask('/api/org/v1/tree', { key: systemKey });
    assert.equal(refused.status, 403);
    assert.equal(refused.json.code, 'no_share');
    const log = await ask(`/api/org/pillar/access?client=${system.id}`);
    assert.equal(log.json.access[0].answered, false);
  });

  test('the structure only: departments and seats, no names', async () => {
    const tech = await dept('Technology');
    const share = await ask('/api/org/pillar/shares', { method: 'POST', body: { client: system.id, department: tech.id, depth: 'structure', purpose: 'cost centres' } });
    assert.equal(share.status, 201);
    const tree = await ask('/api/org/v1/tree', { key: systemKey });
    assert.deepEqual(tree.json.departments.map((d) => d.name).sort(), ['Data', 'Design', 'Platform', 'Technology']);
    assert.ok(tree.json.departments.every((d) => d.head === undefined && d.positions.every((p) => p.holders === undefined) && d.depth === 'structure'));
    assert.equal((await ask('/api/org/v1/people/elena@example.com', { key: systemKey })).status, 403);
    const lines = await ask('/api/org/v1/reporting', { key: systemKey });
    assert.equal(lines.json.people.length, 0);
    assert.ok(lines.json.seats.length > 0 && lines.json.seats.every((s) => s.holders === undefined));
    await ask(`/api/org/pillar/shares/${share.json.id}`, { method: 'PATCH', body: { depth: 'holders' } });
    const holders = await ask('/api/org/v1/tree', { key: systemKey });
    const platform = holders.json.departments.find((d) => d.name === 'Platform');
    assert.equal(platform.head.name, 'Omid Rahimi');
    assert.equal(platform.head.email, undefined);                         // who, but not how to reach them
    const elena = await ask('/api/org/v1/people/elena@example.com', { key: systemKey });
    assert.equal(elena.status, 200);
    assert.equal(elena.json.email, undefined);
    assert.equal((await ask('/api/org/v1/claims/elena@example.com', { key: systemKey })).status, 403);
    assert.equal((await ask('/api/org/v1/people/maya@example.com', { key: systemKey })).status, 403);   // outside Technology
  });

  test("the organisation's own fields: only those marked tellable, and only those a share names", async () => {
    const grade = await ask('/api/org/pillar/fields', { method: 'POST', body: { target: 'person', key: 'grade', label: 'Grade', kind: 'choice', options: ['A', 'B'], shareable: true, in_claims: true } });
    assert.equal(grade.status, 201);
    const salary = await ask('/api/org/pillar/fields', { method: 'POST', body: { target: 'person', key: 'salary', label: 'Salary', kind: 'number' } });
    assert.equal(salary.status, 201);
    const elena = await person('elena@example.com');
    assert.equal((await ask(`/api/org/pillar/people/${elena.id}`, { method: 'PATCH', body: { extra: { grade: 'C' } } })).status, 400);
    assert.equal((await ask(`/api/org/pillar/people/${elena.id}`, { method: 'PATCH', body: { extra: { grade: 'A', salary: '5000' } } })).status, 200);
    assert.deepEqual((await ask('/api/org/v1/people/elena@example.com')).json.extra, { grade: 'A', salary: 5000 });   // a keeper sees all
    const share = (await ask(`/api/org/pillar/shares?client=${system.id}`)).json.shares[0];
    const refused = await ask(`/api/org/pillar/shares/${share.id}`, { method: 'PATCH', body: { fields: ['salary'] } });
    assert.equal(refused.status, 400);                                           // not marked tellable: never shared
    assert.deepEqual((await ask('/api/org/v1/people/elena@example.com', { key: systemKey })).json.extra, {});
    await ask(`/api/org/pillar/shares/${share.id}`, { method: 'PATCH', body: { fields: ['grade'], depth: 'contact' } });
    const told = await ask('/api/org/v1/people/elena@example.com', { key: systemKey });
    assert.deepEqual(told.json.extra, { grade: 'A' });
    assert.equal(told.json.email, 'elena@example.com');
    const claims = await ask('/api/org/v1/claims/elena@example.com', { key: systemKey });
    assert.deepEqual(claims.json.fields, { grade: 'A' });
    assert.equal(claims.json.department, 'Platform');
  });

  test('a new key: the old one opens nothing from then on', async () => {
    const renewed = await ask(`/api/org/pillar/clients/${system.id}/key`, { method: 'POST', body: {} });
    assert.equal(renewed.status, 200);
    assert.equal((await ask('/api/org/v1/tree', { key: systemKey })).status, 401);
    assert.equal((await ask('/api/org/v1/tree', { key: renewed.json.key })).status, 200);
    assert.equal((await ask('/api/org/pillar/departments', { key: renewed.json.key })).status, 403);   // an application never keeps the organisation
  });
});

describe('signed in through the sign-in service', () => {
  test("the organisation's own people: the whole chart, and their own card", async () => {
    const token = tokenFor({ sub: 'sub-elena', email: 'elena@example.com' }, { azp: 'org-viewer', aud: 'org-viewer' });
    const me = await ask('/api/org/v1/me', { key: null, token });
    assert.equal(me.status, 200, me.text);
    assert.equal(me.json.name, 'Elena Petrova');
    assert.equal(me.json.manager.name, 'Omid Rahimi');
    assert.deepEqual(me.json.extra, { grade: 'A' });                           // only fields marked tellable
    const mine = await ask('/api/org/v1/me/chain', { key: null, token });
    assert.equal(mine.json.chain.length, 3);
    assert.equal((await ask('/api/org/v1/tree', { key: null, token })).json.departments.length, 10);
    assert.equal((await ask('/api/org/pillar/departments', { key: null, token })).status, 403);
    const keeperToken = tokenFor({ sub: 'sub-maya', email: 'maya@example.com', groups: ['org-keepers'] }, { azp: 'org-viewer' });
    assert.equal((await ask('/api/org/pillar/departments', { key: null, token: keeperToken })).status, 200);
  });

  test('an application by the person’s token: only if it is registered, and only what it is shared - but always their own card', async () => {
    const stranger = tokenFor({ sub: 'sub-tom', email: 'tom@example.com' }, { azp: 'crm' });
    const unknown = await ask('/api/org/v1/me', { key: null, token: stranger });
    assert.equal(unknown.status, 403);
    assert.equal(unknown.json.code, 'unknown_client');
    const crm = await ask('/api/org/pillar/clients', { method: 'POST', body: { name: 'CRM', client_id: 'crm' } });
    const people = await dept('People');
    await ask('/api/org/pillar/shares', { method: 'POST', body: { client: crm.json.client.id, department: people.id, depth: 'holders' } });
    const tom = await ask('/api/org/v1/me', { key: null, token: stranger });
    assert.equal(tom.status, 200, tom.text);
    assert.equal(tom.json.name, 'Tom Becker');
    assert.equal(tom.json.email, 'tom@example.com');                            // one's own card, with one's own address
    assert.equal(tom.json.manager.email, undefined);                            // who one answers to, not how to reach them
    assert.equal((await ask('/api/org/v1/people/aiko@example.com', { key: null, token: stranger })).status, 200);
    assert.equal((await ask('/api/org/v1/people/elena@example.com', { key: null, token: stranger })).status, 403);
    const log = await ask(`/api/org/pillar/access?client=${crm.json.client.id}`);
    assert.ok(log.json.access.some((a) => a.subject === 'tom@example.com' || a.subject === 'sub-tom'));
  });

  test('a token the sign-in service does not vouch for is refused', async () => {
    const forged = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ azp: 'org-viewer' })).toString('base64url')}.forged-signature-xyz`;
    const r = await ask('/api/org/v1/me', { key: null, token: forged });
    assert.equal(r.status, 401);
  });
});

describe('in and out', () => {
  test('an import with a row that cannot be read changes nothing', async () => {
    const before = (await ask('/api/org/pillar/departments')).json.departments.length;
    const csv = 'department,position,email,name,valid_from\nNew Unit,Lead,new@example.com,New Person,2026-01-01\nNew Unit,Member,not-an-address,Someone,2026-01-01\n';
    const r = await ask('/api/org/pillar/import', { method: 'POST', body: csv, type: 'text/csv' });
    assert.equal(r.status, 400);
    assert.equal(r.json.errors[0].row, 3);
    assert.equal((await ask('/api/org/pillar/departments')).json.departments.length, before);
    const dry = await ask('/api/org/pillar/import?dry=1', { method: 'POST', body: csv.split('\n').slice(0, 2).join('\n'), type: 'text/csv' });
    assert.equal(dry.json.dry, true);
    assert.equal(dry.json.departments, 1);
    assert.equal((await ask('/api/org/pillar/departments')).json.departments.length, before);
  });

  test('the export reads back in, and a spreadsheet never takes a name for a formula', async () => {
    const platform = await dept('Platform');
    const evil = await ask('/api/org/pillar/positions', { method: 'POST', body: { department: platform.id, title: '=HYPERLINK("http://x")' } });
    const csv = await ask('/api/org/pillar/export?format=csv');
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-disposition'), /attachment; filename="organisation-\d{4}-\d{2}-\d{2}\.csv"/);
    assert.match(csv.text, /"'=HYPERLINK\(""http:\/\/x""\)"/);
    assert.match(csv.text, /Example Co\. \/ Technology \/ Platform,Software engineer,TEC-11,no,elena@example.com/);
    await ask(`/api/org/pillar/positions/${evil.json.id}`, { method: 'DELETE' });
    const json = await ask('/api/org/pillar/export?format=json');
    assert.equal(json.json.format, 'open-orgchart');
    assert.ok(json.json.people.length >= 20);
    assert.equal((await ask('/api/org/pillar/export?format=xml')).status, 400);
  });

  test('the last keeper key stays', async () => {
    const list = (await ask('/api/org/pillar/keepers')).json.keepers;
    assert.equal(list.length, 1);
    assert.equal((await ask(`/api/org/pillar/keepers/${list[0].id}`, { method: 'DELETE' })).status, 409);
    const second = await ask('/api/org/pillar/keepers', { method: 'POST', body: { name: 'ops' } });
    assert.match(second.json.key, /^ook_/);
    assert.equal((await ask(`/api/org/pillar/keepers/${second.json.keeper.id}`, { method: 'DELETE', key: second.json.key })).status, 204);
    assert.equal((await ask('/api/org/v1', { key: second.json.key })).status, 401);
  });
});
