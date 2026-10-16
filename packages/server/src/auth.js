// SPDX-License-Identifier: Apache-2.0
/**
 * WHO ASKS, and what each is told.
 *
 *   keeper   someone who keeps the organisation: a keeper key (X-Org-Key: ook_...), or a person signed in through
 *            the organisation's own sign-in whose token carries the keepers' group. Reads everything, changes it.
 *   member   someone of the organisation, signed in through its own sign-in (a token issued to one of
 *            ORG_OIDC_MEMBER_CLIENTS): the whole chart, as a directory shows people to each other; the organisation's
 *            own fields only where they are marked as tellable.
 *   client   an APPLICATION that signs people in through the same sign-in service (it sends the person's token:
 *            `Authorization: Bearer ...`), or a SYSTEM with a key of its own (X-Org-Key: ooc_...). It is told what
 *            its SHARES cover - a part of the chart, to a depth (the structure only, who holds the seats, how to
 *            reach them), and only the fields a share names. The person behind a token is always told their own card.
 *
 * A token is believed only on the sign-in service's own word (its userinfo answer, kept two minutes): this service
 * never judges a token's signature by itself, and when the sign-in service cannot be reached nobody is vouched for.
 * Keys are kept only as their hashes, and shown once.
 */
import crypto from 'node:crypto';
import { OrgError, hashOf, now } from './util.js';

export const KEEPER_PREFIX = 'ook';
export const CLIENT_PREFIX = 'ooc';
export const DEPTHS = ['structure', 'holders', 'contact'];
const TOKEN_MS = 120 * 1000;
const TIMEOUT_MS = 8000;

export class Asker {
  constructor(kind, { person = null, client = null, keeper = null } = {}) {
    Object.assign(this, { kind, person, client, keeper });
  }

  get keeps() { return this.kind === 'keeper'; }

  /** Who this is, for the record of changes. */
  get label() {
    if (this.keeper) return `key:${this.keeper.name}`;
    if (this.person) return this.person.email || `person:${this.person.id}`;
    if (this.client) return `client:${this.client.name}`;
    return this.kind;
  }
}

/** A token's own claims, as written in it (believed only once the sign-in service has vouched for the token). */
function payloadOf(token) {
  try {
    const part = String(token).split('.')[1];
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) || {};
  } catch {
    return {};
  }
}

export class Gate {
  constructor(store, config, log = () => {}) {
    this.store = store;
    this.config = config;
    this.log = log;
    this.vouches = new Map();
    this.userinfo = config.oidc.userinfo || '';
  }

  /** The sign-in service's userinfo address: as set, or discovered from the issuer once. */
  async userinfoUrl() {
    if (this.userinfo) return this.userinfo;
    const issuer = this.config.oidc.issuer;
    if (!issuer) return '';
    try {
      const r = await fetch(`${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      const doc = r.ok ? await r.json() : null;
      if (doc && typeof doc.userinfo_endpoint === 'string' && /^https?:\/\//.test(doc.userinfo_endpoint)) this.userinfo = doc.userinfo_endpoint;
    } catch (err) {
      this.log('warn', `the sign-in service could not be asked where its userinfo is: ${err.message}`);
    }
    return this.userinfo;
  }

  /** The sign-in service's own word about a token: its claims, or null. Asked once and kept for a moment. */
  async vouched(token) {
    if (String(token).length < 20) return null;
    const key = crypto.createHash('sha256').update(String(token)).digest('hex');
    const kept = this.vouches.get(key);
    if (kept && kept.until > Date.now()) return kept.claims;
    const url = await this.userinfoUrl();
    if (!url) return null;
    let claims = null;
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (r.ok && String(r.headers.get('content-type') || '').startsWith('application/json')) {
        const got = await r.json();
        claims = got && typeof got === 'object' && !Array.isArray(got) ? got : null;
      }
    } catch {
      return null;                                         // the sign-in service away: nobody is vouched for (never guessed), nor kept
    }
    if (this.vouches.size > 5000) this.vouches.delete(this.vouches.keys().next().value);
    this.vouches.set(key, { claims, until: Date.now() + TOKEN_MS });
    return claims;
  }

  /** The organisation's person for a sign-in's claims: by its subject, else by the address it carries. */
  personOf(claims) {
    const sub = String(claims.sub || '').trim();
    if (sub) {
      const found = this.store.get('SELECT * FROM people WHERE sub = ? AND active = 1', sub);
      if (found) return found;
    }
    const email = String(claims.email || '').trim();
    if (email) return this.store.get('SELECT * FROM people WHERE email = ? COLLATE NOCASE AND active = 1', email) || null;
    return null;
  }

  byKey(key) {
    const hash = hashOf(key);
    const client = this.store.get("SELECT * FROM clients WHERE key_hash = ? AND key_hash != '' AND active = 1", hash);
    if (client) return new Asker('client', { client });
    const keeper = this.store.get('SELECT * FROM keepers WHERE key_hash = ? AND active = 1', hash);
    if (keeper) {
      this.store.prepared('UPDATE keepers SET last_seen_at = ? WHERE id = ?').run(now(), keeper.id);
      return new Asker('keeper', { keeper });
    }
    return null;
  }

  /** Who asks - or the refusal (thrown). */
  async asker(headers) {
    const key = String(headers['x-org-key'] || '').trim();
    if (key) {
      const found = this.byKey(key);
      if (!found) throw new OrgError('That key opens nothing here.', 'unauthenticated');
      return found;
    }
    const said = String(headers.authorization || '');
    if (/^bearer\s+/i.test(said)) {
      const token = said.replace(/^bearer\s+/i, '').trim();
      if (token.startsWith(`${KEEPER_PREFIX}_`) || token.startsWith(`${CLIENT_PREFIX}_`)) {
        const found = this.byKey(token);
        if (!found) throw new OrgError('That key opens nothing here.', 'unauthenticated');
        return found;
      }
      const claims = await this.vouched(token);
      if (!claims) throw new OrgError('The sign-in service does not vouch for that token.', 'unauthenticated');
      const own = payloadOf(token);
      const audiences = Array.isArray(own.aud) ? own.aud : [own.aud];
      const ids = [own.azp, ...audiences].filter(Boolean).map(String);
      const person = this.personOf(claims);
      if (ids.some((id) => this.config.oidc.memberClients.includes(id))) {
        const groups = Array.isArray(claims.groups) ? claims.groups.map(String) : [];
        const keeps = !!this.config.oidc.keeperGroup && groups.includes(this.config.oidc.keeperGroup);
        if (!person && !keeps) throw new OrgError('Nobody the organisation knows signed in.', 'forbidden');
        return new Asker(keeps ? 'keeper' : 'member', { person });
      }
      const client = ids.length
        ? this.store.all("SELECT * FROM clients WHERE active = 1 AND client_id != ''").find((c) => ids.includes(c.client_id)) : null;
      if (!client) throw new OrgError('The application this token was issued to is not known to the organisation.', 'unknown_client');
      return new Asker('client', { person, client });
    }
    throw new OrgError('Send a key (X-Org-Key), or the token of your sign-in.', 'unauthenticated');
  }
}

// ── what a client's shares cover ────────────────────────────────────────────────────────────────────────────

/** What an asker may be told, on a day. */
export class Cover {
  constructor(store, chart, who, day, tellableOf) {
    this.who = who;
    this.day = day;
    this.all = who.kind !== 'client';
    this.depthOf = new Map();
    this.fieldsOf = new Map();
    this.shareOf = new Map();
    this.shares = [];
    this.tellableOf = tellableOf;
    if (who.kind !== 'client') return;
    this.shares = store.all(`SELECT * FROM shares WHERE client_id = ? AND active = 1 AND (valid_from IS NULL OR valid_from <= ?)
      AND (valid_to IS NULL OR valid_to >= ?) ORDER BY created_at`, who.client.id, day, day)
      .map((s) => ({ ...s, fields: safeList(s.fields) }));
    const depts = [...chart.depts.values()].filter((d) => d.organisation_id === who.client.organisation_id);
    for (const share of this.shares) {
      for (const dept of depts) {
        if (share.department_id && !chart.within(dept.id, share.department_id)) continue;
        const had = this.depthOf.get(dept.id);
        if (had === undefined || DEPTHS.indexOf(share.depth) > DEPTHS.indexOf(had)) {
          this.depthOf.set(dept.id, share.depth);
          this.shareOf.set(dept.id, share);
        }
        if (!this.fieldsOf.has(dept.id)) this.fieldsOf.set(dept.id, new Set());
        for (const k of share.fields) this.fieldsOf.get(dept.id).add(String(k));
      }
    }
  }

  depth(deptId) {
    return this.all ? 'contact' : (this.depthOf.get(deptId) ?? null);
  }

  /** Which of the organisation's own fields of `target` may be told: null = all of them. */
  tellable(target, organisation, deptId = null) {
    if (this.who.kind === 'keeper') return null;
    const marked = this.tellableOf(target, organisation);
    if (this.all) return marked;
    let named;
    if (deptId !== null && deptId !== undefined) named = this.fieldsOf.get(deptId) || new Set();
    else named = new Set([...this.fieldsOf.values()].flatMap((s) => [...s]));
    return new Set([...marked].filter((k) => named.has(k)));
  }

  /** [depth, a department that covers them] for a person: the deepest share over a seat they hold. */
  ofPerson(person, chart) {
    if (this.all) return ['contact', null];
    let best = null;
    let where = null;
    for (const seatId of chart.seatsOf.get(person.id) || []) {
      const deptId = chart.seats.get(seatId).department_id;
      const depth = this.depthOf.get(deptId);
      if (depth !== undefined && (best === null || DEPTHS.indexOf(depth) > DEPTHS.indexOf(best))) { best = depth; where = deptId; }
    }
    return [best, where];
  }
}

function safeList(text) {
  try { const got = JSON.parse(text || '[]'); return Array.isArray(got) ? got : []; } catch { return []; }
}

/** A client's question, written down against the share that answered it. */
export function note(store, who, cover, what, { about = '', deptId = null, answered = true } = {}) {
  if (who.kind !== 'client') return;
  const share = deptId !== null && deptId !== undefined ? cover.shareOf.get(deptId) : cover.shares[0];
  const subject = who.person ? (who.person.sub || who.person.email || '') : '';
  store.prepared('INSERT INTO access_log (client_id, share_id, subject, what, about, answered, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(who.client.id, share ? share.id : null, String(subject).slice(0, 255), String(what).slice(0, 64), String(about).slice(0, 255), answered ? 1 : 0, now());
  store.prepared('UPDATE clients SET last_seen_at = ? WHERE id = ?').run(now(), who.client.id);
}
