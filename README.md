# open-orgchart

An organisation chart you can run on its own: a small, secure service that keeps an organisation's structure
(departments, positions, who holds them, who answers to whom), and a chart component that draws it.

* **The chart**: three charts of one organisation (the structure, the positions with who holds them, the
  people and who they answer to), moved, zoomed, folded, searched and styled, and exported as PNG, SVG or PDF.
  It works right to left as well as left to right, and ships in English and Persian.
* **The service**: one read API, `/api/org/v1/`, that answers who someone's manager is, their chain, reports and
  peers, a person's card and sign-in claims, and the tree, all as of any day. Applications see only what a
  **share** gives them, and every read by an application is logged.
* **Lightweight**: Node.js with no runtime dependencies (its built-in HTTP server and SQLite). One process, one
  database file, one container.
* **Your own sign-in**: applications that sign people in through an OpenID Connect provider (Authentik,
  Keycloak, Entra ID and others) send the person's token; systems use a key of their own.

It began as the organisation module of [Divan](https://divan.team) and speaks the same `/api/org/v1/` contract,
so a program written against one works against the other.

## Status

The first code is landing now. Watch this repository for the first release.

## Licence

Apache License 2.0: free to use, change and ship, including in commercial products. See [LICENSE](LICENSE) and
[NOTICE](NOTICE).
