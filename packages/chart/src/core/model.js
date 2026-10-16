// SPDX-License-Identifier: Apache-2.0
/**
 * WHAT THE CHART DRAWS.
 *
 * One organisation, three charts — the reader chooses which (`draws`):
 *
 *   departments   the structure: a card per department, under the one it belongs to
 *   positions     the classic chart: a card per SEAT with who holds it, under the seat it answers to
 *   people        who answers to whom: a card per person, under their manager
 *
 * Each becomes the same thing — a flat list of NODES with a `parent` — so one layout and one drawing serve all
 * three. WHO IS UNDER WHOM is never worked out here: a department's parent is the chart's own, and a seat's and a
 * person's line is the organisation's answer (`GET /api/org/v1/reporting`: the one rule, on the server).
 *
 *   node = { id, kind, parent, title, sub, face: {id, name, email} | null, vacant, head, inactive,
 *            people, seats, vacantSeats, code, branch, level, ref }
 *
 * `branch` is the top-level ancestor's id and `level` the depth (0 at the top) — what the colours go by.
 *
 * PURE MODULE. No React, no requests.
 */

export const DRAWS = ['departments', 'positions', 'people'];

const text = (v) => (v === undefined || v === null ? '' : String(v));
const holdersNow = (seat) => (Array.isArray(seat.holders) ? seat.holders : [])
  .filter((h) => h && (h.current !== false) && !(h.valid_to && String(h.valid_to) < new Date().toISOString().slice(0, 10)))
  .map((h) => h.person || h).filter((p) => p && (p.id || p.name || p.email));

/**
 * The structure: one node per department of the tree (`GET /api/org/v1/tree`). A department that does not say how
 * many people it holds (`people_count`) is counted here: everyone holding a seat in it or under it, once each.
 */
export function departmentNodes(departments) {
  const list = (Array.isArray(departments) ? departments : []).filter((d) => d && d.id !== undefined && d.id !== null);
  const known = new Set(list.map((d) => String(d.id)));
  const counted = peopleUnder(list, known);
  return list.map((d) => {
    const seats = (Array.isArray(d.positions) ? d.positions : []).filter((p) => p && p.active !== false);
    const vacantSeats = seats.filter((p) => !holdersNow(p).length).length;
    const headSeat = seats.find((p) => p.is_head);
    const head = d.head && typeof d.head === 'object' ? d.head : null;
    return {
      id: `d:${d.id}`, kind: 'department', parent: d.parent !== null && d.parent !== undefined && known.has(String(d.parent)) ? `d:${d.parent}` : null,
      title: text(d.name), sub: head ? text(head.name || head.email) : '',
      face: head ? { id: head.id, name: text(head.name), email: text(head.email) } : null,
      vacant: !!headSeat && !head, head: false, noHead: !headSeat, inactive: d.is_active === false,
      people: Number.isFinite(Number(d.people_count)) && d.people_count !== null && d.people_count !== undefined && d.people_count !== ''
        ? Number(d.people_count) : counted.get(String(d.id)) || 0,
      seats: seats.length, vacantSeats, code: '', ref: d,
    };
  });
}

/** How many people hold a seat in each department or under it: {department id: count}, each person once. */
function peopleUnder(list, known) {
  const kids = new Map();
  for (const d of list) {
    const parent = d.parent !== null && d.parent !== undefined && known.has(String(d.parent)) ? String(d.parent) : null;
    if (parent === null) continue;
    if (!kids.has(parent)) kids.set(parent, []);
    kids.get(parent).push(String(d.id));
  }
  const own = new Map(list.map((d) => [String(d.id), new Set((Array.isArray(d.positions) ? d.positions : [])
    .filter((p) => p && p.active !== false).flatMap(holdersNow).map((p) => String(p.id ?? p.email ?? p.name)))]));
  const out = new Map();
  const walk = (id, seen) => {
    if (seen.has(id)) return new Set();
    seen.add(id);
    const all = new Set(own.get(id) || []);
    for (const kid of kids.get(id) || []) for (const one of walk(kid, seen)) all.add(one);
    out.set(id, all.size);
    return all;
  };
  for (const d of list) if (!out.has(String(d.id))) walk(String(d.id), new Set());
  return out;
}

/** The classic chart: one node per seat, under the seat it answers to (`reporting.seats`). */
export function positionNodes(seats) {
  const list = (Array.isArray(seats) ? seats : []).filter((s) => s && s.id);
  const known = new Set(list.map((s) => String(s.id)));
  return list.map((s) => {
    const holders = (Array.isArray(s.holders) ? s.holders : []).filter(Boolean);
    const first = holders[0] || null;
    return {
      id: `s:${s.id}`, kind: 'position', parent: s.answers_to && known.has(String(s.answers_to)) ? `s:${s.answers_to}` : null,
      title: text(s.title), sub: first ? text(first.name || first.email) : '', more: Math.max(0, holders.length - 1),
      face: first ? { id: first.id, name: text(first.name), email: text(first.email) } : null,
      vacant: !holders.length, head: !!s.is_head, inactive: false, people: holders.length, seats: 0, vacantSeats: 0,
      code: text(s.code), place: text(s.department), ref: s,
    };
  });
}

/** Who answers to whom: one node per person, under their manager (`reporting.people`). */
export function peopleNodes(people) {
  const list = (Array.isArray(people) ? people : []).filter((p) => p && p.id !== undefined && p.id !== null);
  const known = new Set(list.map((p) => String(p.id)));
  return list.map((p) => ({
    id: `p:${p.id}`, kind: 'person', parent: p.manager !== null && p.manager !== undefined && known.has(String(p.manager)) ? `p:${p.manager}` : null,
    title: text(p.name || p.email), sub: text(p.position), place: text(p.department),
    face: { id: p.id, name: text(p.name), email: text(p.email) },
    vacant: false, head: !!p.is_head, inactive: false, people: 0, seats: 0, vacantSeats: 0, code: '', ref: p,
  }));
}

/**
 * The nodes as a forest: `{nodes, byId, kids, roots, branches}` — with every node's `level`, `branch` and how many are under
 * it (`under`). A line that would close a circle is cut (the node becomes a root): a chart is always drawn.
 */
export function forest(nodes) {
  const list = (Array.isArray(nodes) ? nodes : []).map((n) => ({ ...n }));
  const byId = new Map(list.map((n) => [n.id, n]));
  // a circle of lines (never the organisation's answer, but a chart must draw whatever it is handed)
  for (const n of list) {
    const seen = new Set([n.id]);
    let at = n.parent ? byId.get(n.parent) : null;
    while (at) {
      if (seen.has(at.id)) { n.parent = null; break; }
      seen.add(at.id);
      at = at.parent ? byId.get(at.parent) : null;
    }
    if (n.parent && !byId.has(n.parent)) n.parent = null;
  }
  const kids = new Map();
  for (const n of list) {
    if (!n.parent) continue;
    if (!kids.has(n.parent)) kids.set(n.parent, []);
    kids.get(n.parent).push(n.id);
  }
  const roots = list.filter((n) => !n.parent).map((n) => n.id);
  // a BRANCH is what a reader tells apart at a glance: under one top card, each thing right under it (and the top
  // itself); with several tops, each top
  const single = roots.length === 1;
  const walk = (id, level, branch) => {
    const n = byId.get(id);
    n.level = level;
    n.branch = single && level <= 1 ? id : branch;
    let under = 0;
    for (const kid of kids.get(id) || []) under += 1 + walk(kid, level + 1, n.branch);
    n.under = under;
    return under;
  };
  for (const id of roots) walk(id, 0, id);
  const branches = single ? [roots[0], ...(kids.get(roots[0]) || [])] : roots;
  // a person's card counts who answers to them, directly and in all (the departments carry their own counts)
  for (const n of list) if (n.kind === 'person') n.people = n.under;
  return { nodes: list, byId, kids, roots, branches };
}

/** The nodes of what is asked for: `data = {departments, reporting: {people, seats}}`. */
export function nodesOf(draws, data) {
  const d = data || {};
  if (draws === 'people') return peopleNodes(d.reporting && d.reporting.people);
  if (draws === 'positions') return positionNodes(d.reporting && d.reporting.seats);
  return departmentNodes(d.departments);
}

/** Everything a search may find a node by, lower-cased. */
export function wordsOf(node) {
  return [node.title, node.sub, node.place, node.code, node.face && node.face.name, node.face && node.face.email]
    .filter(Boolean).join(' ').toLowerCase();
}

/** The nodes a search finds, best first (a title that starts with the words before one that only holds them). */
export function findNodes(nodes, query, limit = 12) {
  const wanted = text(query).trim().toLowerCase();
  if (!wanted) return [];
  const hit = (Array.isArray(nodes) ? nodes : []).filter((n) => wordsOf(n).includes(wanted));
  hit.sort((a, b) => (Number(!text(a.title).toLowerCase().startsWith(wanted)) - Number(!text(b.title).toLowerCase().startsWith(wanted)))
    || text(a.title).localeCompare(text(b.title)));
  return hit.slice(0, limit);
}

/** The ids from a node up to its root, itself first. */
export function chainOf(byId, id) {
  const out = [];
  let at = byId.get(id);
  const seen = new Set();
  while (at && !seen.has(at.id)) { out.push(at.id); seen.add(at.id); at = at.parent ? byId.get(at.parent) : null; }
  return out;
}

/** Two letters for a face with no picture. */
export function initials(name) {
  const parts = text(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  const first = Array.from(parts[0])[0] || '';
  const last = parts.length > 1 ? Array.from(parts[parts.length - 1])[0] || '' : '';
  // two letters of a joining script would join into one shape: kept apart
  const apart = last && /[\u0600-\u06FF]/.test(first + last) ? '\u200c' : '';
  return (first + apart + last).toUpperCase();
}
