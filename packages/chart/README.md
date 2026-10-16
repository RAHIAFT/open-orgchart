# @open-orgchart/chart

An organisation chart for React. One organisation, three charts:

* **Structure**: a card per department, under the one it belongs to, with who leads it and how many people it holds.
* **Positions**: a card per seat with who holds it, under the seat it answers to. Vacant seats are drawn as empty.
* **People**: a card per person, under their manager.

Readers move the chart by dragging or with the wheel, and zoom it with the buttons, the keys (`+`, `-`, `0`, `1`) or a
pinch. **Fit** shows the whole chart. A card folds what is under it, the search finds a name and brings it into view,
and hovering a card lights its branch up to the top. Readers choose how it runs (top to bottom or sideways), how its
lines bend, what its colours say (branch, level, vacancies), what a card shows and how many levels are open; those
choices are remembered on the device. The chart exports as **PNG, SVG or PDF**, made in the browser with nothing sent
anywhere, and the SVG is fully self-contained. It reads right to left as well as left to right, and ships in English and Persian.

## Install

Not on npm yet. Build it from the repository (`npm ci && npm run build` at its root) and use `packages/chart/dist`,
or bring `packages/chart` into your own workspace. It needs `react` and `react-dom` (18 or newer).

## Use

```jsx
import OrgChart from '@open-orgchart/chart';
import '@open-orgchart/chart/style.css';

export function Chart({ tree, reporting }) {
  return (
    <div style={{ height: 640 }}>
      <OrgChart departments={tree.departments} reporting={reporting} onSelect={(id) => console.log('department', id)} />
    </div>
  );
}
```

The chart fills its box, so give that box a height.

### The data

`departments` is a flat list, with parents tied by `parent`. It has the same shape as the `departments` that
[`GET /api/org/v1/tree`](../../docs/api.md#the-tree) answers:

```js
[
  { id: 'co', name: 'Company', parent: null, head: { id: 1, name: 'Cyrus', email: 'cyrus@example.com' },
    positions: [{ id: 'p-ceo', title: 'Chief executive', is_head: true, holders: [{ id: 1, name: 'Cyrus' }] }] },
  { id: 'tech', name: 'Tech', parent: 'co', head: null,
    positions: [{ id: 'p-cto', title: 'Chief technology officer', is_head: true, holders: [] }] },
]
```

`people_count` on a department is used when given; otherwise the chart counts everyone holding a seat in it or under it.

The charts of positions and of people draw the organisation's own lines (who answers to whom): `reporting`, as
[`GET /api/org/v1/reporting`](../../docs/api.md#reporting) answers it (`{people, seats}`). Pass it directly, or pass
`loadReporting`, a function that returns it (or a promise of it). That function is called the first time one of
those charts is drawn. The chart never works out who is under whom by itself.

### Props

| Prop | What it is |
| --- | --- |
| `departments` | The tree (above). |
| `reporting`, `loadReporting` | The lines of the positions and people charts (above). |
| `language` | `'en'` (default), `'fa'`, or any other language when you pass its `words`. |
| `dir` | `'ltr'` or `'rtl'`; follows the language unless given. |
| `words` | Words to add or replace: `{ 'Structure': 'Units', ... }`. The key is the English the chart says. |
| `theme` | `'auto'` (default; follows the device), `'light'` or `'dark'`. |
| `storageKey` | Where the reader's choices are kept (`localStorage`); `null` keeps nothing. Default `open-orgchart:options`. |
| `defaultOptions` | The choices it starts with, e.g. `{ draws: 'people', direction: 'side', colour: 'level' }`. |
| `selectedId`, `onSelect(departmentId)` | The department picked; a card pressed picks its department. |
| `onMove(departmentId, newParentId)` | Lets readers drag a department onto another. Your page asks and makes the change. |
| `exportData(kind)`, `tableFormats` | Offers the structure as data too (`'xlsx'`, `'csv'`, `'json'`). Return a `Blob`, a string or an object. |
| `renderFace(face, size, accent)` | Your own picture of a person, instead of their initials. |
| `onNotice({ kind, text })` | Called when something could not be done (a picture, a file, the lines). |
| `title` | The exported picture's title. |

### The look

Every class begins with `ooc`. The colours of the tools are CSS variables on `.ooc` (`--ooc-primary`, `--ooc-border`,
`--ooc-surface`, `--ooc-popover`, `--ooc-text`, `--ooc-muted`, ...), so a page can match its own design. The cards, lines and
paper take their colours from the chart itself, so an exported picture looks exactly like the screen.

### Without React

The drawing is plain functions: what the chart draws, where each card stands, how it looks, and the SVG/PNG/PDF made from it.

```js
import { forest, departmentNodes, layoutChart, chartSvg, PAPER, DEFAULTS } from '@open-orgchart/chart/core';

const f = forest(departmentNodes(tree.departments));
const layout = layoutChart(f, { direction: 'down' });
const svg = chartSvg(layout, { paper: PAPER.light, options: DEFAULTS, branches: f.branches, title: 'Our organisation' });
```

This works in any framework, in a worker, or on a server (to send a chart by e-mail, say).

## Licence

Apache License 2.0. Copyright 2026 Rahiaft.
