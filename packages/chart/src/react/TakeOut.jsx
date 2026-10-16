// SPDX-License-Identifier: Apache-2.0
/**
 * Taking the chart out: the picture on the screen - as it is folded, coloured and styled now - as PNG, SVG or PDF,
 * made in the browser (nothing is sent anywhere to make it); and, when the chart is handed an `exportData`, the
 * organisation's structure as data (CSV, Excel, JSON), made by whoever keeps it.
 */
import React from 'react';
import { fileName, pictureBlob, save } from '../core/files.js';
import { paperFor } from '../core/style.js';
import { chartSvg, roughWidth } from '../core/svg.js';
import { useWords } from './context.js';
import { useCloseOutside } from './Options.jsx';
import { Download, File, Picture, Spinner, Table } from './icons.jsx';

const DRAW_WORDS = { departments: 'Structure', positions: 'Positions', people: 'People' };
const TABLE_WORDS = { xlsx: ['Excel', 'The columns the import reads'], csv: ['CSV', 'The same table, as text'], json: ['JSON', 'For a program'] };

/** How wide a text is, asked of the browser's own canvas (a count of letters where there is none). */
function measurer() {
  let ctx = null;
  try { ctx = document.createElement('canvas').getContext('2d'); } catch { ctx = null; }
  if (!ctx || typeof ctx.measureText !== 'function') return roughWidth;
  return (text, px, bold) => {
    ctx.font = `${bold ? 700 : 500} ${px}px Vazirmatn, 'Segoe UI', Tahoma, Arial, sans-serif`;
    const got = ctx.measureText(String(text || '')).width;
    return Number.isFinite(got) && got > 0 ? got : roughWidth(text, px, bold);
  };
}

/** The chart on the screen as a standalone SVG, with the words a card writes in the reader's language. */
export function pictureOf({ layout, forest, options, rtl, dark, t, title }) {
  return chartSvg(layout, {
    paper: paperFor(options.paper, dark), options, branches: forest.branches, rtl, measure: measurer(),
    title: title || t('Organisation chart'), note: `${t(DRAW_WORDS[options.draws])} · ${new Date().toISOString().slice(0, 10)}`,
    words: { vacant: t('Vacant'), noHead: t('No head'), vacantHead: t('Its head seat is vacant'), people: t('People'), vacantSeats: t('Vacant seats'), reports: t('Answer to them') },
  });
}

export default function TakeOut({ layout, forest, options, rtl, dark, title, exportData, tableFormats, onNotice }) {
  const { t } = useWords();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState('');
  const close = React.useCallback(() => setOpen(false), []);
  const ref = useCloseOutside(open, close);
  const tables = exportData ? (tableFormats || ['xlsx', 'csv', 'json']).filter((k) => TABLE_WORDS[k]) : [];
  const picture = async (kind) => {
    setBusy(kind);
    try {
      const svg = pictureOf({ layout, forest, options, rtl, dark, t, title });
      save(await pictureBlob(svg, kind, 2), fileName(options.draws, kind));
      setOpen(false);
    } catch {
      onNotice?.({ kind: 'error', text: t('The picture could not be made.') });
    } finally { setBusy(''); }
  };
  const table = async (kind) => {
    setBusy(kind);
    try {
      const got = await exportData(kind);
      save(got instanceof Blob ? got : new Blob([typeof got === 'string' ? got : JSON.stringify(got, null, 2)]), fileName('structure', kind));
      setOpen(false);
    } catch {
      onNotice?.({ kind: 'error', text: t('The file could not be made.') });
    } finally { setBusy(''); }
  };
  const Item = ({ kind, icon: Mark, label, hint, run }) => (
    <button type="button" disabled={!!busy} onClick={() => run(kind)} data-testid={`org-chart-export-${kind}`} className="ooc-menu-item" role="menuitem">
      {busy === kind ? <Spinner /> : <Mark />}
      <span className="ooc-menu-text"><span className="ooc-block">{label}</span><span className="ooc-block ooc-hint ooc-truncate">{hint}</span></span>
    </button>
  );
  return (
    <div ref={ref} className="ooc-pop" data-chart-tool>
      <button type="button" className="ooc-btn" aria-expanded={open} disabled={!layout.items.length} onClick={() => setOpen((v) => !v)} data-testid="org-chart-export">
        <Download /><span className="ooc-wide-only">{t('Take out')}</span>
      </button>
      {open && (
        <div className="ooc-panel ooc-menu" role="menu" aria-label={t('Take out')} data-testid="org-chart-export-menu">
          <div className="ooc-label ooc-pad">{t('The picture, as it is drawn now')}</div>
          <Item kind="png" icon={Picture} label="PNG" hint={t('For a slide or a message')} run={picture} />
          <Item kind="svg" icon={File} label="SVG" hint={t('Sharp at any size; opens in a drawing program')} run={picture} />
          <Item kind="pdf" icon={File} label="PDF" hint={t('For print')} run={picture} />
          {tables.length > 0 && <div className="ooc-label ooc-pad ooc-rule">{t('The structure, as data')}</div>}
          {tables.map((k) => <Item key={k} kind={k} icon={Table} label={TABLE_WORDS[k][0]} hint={t(TABLE_WORDS[k][1])} run={table} />)}
        </div>
      )}
    </div>
  );
}
