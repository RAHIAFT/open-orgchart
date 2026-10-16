// SPDX-License-Identifier: Apache-2.0
/**
 * THE ORGANISATION, AS A CHART.
 *
 * Held here:
 *  1. three charts of one organisation - the structure, the positions, the people - each a forest of nodes whose
 *     lines are the organisation's own (never worked out on the screen); a circle of lines is cut, not followed;
 *  2. where each card stands: a parent over the middle of what is under it, nothing overlapping, a team's last
 *     cards in a column, sideways as well as down, folded branches and the levels open;
 *  3. the reader's choices are checked and remembered; a card's colour says a branch, a level or a vacancy;
 *  4. the picture taken of it is one standalone SVG - no stylesheet, no outside file - with text cut to its card,
 *     reading the right way; a PDF is one page holding it; a picture too long for a canvas is made smaller;
 *  5. the screen: the charts are switched, a name is found and brought up, a card folds what is under it, the
 *     options redraw it, a card pressed opens its department, a department is dragged onto another, and both
 *     the picture and the data are taken out.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import OrgChartView from '../src/react/OrgChart.jsx';
import { pictureOf } from '../src/react/TakeOut.jsx';
import { makeT } from '../src/react/words.js';
import { chainOf, departmentNodes, findNodes, forest, initials, nodesOf, peopleNodes, positionNodes } from '../src/core/model.js';
import { SIZES, fitInto, layoutChart, leftOf, linkPath } from '../src/core/layout.js';
import { BRANCH, DEFAULTS, FILLED, LEVEL, PAPER, VACANT, accentOf, cleanOptions, keepOptions, legendOf, paperFor, readOptions, tint } from '../src/core/style.js';
import { chartSvg, fitText, readsRight, roughWidth } from '../src/core/svg.js';
import { MOST_PIXELS, fileName, pdfOf, scaleFor, sizeOf } from '../src/core/files.js';

const t = makeT('en');

// ── a small firm: the company over two units, one of them with a team inside it ─────────────────────────────────
const who = (id, name) => ({ id, name, email: `${name.toLowerCase()}@corp.example` });
const CEO = who(1, 'Cyrus');
const CTO = who(2, 'Tara');
const LENA = who(3, 'Lena');
const DAN = who(4, 'Dan');
const DORA = who(5, 'Dora');
const OMID = who(6, 'Omid');
const ALI = who(7, 'Ali');
const held = (person) => ({ assignment_id: `a-${person.id}`, person, primary: true, acting: false, valid_from: '2024-01-01', valid_to: null, current: true });
const seat = (id, title, holders = [], more = {}) => ({ id, title, code: '', is_head: false, active: true, reports_to: null, extra: {}, holders: holders.map(held), ...more });
const DEPARTMENTS = [
  { id: 'co', name: 'Company', parent: null, level: 0, is_active: true, head: CEO, people_count: 7, positions: [seat('p-ceo', 'Chief executive', [CEO], { is_head: true })] },
  { id: 'sales', name: 'Sales', parent: 'co', level: 1, is_active: true, head: null, people_count: 1,
    positions: [seat('p-sh', 'Head of sales', [], { is_head: true }), seat('p-rep', 'Sales representative', [ALI])] },
  { id: 'tech', name: 'Tech', parent: 'co', level: 1, is_active: true, head: CTO, people_count: 5,
    positions: [seat('p-cto', 'Chief technology officer', [CTO], { is_head: true }), seat('p-lead', 'Team lead', [LENA]),
      seat('p-dev', 'Developer', [DAN], { reports_to: 'p-lead' }), seat('p-dev2', 'Developer', [DORA], { reports_to: 'p-lead' }), seat('p-ops', 'Operations', [OMID])] },
  { id: 'lab', name: 'Lab', parent: 'tech', level: 2, is_active: false, head: null, people_count: 0, positions: [] },
];
/** The organisation's own answer for the lines (`/api/org/v1/reporting/`). */
const REPORTING = {
  as_of: '2026-10-10',
  people: [
    { ...CEO, position: 'Chief executive', department: 'Company', department_id: 'co', is_head: true, manager: null },
    { ...CTO, position: 'Chief technology officer', department: 'Tech', department_id: 'tech', is_head: true, manager: 1 },
    { ...LENA, position: 'Team lead', department: 'Tech', department_id: 'tech', is_head: false, manager: 2 },
    { ...DAN, position: 'Developer', department: 'Tech', department_id: 'tech', is_head: false, manager: 3 },
    { ...DORA, position: 'Developer', department: 'Tech', department_id: 'tech', is_head: false, manager: 3 },
    { ...OMID, position: 'Operations', department: 'Tech', department_id: 'tech', is_head: false, manager: 2 },
    { ...ALI, position: 'Sales representative', department: 'Sales', department_id: 'sales', is_head: false, manager: 1 },   // through the vacant head seat
  ],
  seats: [
    { id: 'p-ceo', title: 'Chief executive', code: 'CEO', department: 'Company', department_id: 'co', is_head: true, answers_to: null, holders: [CEO] },
    { id: 'p-sh', title: 'Head of sales', code: '', department: 'Sales', department_id: 'sales', is_head: true, answers_to: 'p-ceo', holders: [] },
    { id: 'p-rep', title: 'Sales representative', code: '', department: 'Sales', department_id: 'sales', is_head: false, answers_to: 'p-sh', holders: [ALI] },
    { id: 'p-cto', title: 'Chief technology officer', code: '', department: 'Tech', department_id: 'tech', is_head: true, answers_to: 'p-ceo', holders: [CTO] },
    { id: 'p-lead', title: 'Team lead', code: '', department: 'Tech', department_id: 'tech', is_head: false, answers_to: 'p-cto', holders: [LENA] },
    { id: 'p-dev', title: 'Developer', code: '', department: 'Tech', department_id: 'tech', is_head: false, answers_to: 'p-lead', holders: [DAN, DORA] },
    { id: 'p-ops', title: 'Operations', code: '', department: 'Tech', department_id: 'tech', is_head: false, answers_to: 'p-cto', holders: [OMID] },
  ],
};
const DATA = { departments: DEPARTMENTS, reporting: REPORTING };
const at = (layout, id) => layout.items.find((it) => it.id === id);
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('three charts of one organisation', () => {
  it('the structure: a card per department, with who leads it and what it holds', () => {
    const f = forest(departmentNodes(DEPARTMENTS));
    expect(f.roots).toEqual(['d:co']);
    const tech = f.byId.get('d:tech');
    expect([tech.parent, tech.title, tech.sub, tech.people, tech.seats, tech.vacantSeats, tech.level, tech.under]).toEqual(['d:co', 'Tech', 'Tara', 5, 5, 0, 1, 1]);
    const sales = f.byId.get('d:sales');
    expect([sales.vacant, sales.noHead, sales.face, sales.vacantSeats]).toEqual([true, false, null, 1]);     // a head seat nobody holds
    expect([f.byId.get('d:lab').noHead, f.byId.get('d:lab').inactive]).toEqual([true, true]);
    // a branch is what stands right under the one top card: Tech and what is under it are one, Sales another
    expect(f.branches).toEqual(['d:co', 'd:sales', 'd:tech']);
    expect([f.byId.get('d:lab').branch, f.byId.get('d:sales').branch, f.byId.get('d:co').branch]).toEqual(['d:tech', 'd:sales', 'd:co']);
  });

  it('the positions and the people take their lines from the organisation, never from the screen', () => {
    const seats = forest(positionNodes(REPORTING.seats));
    // the tree's own `reports_to` says nothing here: only `answers_to`, the server's answer, draws a line
    expect(seats.byId.get('s:p-rep').parent).toBe('s:p-sh');
    expect(seats.byId.get('s:p-dev').parent).toBe('s:p-lead');
    const dev = seats.byId.get('s:p-dev');
    expect([dev.sub, dev.more, dev.vacant, dev.place]).toEqual(['Dan', 1, false, 'Tech']);
    expect([seats.byId.get('s:p-sh').vacant, seats.byId.get('s:p-sh').face]).toEqual([true, null]);
    const people = forest(peopleNodes(REPORTING.people));
    expect(people.roots).toEqual(['p:1']);
    expect(chainOf(people.byId, 'p:4')).toEqual(['p:4', 'p:3', 'p:2', 'p:1']);
    expect([people.byId.get('p:1').people, people.byId.get('p:2').people, people.byId.get('p:3').people, people.byId.get('p:7').people]).toEqual([6, 4, 2, 0]);
    expect(nodesOf('people', DATA)).toHaveLength(7);
    expect(nodesOf('positions', DATA)).toHaveLength(7);
    expect(nodesOf('departments', DATA)).toHaveLength(4);
    expect(nodesOf('people', {})).toEqual([]);
  });

  it('a line to nowhere ends there, and a circle of lines is cut - a chart is always drawn', () => {
    const f = forest([{ id: 'a', parent: 'b' }, { id: 'b', parent: 'c' }, { id: 'c', parent: 'a' }, { id: 'x', parent: 'gone' }]);
    expect(f.roots.length).toBeGreaterThanOrEqual(2);
    expect(f.byId.get('x').parent).toBeNull();
    expect(f.nodes.every((n) => chainOf(f.byId, n.id).length <= 3)).toBe(true);
    expect(layoutChart(f).items).toHaveLength(4);
  });

  it('a name is found by what a card says, the closest first; a face with no picture is two letters', () => {
    const f = forest(peopleNodes(REPORTING.people));
    expect(findNodes(f.nodes, 'd').map((n) => n.title).slice(0, 2)).toEqual(['Dan', 'Dora']);
    expect(findNodes(f.nodes, 'developer').map((n) => n.title).sort()).toEqual(['Dan', 'Dora']);
    expect(findNodes(f.nodes, 'lena@corp')[0].title).toBe('Lena');
    expect(findNodes(f.nodes, '   ')).toEqual([]);
    expect([initials('Lena Lead'), initials('cyrus'), initials('')]).toEqual(['LL', 'C', '']);
    expect(initials('سارا احمدی')).toBe('س‌ا');                       // two letters of a joining script, kept apart
  });
});

describe('where each card stands', () => {
  const size = SIZES.comfortable;
  const people = forest(peopleNodes(REPORTING.people));

  it('a parent stands over the middle of what is under it, level by level, and nothing overlaps', () => {
    const drawn = layoutChart(people, { stack: false });
    expect(drawn.items).toHaveLength(7);
    for (const a of drawn.items) for (const b of drawn.items) if (a !== b) expect(overlap(a, b), `${a.id} over ${b.id}`).toBe(false);
    const ceo = at(drawn, 'p:1');
    expect(ceo.y).toBe(0);
    expect(at(drawn, 'p:2').y).toBe(size.h + size.gapY);
    expect(at(drawn, 'p:4').y).toBe(3 * (size.h + size.gapY));
    expect(ceo.x + size.w / 2).toBeCloseTo(drawn.width / 2, 5);
    const lena = at(drawn, 'p:3');
    expect(lena.x + size.w / 2).toBeCloseTo((at(drawn, 'p:4').x + at(drawn, 'p:5').x + size.w) / 2, 5);
    expect(drawn.links).toHaveLength(6);
    expect(drawn.height).toBe(4 * size.h + 3 * size.gapY);
  });

  it('a team’s last cards stand in a column under it, which keeps a wide team narrow', () => {
    const wide = forest([{ id: 'boss', parent: null }, ...Array.from({ length: 9 }, (_, i) => ({ id: `m${i}`, parent: 'boss' }))]);
    const row = layoutChart(wide, { stack: false });
    const column = layoutChart(wide, { stack: true });
    expect(row.width).toBe(9 * size.w + 8 * size.gapX);
    expect(column.width).toBeLessThan(2 * size.w);
    expect(column.items.filter((it) => it.stacked)).toHaveLength(9);
    expect(new Set(column.items.filter((it) => it.stacked).map((it) => it.x)).size).toBe(1);
    expect(column.links.every((l) => l.kind === 'stack')).toBe(true);
    for (const a of column.items) for (const b of column.items) if (a !== b) expect(overlap(a, b)).toBe(false);
    // two under a card stay side by side: a column is for a team
    const pair = layoutChart(forest([{ id: 'a', parent: null }, { id: 'b', parent: 'a' }, { id: 'c', parent: 'a' }]), { stack: true });
    expect(pair.items.some((it) => it.stacked)).toBe(false);
  });

  it('sideways, a level is a column; right to left, the chart is mirrored', () => {
    const drawn = layoutChart(people, { direction: 'side' });
    expect(drawn.direction).toBe('side');
    expect(at(drawn, 'p:1').x).toBe(0);
    expect(at(drawn, 'p:2').x).toBe(size.w + size.gapY);
    expect(at(drawn, 'p:4').x).toBe(3 * (size.w + size.gapY));
    for (const a of drawn.items) for (const b of drawn.items) if (a !== b) expect(overlap(a, b)).toBe(false);
    const ceo = at(drawn, 'p:1');
    expect(leftOf(ceo, drawn, false)).toBe(0);
    expect(leftOf(ceo, drawn, true)).toBe(drawn.width - size.w);
    const byItem = new Map(drawn.items.map((it) => [it.id, it]));
    const link = drawn.links.find((l) => l.to === 'p:2');
    expect(linkPath(link, byItem, drawn, false, 'elbow')).toMatch(/^M 224 [\d.]+ H /);
    expect(linkPath(link, byItem, drawn, true, 'elbow')).toMatch(new RegExp(`^M ${drawn.width - size.w} `));
    expect(linkPath(link, byItem, drawn, false, 'curved')).toContain(' C ');
    expect(linkPath(link, byItem, drawn, false, 'straight')).toContain(' L ');
    expect(linkPath({ from: 'nobody', to: 'p:2' }, byItem, drawn, false)).toBe('');
  });

  it('a folded card says how many are under it; the levels open are counted from the top', () => {
    const folded = layoutChart(people, { collapsed: new Set(['p:2']), stack: false });
    expect(folded.items.map((it) => it.id).sort()).toEqual(['p:1', 'p:2', 'p:7']);
    expect([at(folded, 'p:2').hidden, at(folded, 'p:1').hidden, at(folded, 'p:7').hidden]).toEqual([4, 0, 0]);
    const two = layoutChart(people, { depth: 2, stack: false });
    expect(two.items.map((it) => it.id).sort()).toEqual(['p:1', 'p:2', 'p:7']);
    // one of them opened by hand, past the levels asked for
    const opened = layoutChart(people, { depth: 2, collapsed: new Set(['open:p:2']), stack: false });
    expect(opened.items.map((it) => it.id).sort()).toEqual(['p:1', 'p:2', 'p:3', 'p:6', 'p:7']);
    expect(layoutChart(forest([])).items).toEqual([]);
  });

  it('the whole chart is fitted into a window, never larger than life', () => {
    const drawn = layoutChart(people, { stack: false });
    const small = fitInto(drawn, 400, 300, 20);
    expect(small.k).toBeLessThan(1);
    expect(drawn.width * small.k).toBeLessThanOrEqual(360.001);
    expect(fitInto(drawn, 5000, 4000, 20).k).toBe(1);
  });
});

describe('the reader’s choices', () => {
  beforeEach(() => { try { window.localStorage.removeItem('open-orgchart:options'); } catch { /* nothing kept */ } });

  it('are checked - what is not a choice answers how the chart comes - and remembered on the device', () => {
    expect(readOptions()).toEqual(DEFAULTS);
    expect(cleanOptions({ draws: 'salaries', direction: 'up', lines: 'wavy', colour: 'mood', density: 'huge', depth: 99, paper: 'gold', stack: 'yes', show: { face: 'no', code: true } }))
      .toEqual({ ...DEFAULTS, show: { ...DEFAULTS.show, code: true } });
    keepOptions({ ...DEFAULTS, draws: 'people', direction: 'side', lines: 'curved', depth: 3, show: { ...DEFAULTS.show, face: false } });
    const kept = readOptions();
    expect([kept.draws, kept.direction, kept.lines, kept.depth, kept.show.face]).toEqual(['people', 'side', 'curved', 3, false]);
  });

  it('a card’s colour says its branch, its level, or a vacancy', () => {
    const f = forest(departmentNodes(DEPARTMENTS));
    const of = (id, colour) => accentOf(f.byId.get(id), colour, f.branches);
    expect([of('d:co', 'branch'), of('d:sales', 'branch'), of('d:tech', 'branch'), of('d:lab', 'branch')]).toEqual([BRANCH[0], BRANCH[1], BRANCH[2], BRANCH[2]]);
    expect([of('d:co', 'level'), of('d:tech', 'level'), of('d:lab', 'level')]).toEqual([LEVEL[0], LEVEL[1], LEVEL[2]]);
    expect([of('d:sales', 'vacancy'), of('d:tech', 'vacancy')]).toEqual([VACANT, FILLED]);
    const seats = forest(positionNodes(REPORTING.seats));
    expect([accentOf(seats.byId.get('s:p-sh'), 'vacancy', []), accentOf(seats.byId.get('s:p-rep'), 'vacancy', [])]).toEqual([VACANT, FILLED]);
    expect(legendOf('branch', f).map((l) => l.label)).toEqual(['Company', 'Sales', 'Tech']);
    expect(legendOf('level', f).map((l) => l.vars.n)).toEqual([1, 2, 3]);
    expect(legendOf('vacancy', f)).toHaveLength(2);
    expect(legendOf('none', f)).toEqual([]);
    expect(tint('#2563eb', 0.5)).toBe('rgba(37,99,235,0.5)');
    expect([paperFor('screen', true).name, paperFor('screen', false).name, paperFor('light', true).name, paperFor('dark', false).name]).toEqual(['dark', 'light', 'light', 'dark']);
  });
});

describe('the picture taken of it', () => {
  const f = forest(departmentNodes(DEPARTMENTS));
  const drawn = layoutChart(f, { stack: false });
  const words = { vacant: 'Vacant', noHead: 'No head', vacantHead: 'Its head seat is vacant', people: 'People', vacantSeats: 'Vacant seats', reports: 'Answer to them' };
  const picture = (more = {}) => chartSvg(drawn, { paper: PAPER.light, options: DEFAULTS, branches: f.branches, words, title: 'Organisation chart', note: 'Structure · 2026-10-10', ...more });

  it('is one standalone SVG: every colour on the shape, no stylesheet, no outside file', () => {
    const svg = picture();
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).not.toMatch(/<style|class=|href=|url\(http|<image|<foreignObject/);
    const size = sizeOf(svg);
    expect(size.width).toBeGreaterThan(drawn.width);
    expect(size.height).toBeGreaterThan(drawn.height);
    expect((svg.match(/<path d="M /g) || []).length).toBe(drawn.links.length);
    for (const name of ['Company', 'Sales', 'Tech', 'Lab', 'Tara', 'Its head seat is vacant', 'No head', 'Organisation chart', 'Structure · 2026-10-10']) expect(svg, name).toContain(name);
    expect(svg).toContain(`fill="${BRANCH[2]}"`);                         // the accent of Tech's branch
    expect(svg).toContain('People: 5');
    expect(svg).toContain('Vacant seats: 1');
    // what the reader took off a card is not written
    const bare = picture({ options: { ...DEFAULTS, colour: 'none', show: { ...DEFAULTS.show, counts: false, sub: false } } });
    expect(bare).not.toContain('People: 5');
    expect(bare).not.toContain('Tara');
    expect(bare).not.toContain(`fill="${BRANCH[2]}"`);
    // the paper is the one asked for
    expect(picture({ paper: PAPER.dark })).toContain(`fill="${PAPER.dark.page}"`);
  });

  it('cuts a long name to its card, writes a name that reads from the right that way, and escapes what it writes', () => {
    expect(fitText('Short', 200, 14, true)).toBe('Short');
    const cut = fitText('The Department of Extraordinarily Long Names and Titles', 120, 14, true);
    expect(cut.endsWith('…')).toBe(true);
    expect(roughWidth(cut, 14, true)).toBeLessThanOrEqual(120);
    expect([readsRight('واحد فنی'), readsRight('Tech'), readsRight('12 - فنی'), readsRight('')]).toEqual([true, false, true, false]);
    const fa = forest(departmentNodes([{ id: 'x', name: 'واحد <فنی> & "ما"', parent: null, is_active: true, head: null, people_count: 0, positions: [] }]));
    const svg = chartSvg(layoutChart(fa), { paper: PAPER.light, options: DEFAULTS, branches: fa.branches, words, rtl: true });
    expect(svg).toContain('direction="rtl"');
    expect(svg).toContain('&lt;فنی&gt; &amp; &quot;ما&quot;');
    expect(svg).not.toContain('<فنی>');
  });

  it('a seat nobody holds is drawn as an empty one; a person’s face is their two letters', () => {
    const seats = forest(positionNodes(REPORTING.seats));
    const svg = chartSvg(layoutChart(seats, { stack: false }), { paper: PAPER.light, options: { ...DEFAULTS, draws: 'positions' }, branches: seats.branches, words });
    expect(svg).toContain('stroke-dasharray="5 4"');
    expect(svg).toContain('>Vacant<');
    expect(svg).toContain('Dan +1');
    expect(svg).toMatch(/text-anchor="middle">D<\/text>/);
  });

  it('a PDF is one page holding the picture; a picture too long for a canvas is made smaller; a file is named for what it is', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
    const bytes = pdfOf(jpeg, { width: 800, height: 600 }, { width: 600, height: 450 });
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/MediaBox [0 0 600 450]');
    expect(text).toContain('/Width 800 /Height 600');
    expect(text).toContain(`/Filter /DCTDecode /Length ${jpeg.length}`);
    // the table at the end says where each of the five objects begins, to the byte
    const xref = Number(/startxref\n(\d+)\n/.exec(text)[1]);
    expect(text.slice(xref, xref + 4)).toBe('xref');
    const offsets = [...text.slice(xref).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(5);
    offsets.forEach((offset, i) => expect(new TextDecoder('latin1').decode(bytes.slice(offset, offset + 7))).toBe(`${i + 1} 0 obj`));
    expect(scaleFor({ width: 1000, height: 800 }, 2)).toBe(2);
    expect(scaleFor({ width: 30000, height: 800 }, 2) * 30000).toBeLessThanOrEqual(MOST_PIXELS);
    expect(fileName('departments', 'png', new Date(2026, 9, 10))).toBe('organisation-departments-2026-10-10.png');
    expect(sizeOf('<svg xmlns="x" width="120" height="80">')).toEqual({ width: 120, height: 80 });
  });
});

// ── the screen ────────────────────────────────────────────────────────────────────────────────────────────────

const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));
const cards = () => [...document.querySelectorAll('[data-card]')].map((el) => el.getAttribute('data-card')).sort();

describe('the chart on the screen', () => {
  let notices;
  let loadReporting;
  let exportData;
  beforeEach(() => {
    notices = [];
    try { window.localStorage.removeItem('open-orgchart:options'); } catch { /* nothing kept */ }
    loadReporting = vi.fn(() => Promise.resolve(REPORTING));
    exportData = vi.fn(() => Promise.resolve(new Blob(['x'])));
  });
  afterEach(() => cleanup());
  const draw = async (props = {}) => {
    const view = render(<OrgChartView departments={DEPARTMENTS} loadReporting={loadReporting} exportData={exportData} onNotice={(n) => notices.push(n)} {...props} />);
    await flush();
    return view;
  };

  it('draws the structure, and the positions and the people when asked - their lines the organisation’s own', async () => {
    await draw();
    expect(screen.getByTestId('org-chart')).toHaveAttribute('data-draws', 'departments');
    expect(cards()).toEqual(['d:co', 'd:lab', 'd:sales', 'd:tech']);
    expect(document.querySelectorAll('[data-testid="org-chart-line"]')).toHaveLength(3);
    expect(loadReporting).not.toHaveBeenCalled();                      // the structure needs no question
    expect(screen.getByTestId('org-chart-card-d:sales')).toHaveAttribute('data-vacant', 'yes');
    expect(screen.getByTestId('org-chart-count')).toHaveTextContent('4 departments · 3 levels');
    fireEvent.click(screen.getByTestId('org-chart-draws-people'));
    await flush();
    expect(loadReporting).toHaveBeenCalledTimes(1);
    expect(cards()).toEqual(['p:1', 'p:2', 'p:3', 'p:4', 'p:5', 'p:6', 'p:7']);
    expect(screen.getByTestId('org-chart-count')).toHaveTextContent('7 people · 4 levels');
    fireEvent.click(screen.getByTestId('org-chart-draws-positions'));
    await flush();
    expect(cards()).toContain('s:p-sh');
    expect(screen.getByTestId('org-chart-card-s:p-sh')).toHaveAttribute('data-vacant', 'yes');
    expect(JSON.parse(window.localStorage.getItem('open-orgchart:options')).draws).toBe('positions');      // remembered
  });

  it('a card folds what is under it, and a name is found and brought up', async () => {
    await draw({ reporting: REPORTING });
    fireEvent.click(screen.getByTestId('org-chart-draws-people'));
    await flush();
    fireEvent.click(screen.getByTestId('org-chart-fold-p:2'));
    expect(cards()).toEqual(['p:1', 'p:2', 'p:7']);
    expect(screen.getByTestId('org-chart-fold-p:2')).toHaveTextContent('+4');
    // Dan is folded away under Tara: found, he is opened to and marked
    fireEvent.change(screen.getByTestId('org-chart-search'), { target: { value: 'dan' } });
    expect(screen.getAllByTestId('org-chart-hit')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('org-chart-hit'));
    await flush();
    expect(cards()).toContain('p:4');
    expect(screen.getByTestId('org-chart-search')).toHaveValue('');
    fireEvent.change(screen.getByTestId('org-chart-search'), { target: { value: 'nobody at all' } });
    expect(screen.getByTestId('org-chart-hits')).toHaveTextContent('Nothing on the chart is called that.');
  });

  it('the reader’s choices redraw it at once: sideways, fewer levels, what a card says', async () => {
    await draw();
    fireEvent.click(screen.getByTestId('org-chart-options'));
    fireEvent.click(screen.getByTestId('org-chart-direction-side'));
    expect(screen.getByTestId('org-chart')).toHaveAttribute('data-direction', 'side');
    fireEvent.click(screen.getByTestId('org-chart-depth-2'));
    expect(cards()).toEqual(['d:co', 'd:sales', 'd:tech']);
    expect(screen.getByTestId('org-chart-fold-d:tech')).toHaveTextContent('+1');
    fireEvent.click(screen.getByTestId('org-chart-open-all'));
    expect(cards()).toContain('d:lab');
    expect(screen.getByTestId('org-chart-card-d:tech')).toHaveTextContent('Tara');
    fireEvent.click(screen.getByTestId('org-chart-show-sub'));
    expect(screen.getByTestId('org-chart-card-d:tech')).not.toHaveTextContent('Tara');
    fireEvent.click(screen.getByTestId('org-chart-colour-none'));
    expect(screen.queryByTestId('org-chart-legend')).toBeNull();
    fireEvent.click(screen.getByTestId('org-chart-reset'));
    expect(screen.getByTestId('org-chart')).toHaveAttribute('data-direction', 'down');
    expect(screen.getByTestId('org-chart-legend')).toHaveTextContent('Sales');
    // the panel closes when something outside it is pressed
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId('org-chart-options-panel')).toBeNull();
  });

  it('it zooms by the buttons and the keys, and shows the whole chart in one press', async () => {
    await draw();
    const zoom = () => Number(screen.getByTestId('org-chart-sheet').getAttribute('data-zoom'));
    const before = zoom();
    fireEvent.click(screen.getByTestId('org-chart-larger'));
    expect(zoom()).toBeGreaterThan(before);
    fireEvent.keyDown(screen.getByTestId('org-chart-stage'), { key: '-' });
    fireEvent.keyDown(screen.getByTestId('org-chart-stage'), { key: '-' });
    expect(zoom()).toBeLessThan(before);
    fireEvent.click(screen.getByTestId('org-chart-zoom'));
    expect(zoom()).toBe(100);
    fireEvent.click(screen.getByTestId('org-chart-fit'));
    expect(zoom()).toBeLessThanOrEqual(100);
  });

  it('a card pressed opens its department; a department dragged onto another is moved there, never under itself', async () => {
    const onSelect = vi.fn();
    const onMove = vi.fn();
    await draw({ onSelect, onMove, selectedId: 'tech' });
    expect(screen.getByTestId('org-chart-card-d:tech')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('org-chart-card-d:sales'));
    expect(onSelect).toHaveBeenCalledWith('sales');
    const data = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(screen.getByTestId('org-chart-card-d:lab'), { dataTransfer: data });
    fireEvent.dragOver(screen.getByTestId('org-chart-card-d:sales'), { dataTransfer: data });
    fireEvent.drop(screen.getByTestId('org-chart-card-d:sales'), { dataTransfer: data });
    expect(onMove).toHaveBeenCalledWith('lab', 'sales');
    // under itself, or under what is under it: not a place it can go
    fireEvent.dragStart(screen.getByTestId('org-chart-card-d:tech'), { dataTransfer: data });
    fireEvent.drop(screen.getByTestId('org-chart-card-d:lab'), { dataTransfer: data });
    fireEvent.dragStart(screen.getByTestId('org-chart-card-d:lab'), { dataTransfer: data });
    fireEvent.drop(screen.getByTestId('org-chart-card-d:tech'), { dataTransfer: data });        // where it already is
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it('the data is taken out by the organisation itself; the picture is the chart as it is drawn now', async () => {
    const saved = [];
    const make = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => { saved.push(blob); return 'blob:x'; });
    const drop = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    try {
      await draw();
      fireEvent.click(screen.getByTestId('org-chart-export'));
      expect(screen.getByTestId('org-chart-export-menu')).toHaveTextContent('PNG');
      fireEvent.click(screen.getByTestId('org-chart-export-xlsx'));
      await waitFor(() => expect(exportData).toHaveBeenCalledWith('xlsx'));
      await waitFor(() => expect(saved).toHaveLength(1));
      fireEvent.click(screen.getByTestId('org-chart-export'));
      fireEvent.click(screen.getByTestId('org-chart-export-svg'));
      await waitFor(() => expect(saved).toHaveLength(2));
      expect(saved[1].type).toContain('image/svg+xml');
      expect(notices).toEqual([]);
    } finally { make.mockRestore(); drop.mockRestore(); }
    // ...and it is what is on the screen: folded, in the reader's words
    const f = forest(departmentNodes(DEPARTMENTS));
    const svg = pictureOf({ layout: layoutChart(f, { collapsed: new Set(['d:tech']) }), forest: f, options: DEFAULTS, rtl: false, dark: false, t });
    expect(svg).toContain('>+1<');
    expect(svg).not.toContain('>Lab<');
    expect(svg).toContain('Organisation chart');
  });

  it('with nobody in a seat the people chart says so, instead of an empty sheet', async () => {
    await draw({ reporting: { people: [], seats: [] } });
    fireEvent.click(screen.getByTestId('org-chart-draws-people'));
    await flush();
    expect(screen.getByTestId('org-chart-empty')).toHaveTextContent('Nobody holds a seat yet');
  });
});

// ── on its own: the tree as the service answers it, other languages, a page's own choices ─────────────────────

describe('on its own', () => {
  afterEach(() => cleanup());

  it('counts the people of a department the tree does not count for it: each holder once, here and below', () => {
    const tree = [
      { id: 'co', name: 'Company', parent: null, head: CEO, positions: [{ id: 'p-ceo', title: 'Chief executive', is_head: true, holders: [CEO] }] },
      { id: 'tech', name: 'Tech', parent: 'co', head: CTO,
        positions: [{ id: 'p-cto', title: 'CTO', is_head: true, holders: [CTO] }, { id: 'p-dev', title: 'Developer', holders: [DAN, DORA, CEO] }] },
      { id: 'lab', name: 'Lab', parent: 'tech', head: null, positions: [{ id: 'p-lab', title: 'Researcher', holders: [DAN] }] },
    ];
    const f = forest(departmentNodes(tree));
    expect([f.byId.get('d:co').people, f.byId.get('d:tech').people, f.byId.get('d:lab').people]).toEqual([4, 4, 1]);
    // a count the tree gives is taken as given
    expect(forest(departmentNodes([{ ...tree[0], people_count: 40 }])).byId.get('d:co').people).toBe(40);
  });

  it('reads in Persian, right to left, with its own digits', async () => {
    render(<OrgChartView departments={DEPARTMENTS} language="fa" storageKey={null} />);
    await flush();
    expect(screen.getByTestId('org-chart')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByTestId('org-chart-draws-departments')).toHaveTextContent('ساختار');
    expect(screen.getByTestId('org-chart-count')).toHaveTextContent('۴');
  });

  it('a page brings its own words, its own faces and its first choices; and keeps nothing when asked not to', async () => {
    window.localStorage.removeItem('open-orgchart:options');
    render(<OrgChartView departments={DEPARTMENTS} reporting={REPORTING} storageKey={null} words={{ Structure: 'Units' }}
                         defaultOptions={{ draws: 'people' }} renderFace={(face) => <i data-testid="own-face">{face.name}</i>} />);
    await flush();
    expect(screen.getByTestId('org-chart')).toHaveAttribute('data-draws', 'people');
    expect(screen.getAllByTestId('own-face').map((el) => el.textContent)).toContain('Lena');
    expect(screen.getByTestId('org-chart-draws-departments')).toHaveTextContent('Units');
    fireEvent.click(screen.getByTestId('org-chart-draws-positions'));
    expect(window.localStorage.getItem('open-orgchart:options')).toBeNull();
  });

  it('offers the structure as data only when it is handed a way to make it', async () => {
    render(<OrgChartView departments={DEPARTMENTS} storageKey={null} />);
    await flush();
    fireEvent.click(screen.getByTestId('org-chart-export'));
    expect(screen.getByTestId('org-chart-export-menu')).toHaveTextContent('PNG');
    expect(screen.queryByTestId('org-chart-export-csv')).toBeNull();
    cleanup();
    render(<OrgChartView departments={DEPARTMENTS} storageKey={null} exportData={() => 'a,b'} tableFormats={['csv', 'json']} />);
    await flush();
    fireEvent.click(screen.getByTestId('org-chart-export'));
    expect(screen.getByTestId('org-chart-export-csv')).toBeInTheDocument();
    expect(screen.queryByTestId('org-chart-export-xlsx')).toBeNull();
  });
});
