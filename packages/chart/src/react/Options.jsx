// SPDX-License-Identifier: Apache-2.0
/**
 * The reader's choices for the chart (style.js): which way it runs, how its lines bend, what its colours say, what
 * a card writes, how many levels are open. A panel of the chart itself - it opens inside the chart's own box, so it
 * is there when the chart fills the screen too - and every choice is drawn at once and remembered on the device.
 */
import React from 'react';
import { DIRECTIONS } from '../core/layout.js';
import { COLOURS, DEFAULTS, DENSITIES, DEPTHS, LINES, PAPERS, SHOWS } from '../core/style.js';
import { useWords } from './context.js';
import { Sliders } from './icons.jsx';

const WORDS = {
  direction: { down: 'Top to bottom', side: 'Sideways' },
  lines: { elbow: 'Square', curved: 'Curved', straight: 'Straight' },
  colour: { none: 'None', branch: 'Branch', level: 'Level', vacancy: 'Vacancies' },
  density: { comfortable: 'Roomy', compact: 'Compact' },
  paper: { screen: 'As on screen', light: 'Light', dark: 'Dark' },
  show: { face: 'The face', sub: 'The second line', counts: 'Numbers', vacant: 'Vacancies', code: 'Position code', place: 'Where they sit' },
};

/** Close a panel when the pointer goes down outside it, or Escape is pressed. */
export function useCloseOutside(open, close) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return undefined;
    const down = (e) => { if (ref.current && !ref.current.contains(e.target)) close(); };
    const key = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', down, true); document.removeEventListener('keydown', key); };
  }, [open, close]);
  return ref;
}

function Choice({ label, value, values, words, onPick, testid }) {
  const { t } = useWords();
  return (
    <div>
      <div className="ooc-label">{t(label)}</div>
      <div className="ooc-chips" role="group" aria-label={t(label)}>
        {values.map((v) => (
          <button key={String(v)} type="button" aria-pressed={value === v} onClick={() => onPick(v)} data-testid={`${testid}-${v}`} className="ooc-chip">
            {words ? t(words[v]) : v}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, testid, children }) {
  return (
    <label className="ooc-toggle">
      <span className="ooc-toggle-text">{children}</span>
      <input type="checkbox" role="switch" className="ooc-switch" checked={!!checked} onChange={(e) => onChange(e.target.checked)} data-testid={testid} />
    </label>
  );
}

export default function Options({ options, onChange, onFoldAll, onOpenAll, side }) {
  const { t, num } = useWords();
  const [open, setOpen] = React.useState(false);
  const close = React.useCallback(() => setOpen(false), []);
  const ref = useCloseOutside(open, close);
  const show = options.show || {};
  return (
    <div ref={ref} className="ooc-pop" data-chart-tool>
      <button type="button" className="ooc-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="org-chart-options">
        <Sliders /><span className="ooc-wide-only">{t('Show and style')}</span>
      </button>
      {open && (
        <div className="ooc-panel ooc-options" data-testid="org-chart-options-panel" role="dialog" aria-label={t('Show and style')}>
          <Choice label="Runs" value={options.direction} values={DIRECTIONS} words={WORDS.direction} onPick={(v) => onChange({ direction: v })} testid="org-chart-direction" />
          {!side && (
            <Toggle checked={options.stack} onChange={(v) => onChange({ stack: !!v })} testid="org-chart-stack">
              <span className="ooc-block">{t('Teams in a column')}</span>
              <span className="ooc-block ooc-hint">{t('Where everything under a card is a last one, they stand under it instead of side by side.')}</span>
            </Toggle>
          )}
          <Choice label="Lines" value={options.lines} values={LINES} words={WORDS.lines} onPick={(v) => onChange({ lines: v })} testid="org-chart-lines" />
          <Choice label="Colour says" value={options.colour} values={COLOURS} words={WORDS.colour} onPick={(v) => onChange({ colour: v })} testid="org-chart-colour" />
          <Choice label="Cards" value={options.density} values={DENSITIES} words={WORDS.density} onPick={(v) => onChange({ density: v })} testid="org-chart-density" />
          <div>
            <div className="ooc-label">{t('Levels open')}</div>
            <div className="ooc-chips" role="group" aria-label={t('Levels open')}>
              {DEPTHS.map((d) => (
                <button key={d} type="button" aria-pressed={options.depth === d} onClick={() => onChange({ depth: d })} data-testid={`org-chart-depth-${d}`} className="ooc-chip">
                  {d === 0 ? t('All') : num(d)}
                </button>
              ))}
            </div>
            <div className="ooc-chips ooc-gap-top">
              <button type="button" className="ooc-link" onClick={onFoldAll} data-testid="org-chart-fold-all">{t('Fold all')}</button>
              <button type="button" className="ooc-link" onClick={onOpenAll} data-testid="org-chart-open-all">{t('Open all')}</button>
            </div>
          </div>
          <div>
            <div className="ooc-label">{t('On a card')}</div>
            <div className="ooc-grid2">
              {SHOWS.map((k) => (
                <label key={k} className="ooc-check">
                  <input type="checkbox" checked={show[k] !== false && !!show[k]} onChange={(e) => onChange({ show: { ...show, [k]: e.target.checked } })} data-testid={`org-chart-show-${k}`} />
                  <span>{t(WORDS.show[k])}</span>
                </label>
              ))}
            </div>
          </div>
          <Toggle checked={options.minimap} onChange={(v) => onChange({ minimap: !!v })} testid="org-chart-minimap">{t('The small map')}</Toggle>
          <Choice label="A picture’s paper" value={options.paper} values={PAPERS} words={WORDS.paper} onPick={(v) => onChange({ paper: v })} testid="org-chart-paper" />
          <div className="ooc-rule">
            <button type="button" className="ooc-link" onClick={() => onChange({ ...DEFAULTS, draws: options.draws })} data-testid="org-chart-reset">{t('Back to how it comes')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
