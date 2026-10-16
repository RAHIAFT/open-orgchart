// SPDX-License-Identifier: Apache-2.0
// Builds dist/: the chart for React (index.js), the drawing without React (core.js) and the stylesheet.
import { build } from 'esbuild';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const at = (rel) => fileURLToPath(new URL(rel, import.meta.url));
fs.rmSync(at('dist'), { recursive: true, force: true });
fs.mkdirSync(at('dist'), { recursive: true });

const common = { bundle: true, format: 'esm', target: 'es2020', jsx: 'automatic', legalComments: 'none', sourcemap: true, logLevel: 'info' };
await build({ ...common, entryPoints: [at('src/index.js')], outfile: at('dist/index.js'), external: ['react', 'react-dom', 'react/jsx-runtime'] });
await build({ ...common, entryPoints: [at('src/core/index.js')], outfile: at('dist/core.js') });
fs.copyFileSync(at('src/style.css'), at('dist/style.css'));
for (const name of ['LICENSE', 'NOTICE']) fs.copyFileSync(at(`../../${name}`), at(name));
