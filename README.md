# open-orgchart

An organisation chart that runs on its own: a small, secure service that keeps an organisation's structure, and a
chart that draws it.

* **The structure**: departments in a tree, positions (seats) in them, people holding seats from one day until
  another (primary or acting), and fields of the organisation's own (a grade, a cost centre, a location). One
  service can keep several organisations.
* **The answers**: who someone's manager is, their chain, reports and peers; who leads a department; a person's card
  and their sign-in claims. These come from **one rule**, as of any day. A vacant seat is passed through, never
  stopped at.
* **For other applications**: an application that signs people in through your OpenID Connect provider
  (Authentik, Keycloak, Entra ID, Okta, ...) sends the person's token, and a system sends a key of its own. Each is
  told only what a **share** gives it (a part of the chart, to a depth, with named fields), and every question it
  asks is logged.
* **The chart**: three charts of one organisation (the structure, the positions, the people), which readers move,
  zoom, fold, search, style and export as PNG, SVG or PDF. It reads right to left as well as left to right, and
  ships in English and Persian.
* **Lightweight**: Node.js and nothing else. It uses Node's own HTTP server and its built-in SQLite, with no runtime
  dependencies, in one process with one database file.

**Try it:** [the example organisation](https://rahiaft.github.io/open-orgchart/) (everything in it is made up).

It began as the organisation module of [Divan](https://divan.team) and speaks the same `/api/org/v1/` contract,
so a program written against one works against the other.

## Run it

With Docker:

```sh
docker compose up -d          # http://localhost:8080
```

or with Node.js 22.13 or newer:

```sh
git clone https://github.com/RAHIAFT/open-orgchart && cd open-orgchart
npm ci && npm run build
npm run demo                  # the example organisation, then http://localhost:8080
npm start                     # an empty organisation
```

On its first start, the service makes a **keeper key** and writes it to `data/first-keeper-key.txt`, a file only
its owner may read. It never writes the key to the log. Keep the key somewhere safe and remove the file, or give
your own key in `ORG_KEEPER_KEY`. Then:

```sh
KEY=ook_...
curl -H "X-Org-Key: $KEY" http://localhost:8080/api/org/v1/tree
curl -H "X-Org-Key: $KEY" -H "Content-Type: text/csv" --data-binary @people.csv http://localhost:8080/api/org/pillar/import
curl -H "X-Org-Key: $KEY" http://localhost:8080/api/org/v1/people/elena@example.com/manager
```

Open `http://localhost:8080` to see the chart, signing in with a key.

## Settings

All settings come from the environment.

| Variable | Default | |
| --- | --- | --- |
| `ORG_PORT`, `ORG_HOST` | `8080`, `0.0.0.0` | Where it listens. |
| `ORG_DATA` | `./data` | The folder for its database (`ORG_DB` names the file itself). |
| `ORG_TZ` | the server's | The organisation's time zone, which decides what "today" is. |
| `ORG_KEEPER_KEY` | | The first keeper key, when there is none yet (at least 32 characters). |
| `ORG_CORS_ORIGINS` | none | Web pages that may ask from a browser, comma separated. |
| `ORG_TRUST_PROXY` | `0` | `1` when it stands behind a proxy that sets `X-Forwarded-For`. |
| `ORG_HSTS` | `0` | `1` to tell browsers to come back over HTTPS only (behind TLS). |
| `ORG_RATE`, `ORG_BURST` | `20`, `60` | Requests per second one address may make, on average and in a burst. |
| `ORG_BODY_LIMIT`, `ORG_IMPORT_LIMIT` | 1 MB, 8 MB | The largest body it reads. |
| `ORG_OIDC_ISSUER` | | Your sign-in service. Its userinfo endpoint is discovered from it. |
| `ORG_OIDC_USERINFO_URL` | | The userinfo endpoint, when it cannot be discovered. |
| `ORG_OIDC_MEMBER_CLIENTS` | | Client ids whose tokens mean the organisation's own people are asking. |
| `ORG_OIDC_KEEPER_GROUP` | | A group (in the token's `groups`) whose members keep the organisation. |
| `ORG_PUBLIC` | `1` | `0` serves only the API, without the viewer page. |

### With your sign-in service

1. Register this service at your provider as an OpenID Connect application (for example `orgchart`), and set
   `ORG_OIDC_ISSUER` and `ORG_OIDC_MEMBER_CLIENTS=orgchart`.
2. For each application that should know about the organisation, register it here with its client id at the
   provider (`POST /api/org/pillar/clients {"name": "CRM", "client_id": "crm"}`). Then give it a share
   (`POST /api/org/pillar/shares`).
3. That application sends the signed-in person's access token: `Authorization: Bearer <token>`. There is nothing
   to install and no second login. The person is matched by the token's `sub` (store it on the person) or by their e-mail.

## The API

The contract (`/api/org/v1/`) and the keepers' API (`/api/org/pillar/`) are described in **[docs/api.md](docs/api.md)**.

## The chart on your own pages

The packages are not on npm yet. Until they are, build them from this repository (`npm run build`) and use
`packages/chart/dist` (`index.js`, `core.js`, `style.css`), or add the repository as a dependency of your own monorepo.

```jsx
import OrgChart from '@open-orgchart/chart';
import '@open-orgchart/chart/style.css';

<OrgChart departments={tree.departments} reporting={reporting} language="en" />
```

See [packages/chart](packages/chart/README.md). The drawing also works without React (`@open-orgchart/chart/core`).

## Security

* **Keys**: shown once and kept only as their hashes. A new key for an application makes its old key stop working at once.
* **Tokens**: believed only on the sign-in service's own word (userinfo), and only from a registered application.
* **Least information**: no share, no answer; each share tells a part of the chart to a depth, and only fields
  marked tellable. Every question an application asks is written down, and every change too (who, what, before, after).
* **Queries**: SQL is always prepared with its values bound.
* **Request limits**: bodies have a size limit, every address has a request rate, and failed sign-ins are limited.
  The HTTP server has time limits, so a slow client cannot hold it.
* **Response headers**: every answer has `nosniff`, no referrer, no framing, a strict Content-Security-Policy and
  `no-store`. HSTS is sent on request. No cookies are used, so no other page can act for a person.
* **Spreadsheets**: an exported spreadsheet never takes a name for a formula.
* **The container**: it runs as an unprivileged user, works with a read-only root filesystem, and needs no capabilities.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## What comes next

* SCIM, in and out.
* A signed feed of changes (webhooks).
* Editing screens on the viewer.

## Licence

Apache License 2.0. Copyright 2026 Rahiaft. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
