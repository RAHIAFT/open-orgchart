// SPDX-License-Identifier: Apache-2.0
/**
 * The service, stood up: the database opened (and brought to the newest tables), an organisation to keep, a first
 * keeper key when there is none, and the HTTP server with its time limits.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { Store } from './db.js';
import { ensureOrganisation, makeKeeperKey } from './keepers.js';

export const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

/** One line of the log, as JSON: when, how bad, what. */
export function logger(out = process.stdout) {
  return (level, message) => out.write(`${JSON.stringify({ at: new Date().toISOString(), level, message })}\n`);
}

/**
 * The first keeper key, when there is none: the one given (ORG_KEEPER_KEY), or a new one written to a file only its
 * owner may read - never to the log.
 */
export function firstKeeper(store, config, log) {
  if (store.get('SELECT id FROM keepers WHERE active = 1 LIMIT 1')) return null;
  if (config.keeperKey) {
    if (config.keeperKey.length < 32) throw new Error('ORG_KEEPER_KEY is at least 32 characters long.');
    makeKeeperKey(store, 'first keeper', 'setup', config.keeperKey);
    log('info', 'The first keeper key is the one given in ORG_KEEPER_KEY.');
    return null;
  }
  const { key } = makeKeeperKey(store, 'first keeper', 'setup');
  if (config.db === ':memory:') return key;
  const file = path.join(path.dirname(config.db), 'first-keeper-key.txt');
  fs.writeFileSync(file, `${key}\n`, { mode: 0o600 });
  log('info', `A first keeper key was made and written to ${file} (only its owner may read it). Keep it somewhere safe, then remove the file.`);
  return key;
}

export function createService(config, { log = logger(), publicDir = PUBLIC_DIR, store: given = null } = {}) {
  const store = given || new Store(config.db);
  ensureOrganisation(store);
  const handle = createApp({ store, config, log, publicDir });
  const server = http.createServer({ requestTimeout: 60000, headersTimeout: 20000, keepAliveTimeout: 5000, maxHeaderSize: 16384 }, handle);
  server.maxHeadersCount = 100;
  return {
    store,
    server,
    listen: (port = config.port, host = config.host) => new Promise((resolve) => server.listen(port, host, () => resolve(server.address()))),
    close: () => new Promise((resolve) => { server.close(() => { try { store.close(); } catch { /* closed already */ } resolve(); }); server.closeAllConnections?.(); }),
  };
}
