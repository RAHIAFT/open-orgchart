// SPDX-License-Identifier: Apache-2.0
/**
 * @open-orgchart/chart - an organisation chart for React: the structure, the positions and the people of one
 * organisation; moved, zoomed, folded, searched, styled, and taken out as PNG, SVG or PDF.
 *
 *   import OrgChart from '@open-orgchart/chart';
 *   import '@open-orgchart/chart/style.css';
 *
 * The drawing itself, without React: '@open-orgchart/chart/core'.
 */
export { default, default as OrgChart } from './react/OrgChart.jsx';
export { pictureOf } from './react/TakeOut.jsx';
export { LANGUAGES, directionOf, makeT, numberText } from './react/words.js';
export * from './core/index.js';
