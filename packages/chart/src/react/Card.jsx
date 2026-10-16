// SPDX-License-Identifier: Apache-2.0
/**
 * One card of the chart on the screen: a department, a seat or a person - the same shape for all three, saying what
 * the reader chose to have written on it (style.js `show`). The picture taken of the chart draws the same card in
 * SVG (svg.js); what one writes, the other writes.
 */
import React from 'react';
import { initials } from '../core/model.js';
import { tint } from '../core/style.js';
import { useWords } from './context.js';
import { Crown, Down, People, Side } from './icons.jsx';

/** A face with no picture: two letters in a circle of the card's colour. */
export function Face({ face, size, accent }) {
  return (
    <span className="ooc-face" aria-hidden="true"
          style={{ width: size, height: size, fontSize: Math.round(size * 0.38), background: tint(accent, 0.16), color: accent }}>
      {initials(face.name || face.email)}
    </span>
  );
}

function Card({ item, left, accent, paper, options, selected, lit, found, dragging, target, side, dir, onPick, onFold, dragProps, renderFace }) {
  const { t, num } = useWords();
  const n = item.node;
  const show = options.show || {};
  const compact = options.density === 'compact';
  const coloured = options.colour !== 'none';
  const vacantSeat = n.kind === 'position' && n.vacant;
  const saysVacant = show.vacant !== false && (n.vacant || (n.kind === 'department' && n.noHead));
  let sub = show.sub !== false ? n.sub : '';
  let subTone = paper.quiet;
  if (show.sub !== false && n.kind === 'department' && !n.sub) { sub = n.noHead ? t('No head') : t('Its head seat is vacant'); if (show.vacant !== false) subTone = paper.vacant; }
  if (show.sub !== false && vacantSeat) { sub = t('Vacant'); subTone = paper.vacant; }
  const face = show.face !== false && n.kind !== 'department';
  const faceSize = compact ? 28 : 36;
  const drawFace = (who, size) => (renderFace ? renderFace(who, size, accent) : <Face face={who} size={size} accent={accent} />);
  const bits = [];
  if (!compact && show.place !== false && n.place) bits.push(<span key="place" className="ooc-truncate" dir="auto">{n.place}</span>);
  if (!compact && show.code && n.code) bits.push(<span key="code" className="ooc-code" dir="ltr">{n.code}</span>);
  if (!compact && show.counts !== false && n.kind === 'department') {
    bits.push(<span key="people" className="ooc-count" title={t('{n} people here and below', { n: num(n.people) })}><People size={12} />{num(n.people)}</span>);
    if (show.vacant !== false && n.vacantSeats) bits.push(<span key="vacant" className="ooc-count" style={{ color: paper.vacant }}>{n.vacantSeats === 1 ? t('1 vacant seat') : t('{n} vacant seats', { n: num(n.vacantSeats) })}</span>);
  }
  if (!compact && show.counts !== false && n.kind === 'person' && n.people) {
    bits.push(<span key="reports" className="ooc-count" title={t('{n} people answer to them, in all', { n: num(n.people) })}><People size={12} />{num(n.people)}</span>);
  }
  const ring = selected ? `0 0 0 2px ${paper.strong}` : found ? `0 0 0 2px ${accent}` : lit ? `0 0 0 1.5px ${tint(accent, 0.7)}` : `0 1px 2px ${paper.shadow}, 0 4px 12px ${paper.shadow}`;
  const dashed = vacantSeat && show.vacant !== false;
  return (
    <div data-card={item.id} data-testid={`org-chart-card-${item.id}`} data-kind={n.kind} data-vacant={saysVacant ? 'yes' : undefined} data-over={target ? 'yes' : undefined}
         dir={dir} role="button" tabIndex={0} aria-pressed={!!selected} aria-label={[n.title, sub].filter(Boolean).join(', ')}
         onClick={(e) => { e.stopPropagation(); onPick?.(item); }}
         onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick?.(item); } }}
         {...(dragProps || {})}
         className={`ooc-card${n.inactive ? ' is-inactive' : ''}${dragging ? ' is-dragging' : ''}`}
         style={{ left, top: item.y, width: item.w, height: item.h, background: target ? tint(paper.strong, 0.08) : paper.card, color: paper.text,
           border: `1px ${dashed ? 'dashed' : 'solid'} ${target ? paper.strong : dashed ? paper.vacant : paper.border}`, boxShadow: ring }}>
      {coloured && <span aria-hidden="true" className="ooc-card-accent" style={{ background: accent }} />}
      {face && (n.face ? drawFace(n.face, faceSize) : (
        <span aria-hidden="true" className="ooc-face is-empty" style={{ width: faceSize, height: faceSize, borderColor: paper.vacant }} />
      ))}
      <span className="ooc-card-text" style={{ gap: compact ? 2 : 3 }}>
        <span className="ooc-row">
          <span className={`ooc-card-title ooc-truncate${compact ? ' is-compact' : ''}`} dir="auto" title={n.title}>{n.title}</span>
          {n.head && n.kind !== 'department' && <span className="ooc-crown"><Crown size={12} label={t('Head')} /></span>}
        </span>
        {sub ? (
          <span className={`ooc-row ooc-card-sub${compact ? ' is-compact' : ''}`} style={{ color: subTone }}>
            {n.kind === 'department' && n.face && show.face !== false && drawFace(n.face, 16)}
            <span className="ooc-truncate" dir="auto">{sub}{n.kind === 'position' && n.more ? ` +${num(n.more)}` : ''}</span>
            {n.kind === 'department' && n.face && <span className="ooc-crown"><Crown size={12} label={t('Head')} /></span>}
          </span>
        ) : null}
        {bits.length ? <span className="ooc-row ooc-card-bits" style={{ color: paper.quiet }}>{bits}</span> : null}
      </span>
      {item.kids > 0 && (
        <button type="button" data-testid={`org-chart-fold-${item.id}`} aria-expanded={!item.hidden}
                aria-label={item.hidden ? t('Show the {n} under it', { n: num(item.hidden) }) : t('Fold what is under it')}
                title={item.hidden ? t('Show the {n} under it', { n: num(item.hidden) }) : t('Fold what is under it')}
                onClick={(e) => { e.stopPropagation(); onFold?.(item); }} onPointerDown={(e) => e.stopPropagation()}
                className={`ooc-fold${side ? ' is-side' : ''}`}
                style={{ background: paper.card, color: paper.quiet, border: `1px solid ${paper.border}` }}>
          {item.hidden ? `+${num(item.hidden)}` : (side ? <Side size={12} /> : <Down size={12} />)}
        </button>
      )}
    </div>
  );
}

export default React.memo(Card);
