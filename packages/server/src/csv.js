// SPDX-License-Identifier: Apache-2.0
/** CSV read and written by hand: RFC 4180 (quotes, doubled quotes, line breaks inside quotes), a BOM, `,` `;` or a tab. */

export function parseCsv(text, most = 20001) {
  const src = String(text || '').replace(/^﻿/, '');
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const sep = [',', ';', '\t'].map((s) => [s, firstLine.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') { quoted = true; continue; }
    if (ch === sep) { row.push(cell); cell = ''; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      if (rows.length > most) break;
      continue;
    }
    cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== '')) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((cells) => Object.fromEntries(head.map((h, i) => [h, (cells[i] ?? '').trim()])));
}

/**
 * A cell, written: quoted when it must be, and never read by a spreadsheet as a formula (a value that begins with
 * = + - @ or a control character is written with a ' before it).
 */
export function cellOf(value) {
  let said = value === null || value === undefined ? '' : typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value);
  if (/^[=+\-@\t\r]/.test(said)) said = `'${said}`;
  return /[",\r\n;]/.test(said) ? `"${said.replace(/"/g, '""')}"` : said;
}

export function writeCsv(columns, rows) {
  return `﻿${[columns.join(','), ...rows.map((r) => columns.map((c) => cellOf(r[c])).join(','))].join('\r\n')}\r\n`;
}
