// SPDX-License-Identifier: Apache-2.0
/**
 * The service's settings, from the environment. Every one has a safe default: on its own it listens on 8080, keeps
 * its database in ./data, answers no other web page (no CORS), and trusts no sign-in service until one is named.
 *
 *   ORG_PORT, ORG_HOST          where it listens (8080, 0.0.0.0)
 *   ORG_DATA                    the folder its database lives in (./data); ORG_DB to name the file itself
 *   ORG_TZ                      the organisation's time zone: what "today" is (the server's own)
 *   ORG_CORS_ORIGINS            the web pages that may ask from a browser, comma separated (none); * for any
 *   ORG_TRUST_PROXY             1 when it stands behind a proxy that sets X-Forwarded-For (0)
 *   ORG_RATE                    requests a second one address may make, on average (20); ORG_BURST at once (60)
 *   ORG_BODY_LIMIT              the largest body it reads, in bytes (1 MB); an import may be ORG_IMPORT_LIMIT (8 MB)
 *   ORG_OIDC_ISSUER             the sign-in service (OpenID Connect) whose tokens it accepts, e.g. https://auth.example.com/application/o/org/
 *   ORG_OIDC_USERINFO_URL       its userinfo address, when it cannot be discovered from the issuer
 *   ORG_OIDC_MEMBER_CLIENTS     client ids whose tokens are the organisation's own people asking (comma separated)
 *   ORG_OIDC_KEEPER_GROUP       a group (in the token's `groups`) whose members keep the organisation
 *   ORG_KEEPER_KEY              the first keeper key, when there is none yet (at least 32 characters)
 *   ORG_PUBLIC                  0 to serve no viewer page, only the API (1)
 *   ORG_HSTS                    1 to tell browsers to come back over HTTPS only (behind a TLS proxy) (0)
 */
import path from 'node:path';

const list = (value) => String(value || '').split(',').map((s) => s.trim()).filter(Boolean);
const number = (value, fallback, low, high) => {
  const n = Number(value);
  return Number.isFinite(n) && value !== '' && value !== undefined ? Math.min(high, Math.max(low, n)) : fallback;
};
const yes = (value, fallback = false) => (value === undefined || value === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase()));

export function loadConfig(env = process.env) {
  const data = path.resolve(env.ORG_DATA || 'data');
  return {
    port: number(env.ORG_PORT, 8080, 0, 65535),
    host: env.ORG_HOST || '0.0.0.0',
    data,
    db: env.ORG_DB || path.join(data, 'orgchart.db'),
    timeZone: env.ORG_TZ || undefined,
    cors: list(env.ORG_CORS_ORIGINS),
    trustProxy: yes(env.ORG_TRUST_PROXY),
    rate: number(env.ORG_RATE, 20, 1, 10000),
    burst: number(env.ORG_BURST, 60, 1, 100000),
    bodyLimit: number(env.ORG_BODY_LIMIT, 1024 * 1024, 1024, 64 * 1024 * 1024),
    importLimit: number(env.ORG_IMPORT_LIMIT, 8 * 1024 * 1024, 1024, 256 * 1024 * 1024),
    oidc: {
      issuer: (env.ORG_OIDC_ISSUER || '').trim(),
      userinfo: (env.ORG_OIDC_USERINFO_URL || '').trim(),
      memberClients: list(env.ORG_OIDC_MEMBER_CLIENTS),
      keeperGroup: (env.ORG_OIDC_KEEPER_GROUP || '').trim(),
    },
    keeperKey: env.ORG_KEEPER_KEY || '',
    public: yes(env.ORG_PUBLIC, true),
    hsts: yes(env.ORG_HSTS),
  };
}
