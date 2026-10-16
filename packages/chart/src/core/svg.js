// SPDX-License-Identifier: Apache-2.0
/**
 * THE CHART AS A PICTURE: one standalone SVG, made from the same layout the screen draws.
 *
 * Standalone means: no stylesheet, no font file, no image fetched from anywhere — every colour is written on the
 * shape, a face is two letters in a circle, and text is cut to its card here (an SVG has no ellipsis of its own).
 * So the file opens the same in a browser, in a slide, in a vector editor; and the PNG and the PDF are this SVG
 * painted (files.js).
 *
 *   chartSvg(layout, {paper, options, branches, rtl, title, note, words, measure})  ->  '<svg …>…</svg>'
 *
 * `words` are the few words a card writes (vacant, no head, …) already in the reader's language; `measure(text,
 * px, bold)` says how wide a text is (the browser's canvas; a count of letters where there is none).
 *
 * PURE MODULE. No React, no requests.
 */
import { leftOf, linkPath } from './layout.js';
import { initials } from './model.js';
import { accentOf, tint } from './style.js';

const FONT = "'Vazirmatn', 'Segoe UI', Tahoma, 'Noto Sans', 'Noto Sans Arabic', Arial, sans-serif";
const PAD = 40;

export const esc = (s) => String(s === undefined || s === null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A text's width where there is no canvas to ask: wide letters count more than narrow ones. */
export function roughWidth(text, px = 12, bold = false) {
  let units = 0;
  for (const ch of String(text || '')) units += /[ilI.,:;'|!‌]/.test(ch) ? 0.3 : /[mwMW@]/.test(ch) ? 0.9 : /[A-Z؀-ۿ]/.test(ch) ? 0.66 : 0.55;
  return units * px * (bold ? 1.06 : 1);
}

/** A text cut to a width, with "…" when something was cut. */
export function fitText(text, width, px, bold, measure = roughWidth) {
  const full = String(text || '');
  if (!full || measure(full, px, bold) <= width) return full;
  const letters = Array.from(full);
  let low = 0;
  let high = letters.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (measure(`${letters.slice(0, mid).join('')}…`, px, bold) <= width) low = mid; else high = mid - 1;
  }
  return low ? `${letters.slice(0, low).join('').trimEnd()}…` : '…';
}

/** Does a text read from the right? (Its first letter that has a direction says.) */
export const readsRight = (text) => {
  const m = /[A-Za-zÀ-ɏ֐-ࣿ]/.exec(String(text || ''));
  return !!m && /[֐-ࣿ]/.test(m[0]);
};

export function chartSvg(layout, given = {}) {
  const { paper, options, branches = [], rtl = false, title = '', note = '', words = {}, measure = roughWidth } = given;
  const o = options || {};
  const show = o.show || {};
  const compact = o.density === 'compact';
  const byItem = new Map(layout.items.map((it) => [it.id, it]));
  const head = title ? 46 : 0;
  const W = Math.ceil(layout.width + PAD * 2);
  const H = Math.ceil(layout.height + PAD * 2 + head + (note ? 26 : 0));
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${esc(FONT)}">`);
  out.push(`<defs><filter id="lift" x="-10%" y="-10%" width="120%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="${paper.shadow}"/></filter></defs>`);
  out.push(`<rect width="${W}" height="${H}" fill="${paper.page}"/>`);
  // a line of text at (x, y): anchored at the reading edge, and told which way it reads
  const line = (text, x, y, px, weight, fill, anchorEnd = false) => {
    const right = readsRight(text);
    const anchor = (rtl ? !anchorEnd : anchorEnd) ? 'end' : 'start';
    return `<text x="${x}" y="${y}" font-size="${px}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" direction="${right ? 'rtl' : 'ltr'}" unicode-bidi="plaintext">${esc(text)}</text>`;
  };
  if (title) out.push(line(title, rtl ? W - PAD : PAD, PAD + 4, 20, 700, paper.text));
  out.push(`<g transform="translate(${PAD} ${PAD + head})">`);
  for (const link of layout.links) {
    const d = linkPath(link, byItem, layout, rtl, o.lines);
    if (d) out.push(`<path d="${d}" fill="none" stroke="${paper.line}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  for (const it of layout.items) {
    const n = it.node;
    const x = leftOf(it, layout, rtl);
    const { y, w, h } = it;
    const accent = accentOf(n, o.colour, branches);
    const vacant = show.vacant !== false && (n.vacant || (n.kind === 'department' && n.noHead));
    out.push(`<g transform="translate(${x} ${y})"${n.inactive ? ' opacity="0.55"' : ''}>`);
    out.push(`<rect width="${w}" height="${h}" rx="14" fill="${paper.card}" stroke="${vacant && n.kind === 'position' ? paper.vacant : paper.border}" stroke-width="1"${vacant && n.kind === 'position' ? ' stroke-dasharray="5 4"' : ''} filter="url(#lift)"/>`);
    // the accent: a bar down the reading edge
    if (o.colour && o.colour !== 'none') {
      out.push(`<rect x="${rtl ? w - 5 : 0}" y="12" width="5" height="${h - 24}" rx="2.5" fill="${accent}"/>`);
    }
    const inset = 14;
    const faceSize = compact ? 28 : 36;
    const face = show.face !== false && n.face && (n.face.name || n.face.email);
    const edge = rtl ? w - inset : inset;                       // the reading edge inside the card
    const dir = rtl ? -1 : 1;
    let textX = edge;
    if (show.face !== false && n.kind !== 'department') {
      // a person's or a seat's face stands at the reading edge; an empty seat's is a dashed circle
      const cx = edge + dir * (faceSize / 2);
      const cy = h / 2;
      if (face) {
        out.push(`<circle cx="${cx}" cy="${cy}" r="${faceSize / 2}" fill="${tint(accent, 0.16)}"/>`);
        out.push(`<text x="${cx}" y="${cy + faceSize * 0.14}" font-size="${Math.round(faceSize * 0.38)}" font-weight="700" fill="${accent}" text-anchor="middle">${esc(initials(n.face.name || n.face.email))}</text>`);
      } else {
        out.push(`<circle cx="${cx}" cy="${cy}" r="${faceSize / 2 - 1}" fill="none" stroke="${paper.vacant}" stroke-width="1.2" stroke-dasharray="3 3"/>`);
      }
      textX = edge + dir * (faceSize + 10);
    }
    const room = w - inset * 2 - (textX === edge ? 0 : faceSize + 10);
    const titlePx = compact ? 12.5 : 14;
    const subPx = compact ? 10.5 : 12;
    const lines = [];
    lines.push({ text: fitText(n.title, room, titlePx, true, measure), px: titlePx, weight: 700, fill: paper.text });
    if (show.sub !== false) {
      let sub = n.sub;
      let fill = paper.quiet;
      if (n.kind === 'department' && !n.sub) { sub = n.noHead ? words.noHead : words.vacantHead; fill = show.vacant === false ? paper.quiet : paper.vacant; }
      if (n.kind === 'position' && n.vacant) { sub = words.vacant; fill = paper.vacant; }
      if (n.kind === 'position' && n.more) sub = `${n.sub} +${n.more}`;
      if (sub) lines.push({ text: fitText(sub, room, subPx, false, measure), px: subPx, weight: 500, fill });
    }
    if (!compact) {
      const bits = [];
      if (show.place !== false && n.place) bits.push(n.place);
      if (show.code && n.code) bits.push(n.code);
      if (show.counts !== false && n.kind === 'department') {
        bits.push(`${words.people}: ${n.people}`);
        if (show.vacant !== false && n.vacantSeats) bits.push(`${words.vacantSeats}: ${n.vacantSeats}`);
      }
      if (show.counts !== false && n.kind === 'person' && n.people) bits.push(`${words.reports}: ${n.people}`);
      if (bits.length) lines.push({ text: fitText(bits.join('  ·  '), room, 10.5, false, measure), px: 10.5, weight: 500, fill: paper.quiet });
    }
    const gap = compact ? 4 : 5;
    const tall = lines.reduce((sum, l) => sum + l.px, 0) + gap * (lines.length - 1);
    let at = (h - tall) / 2;
    for (const l of lines) {
      at += l.px;
      out.push(line(l.text, textX, Math.round((at - l.px * 0.18) * 10) / 10, l.px, l.weight, l.fill));
      at += gap;
    }
    // what is folded away under it
    if (it.hidden) {
      const cx = layout.direction === 'side' ? (rtl ? 0 : w) : w / 2;
      const cy = layout.direction === 'side' ? h / 2 : h;
      out.push(`<circle cx="${cx}" cy="${cy}" r="11" fill="${paper.card}" stroke="${paper.border}"/>`);
      out.push(`<text x="${cx}" y="${cy + 3.5}" font-size="10" font-weight="700" fill="${paper.quiet}" text-anchor="middle">+${it.hidden}</text>`);
    }
    out.push('</g>');
  }
  out.push('</g>');
  if (note) out.push(line(note, rtl ? W - PAD : PAD, H - 16, 11, 500, paper.quiet));
  out.push('</svg>');
  return out.join('');
}
