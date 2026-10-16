// SPDX-License-Identifier: Apache-2.0
/**
 * The service over HTTP, with nothing but Node's own `http`: the routes, who asks, what a request may carry, and
 * what every answer wears.
 *
 * Every answer: JSON (or the file asked for), never cached, `nosniff`, no referrer, never framed, a Content-Security-
 * Policy, HSTS when it stands behind TLS. A body is read only when it is JSON (or CSV for an import) and no larger
 * than its limit. One address may ask so often (a token bucket), and fail to sign in only so often. A browser on
 * another site may ask only when that site is named (ORG_CORS_ORIGINS); no cookie is ever read or set, so nothing
 * a page does in a person's browser can act for them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Gate } from './auth.js';
import * as keepers from './keepers.js';
import { OrgError } from './util.js';
import * as v1 from './v1.js';
import { VERSION } from './version.js';

const ASKS = '(manager|chain|reports|peers)';
const KINDS = '(organisations|departments|positions|people|assignments|fields|clients|shares|keepers)';
const RESOURCES = { organisations: keepers.organisations, departments: keepers.departments, positions: keepers.positions, people: keepers.people,
  assignments: keepers.assignments, fields: keepers.fields, clients: keepers.clients, shares: keepers.shares, keepers: keepers.keepers };

/** [method, path pattern, what answers, what body it reads ('json' | 'import' | null)] */
const ROUTES = [
  ['GET', /^\/api\/org\/v1\/?$/, (ctx) => v1.index(ctx)],
  ['GET', /^\/api\/org\/v1\/me\/?$/, (ctx) => v1.person(ctx, 'me')],
  ['GET', new RegExp(`^/api/org/v1/me/${ASKS}/?$`), (ctx, ask) => v1.person(ctx, 'me', ask)],
  ['GET', /^\/api\/org\/v1\/people\/([^/]+)\/?$/, (ctx, ref) => v1.person(ctx, ref)],
  ['GET', new RegExp(`^/api/org/v1/people/([^/]+)/${ASKS}/?$`), (ctx, ref, ask) => v1.person(ctx, ref, ask)],
  ['GET', /^\/api\/org\/v1\/claims\/([^/]+)\/?$/, (ctx, ref) => v1.claims(ctx, ref)],
  ['GET', /^\/api\/org\/v1\/tree\/?$/, (ctx) => v1.tree(ctx)],
  ['GET', /^\/api\/org\/v1\/reporting\/?$/, (ctx) => v1.reporting(ctx)],
  ['GET', /^\/api\/org\/v1\/departments\/([^/]+)\/?$/, (ctx, id) => v1.department(ctx, id)],
  ['GET', /^\/api\/org\/v1\/fields\/?$/, (ctx) => v1.fields(ctx)],
  ['GET', /^\/api\/org\/pillar\/access\/?$/, (ctx) => keepers.access(ctx)],
  ['GET', /^\/api\/org\/pillar\/changes\/?$/, (ctx) => keepers.changes(ctx)],
  ['POST', /^\/api\/org\/pillar\/import\/?$/, (ctx) => keepers.importBody(ctx), 'import'],
  ['GET', /^\/api\/org\/pillar\/export\/?$/, (ctx) => keepers.exportAll(ctx)],
  ['POST', /^\/api\/org\/pillar\/clients\/([^/]+)\/key\/?$/, (ctx, id) => keepers.clients.key(ctx, id), 'json'],
  ['GET', new RegExp(`^/api/org/pillar/${KINDS}/?$`), (ctx, kind) => RESOURCES[kind].list(ctx)],
  ['POST', new RegExp(`^/api/org/pillar/${KINDS}/?$`), (ctx, kind) => RESOURCES[kind].create(ctx), 'json'],
  ['GET', new RegExp(`^/api/org/pillar/${KINDS}/([^/]+)/?$`), (ctx, kind, id) => (RESOURCES[kind].read ? RESOURCES[kind].read(ctx, id) : notAllowed())],
  ['PATCH', new RegExp(`^/api/org/pillar/${KINDS}/([^/]+)/?$`), (ctx, kind, id) => (RESOURCES[kind].change ? RESOURCES[kind].change(ctx, id) : notAllowed()), 'json'],
  ['DELETE', new RegExp(`^/api/org/pillar/${KINDS}/([^/]+)/?$`), (ctx, kind, id) => RESOURCES[kind].remove(ctx, id)],
];

function notAllowed() { throw new OrgError('That cannot be done here.', 'not_allowed'); }

const STATIC_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8' };
const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";
const PAGE_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

/** A token bucket for each address: `rate` a second on average, `burst` at once. */
class Buckets {
  constructor(rate, burst) { Object.assign(this, { rate, burst, of: new Map() }); }
  take(who, n = 1) {
    const at = Date.now();
    let b = this.of.get(who);
    if (!b) {
      if (this.of.size > 20000) for (const [k, v] of this.of) if (at - v.at > 600000) this.of.delete(k);
      b = { tokens: this.burst, at };
      this.of.set(who, b);
    }
    b.tokens = Math.min(this.burst, b.tokens + ((at - b.at) / 1000) * this.rate);
    b.at = at;
    if (b.tokens < n) return Math.ceil((n - b.tokens) / this.rate);
    b.tokens -= n;
    return 0;
  }
  has(who) { const b = this.of.get(who); return !b || b.tokens + ((Date.now() - b.at) / 1000) * this.rate >= 1; }
}

export function createApp({ store, config, log = () => {}, publicDir = null }) {
  const gate = new Gate(store, config, log);
  const requests = new Buckets(config.rate, config.burst);
  const failures = new Buckets(20 / 300, 20);               // 20 failed sign-ins in five minutes, then a pause
  const pages = config.public && publicDir && fs.existsSync(path.join(publicDir, 'index.html')) ? path.resolve(publicDir) : null;

  const addressOf = (req) => {
    if (config.trustProxy) {
      const first = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      if (first) return first;
    }
    return req.socket.remoteAddress || '';
  };

  const corsFor = (origin) => {
    if (!origin) return null;
    if (config.cors.includes('*')) return '*';
    return config.cors.includes(origin) ? origin : null;
  };

  function headers(res, { page = false, origin = null } = {}) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    res.setHeader('Content-Security-Policy', page ? PAGE_CSP : API_CSP);
    if (config.hsts) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Retry-After');
      res.setHeader('Vary', 'Origin');
    }
  }

  function send(res, status, body, extra = {}) {
    if (status === 204) { res.writeHead(204, extra); res.end(); return; }
    const raw = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(raw), ...extra });
    res.end(raw);
  }

  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      const declared = Number(req.headers['content-length']);
      if (Number.isFinite(declared) && declared > limit) { reject(new OrgError('That is more than this service reads at once.', 'too_large')); return; }
      const parts = [];
      let size = 0;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > limit) { req.pause(); reject(new OrgError('That is more than this service reads at once.', 'too_large')); return; }
        parts.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
      req.on('error', reject);
    });
  }

  async function bodyOf(req, kind) {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (kind === 'import' && (type === 'text/csv' || type === 'text/plain')) return readBody(req, config.importLimit);
    if (type !== 'application/json') throw new OrgError('Send JSON (Content-Type: application/json)', 'unsupported');
    const raw = await readBody(req, kind === 'import' ? config.importLimit : config.bodyLimit);
    if (!raw.trim()) return {};
    try { return JSON.parse(raw); } catch { throw new OrgError('That is not JSON.', 'invalid'); }
  }

  function serveFile(req, res, pathname) {
    if (!pages || (req.method !== 'GET' && req.method !== 'HEAD')) return false;
    const wanted = pathname === '/' ? '/index.html' : pathname;
    if (!/^\/[A-Za-z0-9._\-/]+$/.test(wanted) || wanted.includes('..')) return false;
    const file = path.resolve(pages, `.${wanted}`);
    if (!file.startsWith(pages + path.sep) || !STATIC_TYPES[path.extname(file)] || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
    headers(res, { page: true });
    const data = fs.readFileSync(file);
    res.writeHead(200, { 'Content-Type': STATIC_TYPES[path.extname(file)], 'Content-Length': data.length, 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
    return true;
  }

  return async function handle(req, res) {
    const started = Date.now();
    let status = 500;
    const address = addressOf(req);
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { url = new URL('http://localhost/'); }
    const pathname = url.pathname;
    const origin = corsFor(req.headers.origin);
    try {
      if (pathname === '/healthz') {
        headers(res);
        send(res, status = 200, { ok: true, service: 'open-orgchart', version: VERSION });
        return;
      }
      const isApi = pathname.startsWith('/api/');
      if (!isApi) {
        if (serveFile(req, res, pathname)) { status = 200; return; }
        throw new OrgError('Nothing is here.', 'not_found');
      }
      headers(res, { origin });
      if (req.method === 'OPTIONS') {
        if (!origin) throw new OrgError('This page may not ask from a browser.', 'forbidden');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, X-Org-Key, Content-Type');
        res.setHeader('Access-Control-Max-Age', '600');
        send(res, status = 204);
        return;
      }
      const wait = requests.take(address);
      if (wait) { res.setHeader('Retry-After', String(wait)); throw new OrgError('Too many questions at once: wait a moment.', 'rate_limited'); }
      let matched = null;
      const allowed = new Set();
      for (const [method, pattern, answer, reads] of ROUTES) {
        const m = pattern.exec(pathname);
        if (!m) continue;
        allowed.add(method);
        if (method === req.method) { matched = { answer, reads, params: m.slice(1) }; break; }
      }
      if (!matched) {
        if (allowed.size) { res.setHeader('Allow', [...allowed].join(', ')); throw new OrgError('That cannot be done here.', 'not_allowed'); }
        throw new OrgError('Nothing is here.', 'not_found');
      }
      let params;
      try { params = matched.params.map((p) => decodeURIComponent(p)); } catch { throw new OrgError('That address cannot be read.', 'invalid'); }
      if (!failures.has(address)) { res.setHeader('Retry-After', '60'); throw new OrgError('Too many failed sign-ins from here: wait a while.', 'rate_limited'); }
      let who;
      try {
        who = await gate.asker(req.headers);
      } catch (err) {
        if (err instanceof OrgError && err.status === 401) failures.take(address);
        throw err;
      }
      const ctx = { store, config, who, query: url.searchParams, body: matched.reads ? await bodyOf(req, matched.reads) : null, log };
      const out = await matched.answer(ctx, ...params);
      if (out && out.raw !== undefined) {
        status = 200;
        res.writeHead(200, { 'Content-Type': out.type, 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="${out.file}"`, 'Content-Length': Buffer.byteLength(out.raw) });
        res.end(out.raw);
        return;
      }
      if (out && out.status) { send(res, status = out.status, out.body); return; }
      send(res, status = 200, out);
    } catch (err) {
      if (err instanceof OrgError) {
        status = err.status;
        if (err.code === 'too_large' && !res.headersSent) res.setHeader('Connection', 'close');   // what is left of the body is not read
        if (!res.headersSent) { if (!res.getHeader('Content-Security-Policy')) headers(res, { origin }); send(res, status, { error: err.message, code: err.code, ...(err.details || {}) }); }
      } else {
        status = 500;
        log('error', `${req.method} ${pathname}: ${err && err.stack ? err.stack : err}`);
        if (!res.headersSent) { if (!res.getHeader('Content-Security-Policy')) headers(res, { origin }); send(res, 500, { error: 'Something went wrong here.', code: 'error' }); }
        else res.destroy();
      }
    } finally {
      log('info', `${req.method} ${pathname} ${status} ${Date.now() - started}ms`);
    }
  };
}
