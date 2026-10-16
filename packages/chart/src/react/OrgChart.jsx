// SPDX-License-Identifier: Apache-2.0
/**
 * THE ORGANISATION, AS A CHART.
 *
 * One canvas, three charts (model.js): the structure, the positions with who holds them, the people and who they
 * answer to. It is moved by dragging and by the wheel, zoomed by the buttons, the keys and a pinch, fitted to the
 * window in one press; a card folds what is under it; a name is found and brought to the middle; a branch lights
 * up to the top under the pointer. What a card says, how the chart runs, what its colours mean and how its lines
 * bend are the reader's choices (Options.jsx), remembered on the device. It is taken out as a picture (PNG, SVG,
 * PDF) and, when handed `exportData`, as data (TakeOut.jsx).
 *
 * A department is dragged onto another to move it there, when the chart is handed `onMove` (the structure only;
 * the page that holds the chart asks first and makes the change).
 *
 * Who is under whom is never worked out here: the structure is the tree's own, and the lines of positions and of
 * people are the organisation's answer (`reporting`, `GET /api/org/v1/reporting`).
 */
import React from 'react';
import { DRAWS, chainOf, findNodes, forest as forestOf, nodesOf } from '../core/model.js';
import { SIZES, fitInto, layoutChart, leftOf, linkPath } from '../core/layout.js';
import { accentOf, cleanOptions, keepOptions, legendOf, OPTIONS_KEY, paperFor, readOptions, screenIsDark } from '../core/style.js';
import Card from './Card.jsx';
import Options from './Options.jsx';
import TakeOut from './TakeOut.jsx';
import { ChartWords } from './context.js';
import { directionOf, makeT, numberText } from './words.js';
import { Close, Fit, FullScreen, Minus, Plus, Search, Spinner } from './icons.jsx';

const ZOOM_MIN = 0.15;
const ZOOM_MAX = 2;
/** The smallest size a chart is opened at by itself: below it a card cannot be read. */
const READABLE = 0.62;
const DRAW_WORDS = { departments: 'Structure', positions: 'Positions', people: 'People' };
const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
const MAP = { w: 176, h: 116 };
const NO_LINES = { people: [], seats: [] };

/** Dark or light: as asked, or as the device prefers (followed while the page is open). */
function useDark(theme) {
  const [auto, setAuto] = React.useState(screenIsDark);
  React.useEffect(() => {
    if (theme !== 'auto' || typeof window === 'undefined' || !window.matchMedia) return undefined;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const follow = () => setAuto(query.matches);
    query.addEventListener?.('change', follow);
    return () => query.removeEventListener?.('change', follow);
  }, [theme]);
  return theme === 'dark' ? true : theme === 'light' ? false : auto;
}

/**
 * <OrgChart departments reporting? loadReporting? ... />
 *
 *   departments     the tree: [{id, name, parent, positions: [{id, title, code, is_head, holders: [{id, name, email}]}],
 *                   head, people_count?}] - what `GET /api/org/v1/tree` answers as `departments`
 *   reporting       the lines: {people, seats} - what `GET /api/org/v1/reporting` answers; or `loadReporting()`, a
 *                   function that gets it, asked the first time a chart of positions or of people is drawn
 *   language, dir   the reader's language ('en', 'fa', ...) and its direction (from the language unless given);
 *                   `words` adds or replaces words ({English: said})
 *   theme           'auto' (the device's), 'light' or 'dark'
 *   storageKey      where the reader's choices are kept on the device (null: not kept); `defaultOptions` to begin
 *   selectedId, onSelect(departmentId), onMove(departmentId, newParentId), onNotice({kind, text})
 *   exportData(kind) -> Blob | string | object, and `tableFormats`: the structure taken out as data
 *   renderFace(face, size, accent) -> a picture of a person, instead of their two letters
 *   title           the picture's title
 */
export default function OrgChart({
  departments, reporting: given, loadReporting, selectedId, onSelect, onMove, onNotice,
  language = 'en', dir: dirGiven, words, theme = 'auto', storageKey = OPTIONS_KEY, defaultOptions,
  exportData, tableFormats, renderFace, title, className = '', style,
}) {
  const t = React.useMemo(() => makeT(language, words), [language, words]);
  const num = React.useCallback((n) => numberText(n, language), [language]);
  const said = React.useMemo(() => ({ t, language, num }), [t, language, num]);
  const dir = dirGiven || directionOf(language);
  const rtl = dir === 'rtl';
  const [options, setOptionsOnly] = React.useState(() => {
    const kept = readOptions(storageKey);
    return storageKey && typeof window !== 'undefined' && window.localStorage?.getItem(storageKey) ? kept : cleanOptions({ ...kept, ...(defaultOptions || {}) });
  });
  const setOptions = React.useCallback((patch) => setOptionsOnly((was) => {
    const next = { ...was, ...(typeof patch === 'function' ? patch(was) : patch) };
    keepOptions(next, storageKey);
    return next;
  }), [storageKey]);
  const dark = useDark(theme);
  const paper = paperFor('screen', dark);

  // ── the organisation's lines (positions, people): asked when one of those charts is drawn, again when the chart changed
  const [reporting, setReporting] = React.useState(given || null);
  const [asking, setAsking] = React.useState(false);
  const needsLines = options.draws !== 'departments';
  const loader = React.useRef(loadReporting);
  loader.current = loadReporting;
  React.useEffect(() => {
    if (given) { setReporting(given); return undefined; }
    if (!needsLines || !loader.current) return undefined;
    let live = true;
    setAsking(true);
    Promise.resolve().then(() => loader.current()).then((got) => { if (live) setReporting(got || NO_LINES); },
      () => { if (live) { setReporting(NO_LINES); onNotice?.({ kind: 'error', text: t('The lines of the chart could not be read.') }); } })
      .finally(() => { if (live) setAsking(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsLines, departments, given]);

  // ── what is drawn, and where
  const [folds, setFolds] = React.useState(() => new Set());
  const forest = React.useMemo(() => forestOf(nodesOf(options.draws, { departments, reporting })), [options.draws, departments, reporting]);
  const layout = React.useMemo(() => layoutChart(forest, {
    direction: options.direction, stack: options.stack, card: SIZES[options.density] || SIZES.comfortable, collapsed: folds, depth: options.depth,
  }), [forest, options.direction, options.stack, options.density, options.depth, folds]);
  const byItem = React.useMemo(() => new Map(layout.items.map((it) => [it.id, it])), [layout]);
  const side = layout.direction === 'side';
  // another chart, another set of folds
  React.useEffect(() => { setFolds(new Set()); }, [options.draws, options.depth]);

  // ── the window onto it
  const wrap = React.useRef(null);
  const stage = React.useRef(null);
  const tools = React.useRef(null);
  /** Where the chart's top may stand: under the tools, with a little air. */
  const under = () => Math.max(64, ((tools.current && tools.current.offsetHeight) || 40) + 28);
  const [box, setBox] = React.useState({ w: 1200, h: 700 });
  const [view, setView] = React.useState({ k: 1, x: 0, y: 0 });
  const viewRef = React.useRef(view);
  viewRef.current = view;
  React.useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const read = () => { const r = el.getBoundingClientRect(); if (r.width && r.height) setBox({ w: r.width, h: r.height }); };
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const watch = new ResizeObserver(read);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const fit = React.useCallback(() => {
    const got = fitInto(layout, box.w, box.h, 56, 1);
    setView({ k: got.k, x: got.x, y: Math.max(under(), got.y) });
  }, [layout, box.w, box.h]);
  // a chart is opened whole when that leaves it readable; a large one opens on its top card at a size that can
  // be read (the whole of it is one press away, and on the small map)
  const open = React.useCallback(() => {
    const got = fitInto(layout, box.w, box.h, 56, 1);
    if (got.k >= READABLE || !layout.items.length) { setView({ k: got.k, x: got.x, y: Math.max(under(), got.y) }); return; }
    const top = layout.items[0];
    setView({ k: READABLE, x: box.w / 2 - (leftOf(top, layout, rtl) + top.w / 2) * READABLE, y: under() });
  }, [layout, box.w, box.h, rtl]);
  const fitted = React.useRef('');
  const fitKey = `${options.draws}|${options.direction}|${options.density}|${options.stack}|${options.depth}|${forest.nodes.length}|${Math.round(box.w / 40)}`;
  React.useEffect(() => {
    if (!layout.items.length || fitted.current === fitKey) return;
    fitted.current = fitKey;
    open();
  }, [fitKey, layout.items.length, open]);

  const zoomAt = React.useCallback((factor, px, py) => setView((v) => {
    const k = clamp(v.k * factor, ZOOM_MIN, ZOOM_MAX);
    const cx = px === undefined ? box.w / 2 : px;
    const cy = py === undefined ? box.h / 2 : py;
    return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
  }), [box.w, box.h]);
  const centreOn = React.useCallback((id) => {
    const it = byItem.get(id);
    if (!it) return;
    setView((v) => {
      const k = Math.max(v.k, 0.7);
      return { k, x: box.w / 2 - (leftOf(it, layout, rtl) + it.w / 2) * k, y: box.h / 2 - (it.y + it.h / 2) * k };
    });
  }, [byItem, layout, rtl, box.w, box.h]);

  // the wheel moves the chart; with Ctrl (or a pinch on a touchpad) it zooms where the pointer is
  React.useEffect(() => {
    const el = stage.current;
    if (!el) return undefined;
    const wheel = (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        zoomAt(Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top);
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [zoomAt]);

  // dragging the paper moves it; two fingers zoom it
  const touches = React.useRef(new Map());
  const held = React.useRef(null);
  const [grabbing, setGrabbing] = React.useState(false);
  const down = (e) => {
    if (e.target.closest('[data-card]') || e.target.closest('[data-chart-tool]')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* an old pointer */ }
    if (touches.current.size === 1) { held.current = { x: e.clientX, y: e.clientY, at: { ...viewRef.current } }; setGrabbing(true); }
    else held.current = null;
  };
  const move = (e) => {
    const was = touches.current.get(e.pointerId);
    if (!was) return;
    if (touches.current.size === 2) {
      const [a, b] = [...touches.current.values()];
      const before = Math.hypot(a.x - b.x, a.y - b.y);
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [c, d] = [...touches.current.values()];
      const after = Math.hypot(c.x - d.x, c.y - d.y);
      const r = stage.current.getBoundingClientRect();
      if (before > 0 && after > 0) zoomAt(after / before, (c.x + d.x) / 2 - r.left, (c.y + d.y) / 2 - r.top);
      return;
    }
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (held.current) setView({ ...held.current.at, x: held.current.at.x + e.clientX - held.current.x, y: held.current.at.y + e.clientY - held.current.y });
  };
  const up = (e) => {
    touches.current.delete(e.pointerId);
    if (!touches.current.size) { held.current = null; setGrabbing(false); }
  };
  const keys = (e) => {
    if (e.target !== e.currentTarget) return;
    const step = 80;
    if (e.key === 'ArrowLeft') setView((v) => ({ ...v, x: v.x + step }));
    else if (e.key === 'ArrowRight') setView((v) => ({ ...v, x: v.x - step }));
    else if (e.key === 'ArrowUp') setView((v) => ({ ...v, y: v.y + step }));
    else if (e.key === 'ArrowDown') setView((v) => ({ ...v, y: v.y - step }));
    else if (e.key === '+' || e.key === '=') zoomAt(1.2);
    else if (e.key === '-') zoomAt(1 / 1.2);
    else if (e.key === '0') fit();
    else if (e.key === '1') setView((v) => ({ ...v, k: 1 }));
    else return;
    e.preventDefault();
  };

  // ── folding, finding, lighting a branch
  const fold = React.useCallback((item) => setFolds((was) => {
    const next = new Set(was);
    if (item.hidden) { next.delete(item.id); next.add(`open:${item.id}`); } else { next.add(item.id); next.delete(`open:${item.id}`); }
    return next;
  }), []);
  const foldAll = () => setFolds(new Set(forest.nodes.filter((n) => (forest.kids.get(n.id) || []).length && n.level >= 1).map((n) => n.id)));
  const openAll = () => setFolds(new Set(forest.nodes.map((n) => `open:${n.id}`)));
  const [query, setQuery] = React.useState('');
  const [found, setFound] = React.useState('');
  const hits = React.useMemo(() => findNodes(forest.nodes, query), [forest, query]);
  const goTo = (node) => {
    // everything above it is opened, so it is on the chart to be shown
    setFolds((was) => {
      const next = new Set(was);
      for (const id of chainOf(forest.byId, node.id).slice(1)) { next.delete(id); next.add(`open:${id}`); }
      return next;
    });
    setFound(node.id);
    setQuery('');
  };
  const foundShown = !!found && byItem.has(found);
  React.useEffect(() => { if (foundShown) centreOn(found); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [found, foundShown]);
  const [hover, setHover] = React.useState('');
  const lit = React.useMemo(() => new Set(hover ? chainOf(forest.byId, hover) : []), [hover, forest]);

  // ── a card pressed, a department dragged onto another
  const pick = React.useCallback((item) => {
    const n = item.node;
    if (n.kind === 'department') onSelect?.(n.ref.id);
    else if (n.kind === 'position' && (n.ref.department_id || n.ref.department_id === 0)) onSelect?.(n.ref.department_id);
    else if (n.kind === 'person' && (n.ref.department_id || n.ref.department_id === 0)) onSelect?.(n.ref.department_id);
  }, [onSelect]);
  const picked = (item) => {
    const n = item.node;
    if (selectedId === null || selectedId === undefined) return false;
    return n.kind === 'department' && String(n.ref.id) === String(selectedId);
  };
  const [dragging, setDragging] = React.useState('');
  const [over, setOver] = React.useState('');
  const banned = React.useMemo(() => {
    const out = new Set();
    if (!dragging) return out;
    const walk = (id) => { out.add(id); for (const kid of forest.kids.get(id) || []) walk(kid); };
    walk(dragging);
    return out;
  }, [dragging, forest]);
  const dragOf = (item) => {
    if (!onMove || options.draws !== 'departments') return null;
    const okTarget = dragging && !banned.has(item.id);
    return {
      draggable: true,
      onDragStart: (e) => { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', item.id); } catch { /* some browsers refuse a type */ } setDragging(item.id); },
      onDragEnd: () => { setDragging(''); setOver(''); },
      onDragOver: (e) => { if (okTarget) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== item.id) setOver(item.id); } },
      onDragLeave: () => { if (over === item.id) setOver(''); },
      onDrop: (e) => {
        e.preventDefault();
        const moved = dragging;
        setDragging(''); setOver('');
        const from = forest.byId.get(moved);
        if (moved && okTarget && from && from.parent !== item.id) onMove(from.ref.id, item.node.ref.id);
      },
    };
  };

  // ── the small map: the whole chart, and the part of it in the window
  const mapScale = layout.items.length ? Math.min(MAP.w / Math.max(1, layout.width), MAP.h / Math.max(1, layout.height)) : 1;
  const mapJump = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const cx = (e.clientX - r.left - (MAP.w - layout.width * mapScale) / 2) / mapScale;
    const cy = (e.clientY - r.top - (MAP.h - layout.height * mapScale) / 2) / mapScale;
    setView((v) => ({ ...v, x: box.w / 2 - cx * v.k, y: box.h / 2 - cy * v.k }));
  };

  const full = () => {
    const el = wrap.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.(); else el.requestFullscreen?.();
  };

  const legend = options.colour !== 'none' ? legendOf(options.colour, forest) : [];
  const levels = forest.nodes.reduce((most, n) => Math.max(most, (n.level || 0) + 1), 0);
  const empty = !asking && !forest.nodes.length;
  const count = forest.nodes.length;
  const counted = options.draws === 'people' ? (count === 1 ? t('1 person') : t('{n} people', { n: num(count) }))
    : options.draws === 'positions' ? (count === 1 ? t('1 position') : t('{n} positions', { n: num(count) }))
      : (count === 1 ? t('1 department') : t('{n} departments', { n: num(count) }));

  return (
    <ChartWords.Provider value={said}>
      <div ref={wrap} className={`ooc ${className}`.trim()} style={{ background: paper.page, ...(style || {}) }} dir={dir} data-theme={dark ? 'dark' : 'light'}
           data-testid="org-chart" data-draws={options.draws} data-direction={layout.direction}>
        {/* the paper: its own left and right, whatever way the page reads (the cards inside follow the reader) */}
        <div ref={stage} tabIndex={0} role="application" aria-label={t('The organisation chart')} dir="ltr" data-testid="org-chart-stage"
             className={`ooc-stage${grabbing ? ' is-grabbing' : ''}`}
             style={{ backgroundImage: `radial-gradient(circle, ${paper.dot} 1px, transparent 1.2px)`, backgroundSize: `${24 * view.k}px ${24 * view.k}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
             onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={keys}>
          <div className="ooc-sheet" data-testid="org-chart-sheet" data-zoom={Math.round(view.k * 100)}
               style={{ width: layout.width, height: layout.height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
            <svg className="ooc-lines" width={Math.max(1, layout.width)} height={Math.max(1, layout.height)} aria-hidden="true">
              {layout.links.map((link) => {
                const strong = lit.has(link.to);
                return <path key={`${link.from}>${link.to}`} d={linkPath(link, byItem, layout, rtl, options.lines)} fill="none" stroke={strong ? paper.strong : paper.line}
                             strokeWidth={strong ? 2.25 : 1.5} strokeLinecap="round" strokeLinejoin="round" data-testid="org-chart-line" data-lit={strong ? 'yes' : undefined} />;
              })}
            </svg>
            {layout.items.map((it) => (
              <div key={it.id} onPointerEnter={() => setHover(it.id)} onPointerLeave={() => setHover((was) => (was === it.id ? '' : was))}>
                <Card item={it} left={leftOf(it, layout, rtl)} accent={accentOf(it.node, options.colour, forest.branches)} paper={paper} options={options}
                      selected={picked(it)} lit={lit.has(it.id)} found={found === it.id} dragging={dragging === it.id} target={over === it.id && !banned.has(it.id)}
                      side={side} dir={dir} onPick={pick} onFold={fold} dragProps={dragOf(it)} renderFace={renderFace} />
              </div>
            ))}
          </div>
        </div>

        {asking && <div className="ooc-message" style={{ color: paper.quiet }} data-testid="org-chart-loading"><Spinner />{t('Reading the chart…')}</div>}
        {empty && (
          <div className="ooc-message" style={{ color: paper.quiet }} data-testid="org-chart-empty" dir="auto">
            {options.draws === 'people' ? t('Nobody holds a seat yet: put people in positions and they appear here, each under who they answer to.')
              : options.draws === 'positions' ? t('There are no positions yet: add them to a department and they appear here, each under the seat it answers to.')
                : t('There are no departments yet.')}
          </div>
        )}

        {/* what is drawn, and finding a name */}
        <div ref={tools} data-chart-tool className="ooc-tools">
          <div className="ooc-group" role="group" aria-label={t('What the chart draws')}>
            {DRAWS.map((d) => (
              <button key={d} type="button" aria-pressed={options.draws === d} onClick={() => setOptions({ draws: d })} data-testid={`org-chart-draws-${d}`} className="ooc-seg">
                {t(DRAW_WORDS[d])}
              </button>
            ))}
          </div>
          <div className="ooc-find">
            <div className="ooc-search">
              <Search />
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Find on the chart')} aria-label={t('Find on the chart')} dir="auto"
                     data-testid="org-chart-search" onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) goTo(hits[0]); if (e.key === 'Escape') setQuery(''); }} />
              {query && <button type="button" onClick={() => setQuery('')} aria-label={t('Clear')} className="ooc-clear"><Close size={14} /></button>}
            </div>
            {query.trim() && (
              <ul className="ooc-panel ooc-hits" data-testid="org-chart-hits">
                {hits.map((n) => (
                  <li key={n.id}>
                    <button type="button" onClick={() => goTo(n)} data-testid="org-chart-hit" className="ooc-hit">
                      <span className="ooc-truncate ooc-strong" dir="auto">{n.title}</span>
                      {(n.sub || n.place) && <span className="ooc-truncate ooc-hint" dir="auto">{[n.sub, n.place].filter(Boolean).join(' · ')}</span>}
                    </button>
                  </li>
                ))}
                {!hits.length && <li className="ooc-hint ooc-pad" dir="auto">{t('Nothing on the chart is called that.')}</li>}
              </ul>
            )}
          </div>
          <div className="ooc-end">
            <div className="ooc-group">
              <button type="button" className="ooc-icon" onClick={() => zoomAt(1 / 1.2)} disabled={view.k <= ZOOM_MIN + 0.001} aria-label={t('Smaller')} title={t('Smaller')} data-testid="org-chart-smaller"><Minus /></button>
              <button type="button" className="ooc-zoom" onClick={() => setView((v) => ({ ...v, k: 1 }))} title={t('Actual size')} aria-label={t('Actual size')} data-testid="org-chart-zoom">{num(Math.round(view.k * 100))}%</button>
              <button type="button" className="ooc-icon" onClick={() => zoomAt(1.2)} disabled={view.k >= ZOOM_MAX - 0.001} aria-label={t('Larger')} title={t('Larger')} data-testid="org-chart-larger"><Plus /></button>
              <button type="button" className="ooc-icon" onClick={fit} aria-label={t('Show the whole chart')} title={t('Show the whole chart')} data-testid="org-chart-fit"><Fit /></button>
              <button type="button" className="ooc-icon ooc-wide-only" onClick={full} aria-label={t('Fill the screen')} title={t('Fill the screen')} data-testid="org-chart-full"><FullScreen /></button>
            </div>
            <Options options={options} onChange={setOptions} onFoldAll={foldAll} onOpenAll={openAll} side={side} />
            <TakeOut layout={layout} forest={forest} options={options} rtl={rtl} dark={dark} title={title} exportData={exportData} tableFormats={tableFormats} onNotice={onNotice} />
          </div>
        </div>

        {/* what the colours say */}
        {legend.length > 0 && !empty && (
          <div data-chart-tool className="ooc-legend" data-testid="org-chart-legend">
            {legend.slice(0, 8).map((l, i) => (
              <span key={i} className="ooc-legend-item"><span className="ooc-dot" style={{ background: l.colour }} aria-hidden="true" /><span className="ooc-truncate" dir="auto">{l.plain ? l.label : t(l.label, l.vars && { ...l.vars, n: num(l.vars.n) })}</span></span>
            ))}
            {legend.length > 8 && <span className="ooc-legend-item">+{num(legend.length - 8)}</span>}
            <span className="ooc-legend-count" data-testid="org-chart-count">{counted}{levels > 1 ? ` · ${t('{n} levels', { n: num(levels) })}` : ''}</span>
          </div>
        )}

        {/* the small map */}
        {options.minimap && layout.items.length > 6 && (
          <button type="button" data-chart-tool onClick={mapJump} aria-label={t('The whole chart: press a place to go there')} title={t('The whole chart: press a place to go there')}
                  className="ooc-map" style={{ width: MAP.w, height: MAP.h }} data-testid="org-chart-map">
            <svg width={MAP.w} height={MAP.h} aria-hidden="true">
              <g transform={`translate(${(MAP.w - layout.width * mapScale) / 2} ${(MAP.h - layout.height * mapScale) / 2}) scale(${mapScale})`}>
                {layout.items.map((it) => <rect key={it.id} x={leftOf(it, layout, rtl)} y={it.y} width={it.w} height={it.h} rx={10} fill={accentOf(it.node, options.colour, forest.branches)} opacity={0.55} />)}
                <rect x={-view.x / view.k} y={-view.y / view.k} width={box.w / view.k} height={box.h / view.k} fill="none" stroke={paper.strong} strokeWidth={2 / mapScale} rx={6 / mapScale} />
              </g>
            </svg>
          </button>
        )}
      </div>
    </ChartWords.Provider>
  );
}
