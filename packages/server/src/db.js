// SPDX-License-Identifier: Apache-2.0
/**
 * The organisation's database: one SQLite file (Node's own `node:sqlite` - nothing to install). Every question is
 * a prepared statement with its values bound, never text joined into SQL.
 *
 * The tables:
 *   organisations   whose chart it is - one service can keep several (a holding and its companies)
 *   departments     the tree; a department belongs to the organisation of its root
 *   positions       a seat in a department; one head seat per department; `reports_to` when it answers elsewhere
 *   people          who the organisation knows: a name, an address, who they are to the sign-in service (`sub`),
 *                   their number, and - only where the chart cannot say it - who they answer to
 *   assignments     a person holding a seat, from a day until a day (primary, acting)
 *   fields          the organisation's own fields of departments, positions, assignments, people
 *   clients         applications and systems that may ask; shares: what each may be told
 *   access_log      every question a client asked, against the share that answered it
 *   keepers         the keys of the people who keep the organisation (only their hashes)
 *   changes         every change, who made it, before and after
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { now } from './util.js';

const SCHEMA = [
  // 1 - the first tables
  `
  CREATE TABLE organisations (
    id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, names TEXT NOT NULL DEFAULT '{}',
    domains TEXT NOT NULL DEFAULT '[]', is_default INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE departments (
    id TEXT PRIMARY KEY, organisation_id TEXT REFERENCES organisations(id) ON DELETE SET NULL,
    parent_id TEXT REFERENCES departments(id) ON DELETE RESTRICT, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, extra TEXT NOT NULL DEFAULT '{}',
    external_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE INDEX departments_parent ON departments(parent_id);
  CREATE INDEX departments_external ON departments(external_id);
  CREATE TABLE people (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL DEFAULT '', email TEXT, sub TEXT,
    active INTEGER NOT NULL DEFAULT 1, organisation_id TEXT REFERENCES organisations(id) ON DELETE SET NULL,
    code TEXT NOT NULL DEFAULT '', manager_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
    extra TEXT NOT NULL DEFAULT '{}', external_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE UNIQUE INDEX people_email ON people(email COLLATE NOCASE) WHERE email IS NOT NULL;
  CREATE UNIQUE INDEX people_sub ON people(sub) WHERE sub IS NOT NULL;
  CREATE INDEX people_code ON people(code);
  CREATE TABLE positions (
    id TEXT PRIMARY KEY, department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    title TEXT NOT NULL, code TEXT NOT NULL DEFAULT '', is_head INTEGER NOT NULL DEFAULT 0,
    reports_to TEXT REFERENCES positions(id) ON DELETE SET NULL, active INTEGER NOT NULL DEFAULT 1,
    extra TEXT NOT NULL DEFAULT '{}', external_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE INDEX positions_department ON positions(department_id, is_head);
  CREATE TABLE assignments (
    id TEXT PRIMARY KEY, person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    position_id TEXT NOT NULL REFERENCES positions(id) ON DELETE CASCADE, is_primary INTEGER NOT NULL DEFAULT 0,
    acting INTEGER NOT NULL DEFAULT 0, valid_from TEXT NOT NULL, valid_to TEXT, extra TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE INDEX assignments_person ON assignments(person_id, valid_to);
  CREATE INDEX assignments_position ON assignments(position_id, valid_to);
  CREATE TABLE fields (
    id TEXT PRIMARY KEY, organisation_id TEXT REFERENCES organisations(id) ON DELETE CASCADE, target TEXT NOT NULL,
    key TEXT NOT NULL, label TEXT NOT NULL DEFAULT '{}', help TEXT NOT NULL DEFAULT '{}', kind TEXT NOT NULL DEFAULT 'text',
    options TEXT NOT NULL DEFAULT '[]', required INTEGER NOT NULL DEFAULT 0, shareable INTEGER NOT NULL DEFAULT 0,
    in_claims INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE UNIQUE INDEX fields_key ON fields(COALESCE(organisation_id, ''), target, key);
  CREATE TABLE clients (
    id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE, name TEXT NOT NULL,
    client_id TEXT NOT NULL DEFAULT '', key_hash TEXT NOT NULL DEFAULT '', key_hint TEXT NOT NULL DEFAULT '',
    contact TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
    created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_seen_at TEXT);
  CREATE INDEX clients_client_id ON clients(client_id);
  CREATE INDEX clients_key ON clients(key_hash);
  CREATE TABLE shares (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    department_id TEXT REFERENCES departments(id) ON DELETE CASCADE, depth TEXT NOT NULL DEFAULT 'structure',
    fields TEXT NOT NULL DEFAULT '[]', purpose TEXT NOT NULL DEFAULT '', valid_from TEXT, valid_to TEXT,
    active INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE INDEX shares_client ON shares(client_id);
  CREATE TABLE access_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT NOT NULL, share_id TEXT, subject TEXT NOT NULL DEFAULT '',
    what TEXT NOT NULL, about TEXT NOT NULL DEFAULT '', answered INTEGER NOT NULL DEFAULT 1, at TEXT NOT NULL);
  CREATE INDEX access_log_client ON access_log(client_id, at);
  CREATE TABLE keepers (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, key_hint TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, last_seen_at TEXT);
  CREATE TABLE changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, kind TEXT NOT NULL,
    object_id TEXT NOT NULL DEFAULT '', label TEXT NOT NULL DEFAULT '', before TEXT, after TEXT);
  `,
];

export class Store {
  /** `file`: the database's path, or ':memory:'. */
  constructor(file) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    if (file !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    this.statements = new Map();
    /** Moved by every change made here; with SQLite's own `data_version` (moved by changes made elsewhere) it says when the chart must be read again. */
    this.generation = 0;
    this.migrate();
  }

  migrate() {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
    const row = this.db.prepare('SELECT version FROM schema_version').get();
    let at = row ? Number(row.version) : 0;
    if (!row) this.db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
    while (at < SCHEMA.length) {
      this.tx(() => {
        this.db.exec(SCHEMA[at]);
        this.db.prepare('UPDATE schema_version SET version = ?').run(at + 1);
      });
      at += 1;
    }
  }

  prepared(sql) {
    let found = this.statements.get(sql);
    if (!found) {
      found = this.db.prepare(sql);
      this.statements.set(sql, found);
    }
    return found;
  }

  all(sql, ...params) { return this.prepared(sql).all(...params.map(bindable)); }
  get(sql, ...params) { return this.prepared(sql).get(...params.map(bindable)); }

  run(sql, ...params) {
    const out = this.prepared(sql).run(...params.map(bindable));
    this.generation += 1;
    return out;
  }

  /** `fn` in one transaction: all of it, or none of it. */
  tx(fn) {
    if (this.inTx) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    this.inTx = true;
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    } finally {
      this.inTx = false;
      this.generation += 1;
    }
  }

  /** What says the chart changed since it was read: changes made here, and changes made by another process. */
  stamp() {
    const version = this.db.prepare('PRAGMA data_version').get();
    return `${this.generation}:${version ? Object.values(version)[0] : 0}`;
  }

  /** A change, written down: who, what, before and after. */
  record(actor, action, kind, objectId, label, before = null, after = null) {
    this.prepared('INSERT INTO changes (at, actor, action, kind, object_id, label, before, after) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(now(), String(actor || ''), action, kind, String(objectId ?? ''), String(label ?? '').slice(0, 200),
        before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after));
  }

  close() { this.db.close(); }
}

/** SQLite binds numbers, strings, null and bytes: a yes/no is 1/0, nothing given is NULL. */
function bindable(value) {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}
