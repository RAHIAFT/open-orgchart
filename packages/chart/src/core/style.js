// SPDX-License-Identifier: Apache-2.0
/**
 * HOW THE CHART LOOKS, AND WHAT IT SHOWS.
 *
 * The reader's choices for the chart — kept on the device (`open-orgchart:options` unless told otherwise), one object:
 *
 *   draws      departments | positions | people        (model.js)
 *   direction  down | side                              (layout.js)
 *   stack      a team's leaves in a column under it, going down
 *   lines      elbow | curved | straight
 *   colour     none | branch | level | vacancy          what a card's accent says
 *   density    comfortable | compact
 *   depth      0 (all) | 1..6                           how many levels are open to begin with
 *   show       {face, sub, counts, vacant, code, place}  what is written on a card
 *   minimap    the small picture of the whole chart
 *   paper      screen | light | dark                    how a picture taken of it is coloured
 *
 * Colours are plain hex, the same on the screen and in a picture taken of the chart, so what is exported is what
 * was seen. Two papers: light and dark.
 *
 * PURE MODULE. No React.
 */
import { DRAWS } from './model.js';
import { DIRECTIONS } from './layout.js';

export const LINES = ['elbow', 'curved', 'straight'];
export const COLOURS = ['none', 'branch', 'level', 'vacancy'];
export const DENSITIES = ['comfortable', 'compact'];
export const PAPERS = ['screen', 'light', 'dark'];
export const SHOWS = ['face', 'sub', 'counts', 'vacant', 'code', 'place'];
export const DEPTHS = [0, 1, 2, 3, 4, 5, 6];

export const DEFAULTS = {
  draws: 'departments', direction: 'down', stack: true, lines: 'elbow', colour: 'branch', density: 'comfortable', depth: 0,
  show: { face: true, sub: true, counts: true, vacant: true, code: false, place: true }, minimap: true, paper: 'screen',
};

export const OPTIONS_KEY = 'open-orgchart:options';

/** Choices as kept, each checked against what it may be: an unknown value answers the default. */
export function cleanOptions(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const one = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
  const show = { ...DEFAULTS.show };
  if (r.show && typeof r.show === 'object') for (const k of SHOWS) if (typeof r.show[k] === 'boolean') show[k] = r.show[k];
  return {
    draws: one(r.draws, DRAWS, DEFAULTS.draws), direction: one(r.direction, DIRECTIONS, DEFAULTS.direction),
    stack: typeof r.stack === 'boolean' ? r.stack : DEFAULTS.stack, lines: one(r.lines, LINES, DEFAULTS.lines),
    colour: one(r.colour, COLOURS, DEFAULTS.colour), density: one(r.density, DENSITIES, DEFAULTS.density),
    depth: one(Number(r.depth), DEPTHS, DEFAULTS.depth), show,
    minimap: typeof r.minimap === 'boolean' ? r.minimap : DEFAULTS.minimap, paper: one(r.paper, PAPERS, DEFAULTS.paper),
  };
}

export function readOptions(key = OPTIONS_KEY) {
  if (!key) return cleanOptions(null);
  try { return cleanOptions(JSON.parse(window.localStorage.getItem(key) || 'null')); } catch { return cleanOptions(null); }
}

export function keepOptions(options, key = OPTIONS_KEY) {
  if (!key) return;
  try { window.localStorage.setItem(key, JSON.stringify(cleanOptions(options))); } catch { /* kept while the page is open */ }
}

// ── the two papers ────────────────────────────────────────────────────────────────────────────────────────────

export const PAPER = {
  light: {
    name: 'light', page: '#f6f7f9', dot: '#dde1e8', card: '#ffffff', border: '#dfe3ea', text: '#111827', quiet: '#667085', line: '#c3cad6',
    strong: '#2563eb', chip: '#f1f3f7', vacant: '#b45309', vacantFill: '#fff7ed', shadow: 'rgba(16,24,40,0.10)', face: '#e5e9f0',
  },
  dark: {
    name: 'dark', page: '#0f131a', dot: '#232a37', card: '#181d27', border: '#2a3140', text: '#f3f4f6', quiet: '#9aa4b2', line: '#3a4354',
    strong: '#60a5fa', chip: '#222938', vacant: '#fbbf24', vacantFill: '#2a2313', shadow: 'rgba(0,0,0,0.45)', face: '#2a3140',
  },
};

/** The paper a picture is taken on: the one asked for, or the screen's own. */
export function paperFor(choice, screenIsDark) {
  if (choice === 'light' || choice === 'dark') return PAPER[choice];
  return screenIsDark ? PAPER.dark : PAPER.light;
}

export function screenIsDark() {
  try { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); } catch { return false; }
}

// ── what a card's accent says ─────────────────────────────────────────────────────────────────────────────────

/** Ten colours a branch is told by; they repeat past ten. */
export const BRANCH = ['#2563eb', '#7c3aed', '#059669', '#d97706', '#e11d48', '#0891b2', '#ea580c', '#0d9488', '#4f46e5', '#65a30d'];
/** A level's colour: the top the deepest, lightening on the way down. */
export const LEVEL = ['#1d4ed8', '#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe'];
export const FILLED = '#059669';
export const VACANT = '#d97706';
export const PLAIN = '#94a3b8';

/**
 * The accent of one card. `branches` is the list of top-level ids in their order (what a branch's colour is
 * counted from): a branch keeps its colour whatever is folded.
 */
export function accentOf(node, colour, branches) {
  if (colour === 'branch') {
    const at = Math.max(0, (branches || []).indexOf(node.branch));
    return BRANCH[at % BRANCH.length];
  }
  if (colour === 'level') return LEVEL[Math.min(LEVEL.length - 1, Math.max(0, node.level || 0))];
  if (colour === 'vacancy') {
    if (node.kind === 'person') return FILLED;
    if (node.kind === 'position') return node.vacant ? VACANT : FILLED;
    return node.vacant || node.noHead || node.vacantSeats ? VACANT : FILLED;
  }
  return PLAIN;
}

/** `#rrggbb` with an alpha, as rgba() - a tint of the accent a card's face sits on. */
export function tint(hex, alpha) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${alpha})`;
}

/** What a legend says for the colours in use: [{colour, label, vars}] (labels are `t()` keys). */
export function legendOf(colour, forest) {
  if (colour === 'vacancy') return [{ colour: FILLED, label: 'Filled' }, { colour: VACANT, label: 'Has a vacant seat' }];
  if (colour === 'level') {
    const deepest = Math.max(0, ...((forest && forest.nodes) || []).map((n) => n.level || 0));
    return LEVEL.slice(0, Math.min(LEVEL.length, deepest + 1)).map((c, i) => ({ colour: c, label: 'Level {n}', vars: { n: i + 1 } }));
  }
  if (colour === 'branch') {
    const branches = (forest && forest.branches) || [];
    return branches.slice(0, BRANCH.length).map((id, i) => ({ colour: BRANCH[i % BRANCH.length], label: forest.byId.get(id).title, plain: true }));
  }
  return [];
}
