// SPDX-License-Identifier: Apache-2.0
/**
 * THE CHART, TAKEN OUT.
 *
 *   a picture   SVG (the drawing itself: it stays sharp at any size and opens in a vector editor), PNG (for a
 *               slide or a message) and PDF (for print) - all three are the standalone SVG of svg.js, the
 *               last two painted from it here, in the browser: nothing is sent anywhere to make them
 *   the data    CSV, Excel or JSON - made by whoever keeps the organisation (the `exportData` the chart is
 *               handed; the service answers `GET /api/org/pillar/export?format=csv|json`)
 *
 * A PDF is written here by hand: one page the size of the picture, holding it as a JPEG. That is the whole of what
 * a PDF needs to be for this, and it keeps a library out of the bundle.
 */

export const PICTURES = ['png', 'svg', 'pdf'];
export const TABLES = ['xlsx', 'csv', 'json'];
/** The longest side a canvas is asked for: past this browsers answer an empty picture. */
export const MOST_PIXELS = 12000;

const MIME = { svg: 'image/svg+xml;charset=utf-8', png: 'image/png', pdf: 'application/pdf', csv: 'text/csv', json: 'application/json',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

/** A file name from what the chart is of and the day: `organisation-departments-2026-10-10.png`. */
export function fileName(what, kind, day = new Date()) {
  const stamp = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  const slug = String(what || 'chart').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'chart';
  return `organisation-${slug}-${stamp}.${kind}`;
}

/** Hand a Blob to the person as a file. */
export function save(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const svgBlob = (svg) => new Blob([svg], { type: MIME.svg });

/** The size written on an SVG: {width, height}. */
export function sizeOf(svg) {
  const m = /<svg[^>]*\swidth="([\d.]+)"[^>]*\sheight="([\d.]+)"/.exec(String(svg || ''));
  return m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 0, height: 0 };
}

/** The scale a picture can be painted at: the one asked for, lowered until its longest side fits a canvas. */
export function scaleFor(size, asked = 2) {
  const longest = Math.max(1, size.width, size.height);
  return Math.max(0.25, Math.min(asked, MOST_PIXELS / longest));
}

/** The SVG painted on a canvas at `scale`. */
export async function paint(svg, scale = 2) {
  const size = sizeOf(svg);
  const k = scaleFor(size, scale);
  const url = URL.createObjectURL(svgBlob(svg));
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('The picture could not be drawn.')); img.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(size.width * k);
    canvas.height = Math.round(size.height * k);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const blobOf = (canvas, type, quality) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The picture could not be made.'))), type, quality);
});

export async function pngBlob(svg, scale = 2) {
  return blobOf(await paint(svg, scale), MIME.png);
}

/**
 * A one-page PDF holding a JPEG: `jpeg` its bytes (Uint8Array), `pixels` its size, `points` the page's size
 * (1/72 inch). Returns the file's bytes.
 */
export function pdfOf(jpeg, pixels, points) {
  const enc = new TextEncoder();
  const parts = [];
  const offsets = [];
  let length = 0;
  const add = (chunk) => { const bytes = typeof chunk === 'string' ? enc.encode(chunk) : chunk; parts.push(bytes); length += bytes.length; };
  const obj = (n, body) => { offsets[n] = length; add(`${n} 0 obj\n`); body(); add('\nendobj\n'); };
  const w = Math.round(points.width * 100) / 100;
  const h = Math.round(points.height * 100) / 100;
  const draw = `q\n${w} 0 0 ${h} 0 0 cm\n/Im0 Do\nQ\n`;
  add('%PDF-1.4\n%âãÏÓ\n');
  obj(1, () => add('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => add('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
  obj(3, () => add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`));
  obj(4, () => {
    add(`<< /Type /XObject /Subtype /Image /Width ${pixels.width} /Height ${pixels.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
    add(jpeg);
    add('\nendstream');
  });
  obj(5, () => add(`<< /Length ${draw.length} >>\nstream\n${draw}endstream`));
  const xref = length;
  add(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((n) => `${String(offsets[n]).padStart(10, '0')} 00000 n \n`).join('')}`);
  add(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

export async function pdfBlob(svg, scale = 2) {
  const size = sizeOf(svg);
  const canvas = await paint(svg, scale);
  // a JPEG has no see-through: the paper is already painted by the SVG's own background
  const jpeg = new Uint8Array(await (await blobOf(canvas, 'image/jpeg', 0.92)).arrayBuffer());
  // a CSS pixel is 1/96 inch, a point 1/72
  const bytes = pdfOf(jpeg, { width: canvas.width, height: canvas.height }, { width: size.width * 0.75, height: size.height * 0.75 });
  return new Blob([bytes], { type: MIME.pdf });
}

/** A picture of the chart as a Blob: `kind` one of PICTURES. */
export async function pictureBlob(svg, kind, scale = 2) {
  if (kind === 'svg') return svgBlob(svg);
  if (kind === 'pdf') return pdfBlob(svg, scale);
  return pngBlob(svg, scale);
}
