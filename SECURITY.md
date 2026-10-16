# Security

## Reporting a vulnerability

Please report it privately through GitHub: **Security → Report a vulnerability** on this repository. Do not open a
public issue. We will acknowledge it within a few days and keep you informed until it is fixed.

## How the service is built to be safe

* **Who may ask**:
  * Keepers, with keeper keys or the keepers' group in the organisation's own sign-in.
  * Members, with the organisation's own sign-in.
  * Applications, with a person's token issued to a registered client.
  * Systems, with a key of their own.
* **Keys**: 32 random bytes, shown once, and kept only as their SHA-256 hash.
* **Tokens**: never judged by their signature here. They are believed only on the sign-in service's own word (its
  OpenID Connect userinfo endpoint), and that answer is kept for two minutes. When the sign-in service cannot be
  reached, nobody is vouched for.
* **What applications see**: only what a share gives (a part of the chart, a depth, fields marked tellable). Every
  question an application asks, answered or refused, is written to the access log.
* **Changes**: every change is written down (who, what, before and after).
* **Input**: SQL is prepared with bound values, bodies are JSON (or CSV for an import) within a size limit, and
  dates, e-mail addresses, field values and identifiers are all checked.
* **Abuse limits**: a token bucket per address, a limit on failed sign-ins, and HTTP time limits.
* **Response headers**: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`,
  a strict Content-Security-Policy, `Cache-Control: no-store`, and HSTS on request. CORS is allowed only for the
  origins named. No cookies are used.
* **Exports**: spreadsheet cells that begin with `= + - @` are written so they are never read as a formula.
* **The container**: an unprivileged user, a read-only root filesystem, no capabilities, and no runtime dependencies.
