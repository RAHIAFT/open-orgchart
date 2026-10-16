# Changelog

## 0.1.0 - 2026-10-16

The first release.

* **Service** (`@open-orgchart/server`):
  * **Storage**: organisations, departments, positions, people and dated assignments, plus fields of the organisation's own.
  * **One rule** for who answers to whom, as of any day.
  * **The contract** `/api/org/v1/` (the same one Divan answers): people's cards, managers, chains, reports, peers, claims, the tree, reporting lines, departments, fields.
  * **The keepers' API**, with CSV/JSON import and export, a record of every change, and an access log of applications' questions.
  * **Sign-in**: through any OpenID Connect provider, applications by registered client id, and systems by key; shares and depths.
  * **Runtime**: Node.js and its built-in SQLite only.
* **Chart** (`@open-orgchart/chart`): structure, positions and people. Readers move, zoom, fold, search and style it, and export it as PNG, SVG or PDF. English and Persian, LTR and RTL.
* **Viewer**: served by the service; also an example page with a made-up organisation.
* **Packaging**: a Docker image (non-root, read-only root filesystem) and a compose file.
