#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 *   open-orgchart serve          start the service (the default)
 *   open-orgchart key <name>     make a keeper key (shown once)
 *   open-orgchart demo           fill an empty database with an example organisation, then start the service
 *   open-orgchart help
 *
 * Its settings come from the environment (src/config.js): ORG_PORT, ORG_DATA, ORG_OIDC_ISSUER, ...
 */
import { loadConfig } from './config.js';
import { demoRows } from './demo.js';
import { importRows, makeKeeperKey } from './keepers.js';
import { Asker } from './auth.js';
import { createService, firstKeeper, logger } from './server.js';
import { Store } from './db.js';
import { VERSION } from './version.js';

const HELP = `open-orgchart ${VERSION} - an organisation chart that runs on its own

  open-orgchart serve          start the service (the default)
  open-orgchart key <name>     make a keeper key (shown once)
  open-orgchart demo           fill an empty database with an example organisation, then start the service
  open-orgchart help

Settings come from the environment: ORG_PORT (8080), ORG_DATA (./data), ORG_TZ, ORG_CORS_ORIGINS,
ORG_OIDC_ISSUER, ORG_OIDC_MEMBER_CLIENTS, ORG_OIDC_KEEPER_GROUP, ORG_KEEPER_KEY ... (see the README).
`;

async function serve(config, log, { demo = false } = {}) {
  const service = createService(config, { log });
  const key = firstKeeper(service.store, config, log);
  if (demo) {
    const empty = !service.store.get('SELECT id FROM departments LIMIT 1');
    if (empty) {
      const told = importRows({ store: service.store, config, who: new Asker('keeper', { keeper: { name: 'demo' } }), query: new URLSearchParams() }, demoRows());
      log('info', `The example organisation is in: ${told.departments} departments, ${told.positions} positions, ${told.people} people.`);
    }
    if (key) process.stdout.write(`\n  A keeper key for trying it (also in ${config.data}): ${key}\n\n`);
  }
  const at = await service.listen();
  log('info', `open-orgchart ${VERSION} listens on http://${at.address === '0.0.0.0' || at.address === '::' ? 'localhost' : at.address}:${at.port}`);
  const stop = (signal) => {
    log('info', `${signal}: stopping`);
    service.close().then(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}

async function main(argv) {
  const [command = 'serve', ...rest] = argv;
  const config = loadConfig();
  const log = logger();
  if (command === 'help' || command === '--help' || command === '-h') { process.stdout.write(HELP); return; }
  if (command === '--version' || command === 'version') { process.stdout.write(`${VERSION}\n`); return; }
  if (command === 'serve') return serve(config, log);
  if (command === 'demo') return serve(config, log, { demo: true });
  if (command === 'key') {
    const store = new Store(config.db);
    const { key } = makeKeeperKey(store, rest.join(' ') || 'keeper', 'cli');
    store.close();
    process.stdout.write(`${key}\n`);
    process.stderr.write('A new keeper key: shown this once. Only its hash is kept.\n');
    return;
  }
  process.stderr.write(`Not a command: ${command}\n\n${HELP}`);
  process.exitCode = 2;
}

main(process.argv.slice(2)).catch((err) => {
  process.stderr.write(`${err && err.message ? err.message : err}\n`);
  process.exit(1);
});
