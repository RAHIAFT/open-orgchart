# @open-orgchart/server

The service: an organisation's structure, who holds which seat, and who answers to whom, as of any day. Other
applications get it by the person's sign-in token or by a key, and are told only what is shared with them.

It needs only Node.js 22.13 or newer, with no dependencies, and keeps everything in one SQLite file.

From the repository's root (not on npm yet):

```sh
npm ci && npm run build
npm run demo                                      # the example organisation on http://localhost:8080
npm start                                         # an empty one
node packages/server/src/cli.js key ops           # a new keeper key (shown once)
```

To use it in your own Node.js program:

```js
import { createService } from './packages/server/src/server.js';
import { loadConfig } from './packages/server/src/config.js';

const service = createService(loadConfig());
await service.listen();
```

The settings, the sign-in setup and the security notes are in the [main README](../../README.md); the API is in
[docs/api.md](../../docs/api.md).

Apache License 2.0. Copyright 2026 Rahiaft.
