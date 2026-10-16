// SPDX-License-Identifier: Apache-2.0
/**
 * WHERE EACH CARD STANDS.
 *
 * A tidy tree: a parent centred over what is under it, siblings side by side, nothing overlapping. Two directions:
 *
 *   down   the classic chart — the top at the top, each level a row
 *   side   the top at the reading edge, each level a column (a deep chart reads better so, and so does a phone)
 *
 * and, going down, `stack`: where everything under a card is a LEAF (a team's seats, a unit's people), those
 * stand in one column under it instead of a row — which is what keeps a wide team from making the chart ten
 * screens wide.
 *
 * `x` grows from the reading edge: the drawing mirrors it for a right-to-left reader (`mirror`). Everything is in
 * the chart's own units (CSS pixels at 100%).
 *
 *   layoutChart(forest, {direction, stack, card: {w, h}, gapX, gapY, collapsed: Set, depth})
 *     -> { items: [{id, node, x, y, w, h, depth, hidden, stacked}], links: [{from, to, kind}], width, height }
 *
 * `hidden` is how many cards are folded away under an item (collapsed by hand, or below the depth asked for).
 *
 * PURE MODULE. No React.
 */

export const DIRECTIONS = ['down', 'side'];
export const SIZES = {
  comfortable: { w: 224, h: 84, gapX: 24, gapY: 56 },
  compact: { w: 184, h: 60, gapX: 16, gapY: 40 },
};
const INDENT = 28;      // how far a stacked column stands in from its parent's edge
const STACK_GAP = 12;   // between the cards of a stacked column
const STACK_FROM = 3;   // a row of fewer leaves than this stays a row

export function layoutChart(forest, options = {}) {
  const o = options || {};
  const size = o.card || SIZES.comfortable;
  const w = size.w;
  const h = size.h;
  const gapX = o.gapX ?? size.gapX ?? 24;
  const gapY = o.gapY ?? size.gapY ?? 56;
  const side = o.direction === 'side';
  const stack = !side && o.stack !== false;
  const collapsed = o.collapsed instanceof Set ? o.collapsed : new Set(o.collapsed || []);
  const depthLimit = Number(o.depth) > 0 ? Number(o.depth) : 0;
  const { byId, kids, roots } = forest || { byId: new Map(), kids: new Map(), roots: [] };

  // what is shown under a card: nothing when it is folded, or when the depth asked for ends here
  const shownKids = (id, depth) => {
    const all = kids.get(id) || [];
    if (!all.length) return [];
    if (collapsed.has(id)) return [];
    if (depthLimit && depth + 1 >= depthLimit && !collapsed.has(`open:${id}`)) return [];
    return all;
  };
  const isLeafHere = (id, depth) => !shownKids(id, depth).length;

  const box = new Map();     // id -> {span, tall, stacked, depth}
  const measure = (id, depth) => {
    const mine = shownKids(id, depth);
    if (!mine.length) { box.set(id, { span: side ? h : w, depth, stacked: false, mine }); return side ? h : w; }
    const stacked = stack && mine.length >= STACK_FROM && mine.every((kid) => isLeafHere(kid, depth + 1));
    let span;
    if (stacked) {
      for (const kid of mine) box.set(kid, { span: w, depth: depth + 1, stacked: false, mine: [] });
      span = Math.max(w, INDENT + w);
    } else {
      const gap = side ? Math.min(gapX, 16) : gapX;
      span = Math.max(side ? h : w, mine.reduce((sum, kid) => sum + measure(kid, depth + 1), 0) + gap * (mine.length - 1));
    }
    box.set(id, { span, depth, stacked, mine });
    return span;
  };

  const items = [];
  const links = [];
  let width = 0;
  let height = 0;
  const put = (id, x, y, depth, more = {}) => {
    const node = byId.get(id);
    const all = kids.get(id) || [];
    const b = box.get(id) || { mine: [] };
    items.push({ id, node, x, y, w, h, depth, hidden: b.mine.length ? 0 : (all.length ? node.under || all.length : 0), kids: all.length, ...more });
    width = Math.max(width, x + w);
    height = Math.max(height, y + h);
  };
  const place = (id, start, depth) => {
    const b = box.get(id);
    if (side) {
      // depth runs along x, the siblings down y; `start` is where this subtree's band begins on y
      const x = depth * (w + gapY);
      put(id, x, start + (b.span - h) / 2, depth);
      const gap = Math.min(gapX, 16);
      const inner = b.mine.reduce((sum, kid) => sum + box.get(kid).span, 0) + gap * Math.max(0, b.mine.length - 1);
      let at = start + (b.span - inner) / 2;
      for (const kid of b.mine) { links.push({ from: id, to: kid, kind: 'side' }); place(kid, at, depth + 1); at += box.get(kid).span + gap; }
      return;
    }
    const y = depth * (h + gapY);
    if (b.stacked) {
      put(id, start, y, depth, { stacks: true });
      let at = y + h + STACK_GAP * 2;
      for (const kid of b.mine) {
        links.push({ from: id, to: kid, kind: 'stack' });
        put(kid, start + INDENT, at, depth + 1, { stacked: true });
        at += h + STACK_GAP;
      }
      return;
    }
    put(id, start + (b.span - w) / 2, y, depth);
    const inner = b.mine.reduce((sum, kid) => sum + box.get(kid).span, 0) + gapX * Math.max(0, b.mine.length - 1);
    let at = start + (b.span - inner) / 2;
    for (const kid of b.mine) { links.push({ from: id, to: kid, kind: 'down' }); place(kid, at, depth + 1); at += box.get(kid).span + gapX; }
  };

  let at = 0;
  for (const root of roots) {
    measure(root, 0);
    place(root, at, 0);
    at += box.get(root).span + (side ? gapX : gapX * 2);
  }
  return { items, links, width, height, direction: side ? 'side' : 'down' };
}

/** An item's left edge on the screen: mirrored for a right-to-left reader. */
export function leftOf(item, layout, rtl) {
  return rtl ? layout.width - item.x - item.w : item.x;
}

/**
 * The line between two cards as an SVG path, in the chart's units. `shape`: elbow (square corners, rounded a
 * little), curved, or straight.
 */
export function linkPath(link, byItem, layout, rtl, shape = 'elbow') {
  const a = byItem.get(link.from);
  const b = byItem.get(link.to);
  if (!a || !b) return '';
  const ax = leftOf(a, layout, rtl);
  const bx = leftOf(b, layout, rtl);
  const r = (n) => Math.round(n * 10) / 10;
  if (link.kind === 'stack') {
    // a spine down from under the parent's reading edge, and a short tick to each card of the column
    const spineX = rtl ? ax + a.w - INDENT / 2 : ax + INDENT / 2;
    const toX = rtl ? bx + b.w : bx;
    const y = b.y + b.h / 2;
    return `M ${r(spineX)} ${r(a.y + a.h)} V ${r(y)} H ${r(toX)}`;
  }
  if (link.kind === 'side') {
    const fromX = rtl ? ax : ax + a.w;
    const toX = rtl ? bx + b.w : bx;
    const fromY = a.y + a.h / 2;
    const toY = b.y + b.h / 2;
    const mid = fromX + (toX - fromX) / 2;
    if (shape === 'straight') return `M ${r(fromX)} ${r(fromY)} L ${r(toX)} ${r(toY)}`;
    if (shape === 'curved') return `M ${r(fromX)} ${r(fromY)} C ${r(mid)} ${r(fromY)}, ${r(mid)} ${r(toY)}, ${r(toX)} ${r(toY)}`;
    return `M ${r(fromX)} ${r(fromY)} H ${r(mid)} V ${r(toY)} H ${r(toX)}`;
  }
  const fromX = ax + a.w / 2;
  const fromY = a.y + a.h;
  const toX = bx + b.w / 2;
  const toY = b.y;
  const mid = fromY + (toY - fromY) / 2;
  if (shape === 'straight') return `M ${r(fromX)} ${r(fromY)} L ${r(toX)} ${r(toY)}`;
  if (shape === 'curved') return `M ${r(fromX)} ${r(fromY)} C ${r(fromX)} ${r(mid)}, ${r(toX)} ${r(mid)}, ${r(toX)} ${r(toY)}`;
  return `M ${r(fromX)} ${r(fromY)} V ${r(mid)} H ${r(toX)} V ${r(toY)}`;
}

/** The scale and the offset that show the whole chart inside a box, with room around it. */
export function fitInto(layout, boxWidth, boxHeight, pad = 32, most = 1) {
  const cw = Math.max(1, layout.width);
  const ch = Math.max(1, layout.height);
  const k = Math.max(0.1, Math.min(most, (boxWidth - pad * 2) / cw, (boxHeight - pad * 2) / ch));
  return { k, x: (boxWidth - cw * k) / 2, y: Math.max(pad, (boxHeight - ch * k) / 2) };
}
