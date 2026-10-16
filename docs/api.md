# The API

Two parts:

* **`/api/org/v1/`**, the contract: questions anyone who may ask can put to the organisation. It is read-only.
  [Divan](https://divan.team) answers the same contract, so a program written against one works against the other.
* **`/api/org/pillar/`**: for the people who keep the organisation (keepers only). This is where it is changed, and
  where applications and their shares are managed.

Every answer is JSON. A refusal is `{"error": "<a sentence>", "code": "<code>"}` with its HTTP status:

| Code | Status | Meaning |
| --- | --- | --- |
| `invalid` | 400 | Something asked or sent is not right (the sentence says what). |
| `no_person` | 400 | `me` was asked, but no person stands behind the question (a system key). |
| `unauthenticated` | 401 | No key or token, a key that opens nothing, or a token the sign-in service does not vouch for. |
| `forbidden` | 403 | Not yours to do (for example, an application asking the keepers' API). |
| `unknown_client` | 403 | The token was issued to an application that is not registered here. |
| `no_share` | 403 | Nothing of the organisation is shared with this application. |
| `not_shared` | 403 | This person is not among what is shared with the application. |
| `not_found` | 404 | No such person, department or thing. |
| `conflict` | 409 | It clashes with what is there (a second head seat, a name already used, the last keeper key, ...). |
| `too_large` | 413 | The body is larger than the service reads at once. |
| `unsupported` | 415 | The body is not JSON (or CSV, for an import). |
| `rate_limited` | 429 | Too many questions at once (see `Retry-After`). |

## Who asks

| Asker | How | What it is told |
| --- | --- | --- |
| **Keeper** | `X-Org-Key: ook_...` (a keeper key), or a sign-in token of the organisation's own app whose `groups` include `ORG_OIDC_KEEPER_GROUP` | Everything; may change it. |
| **Member** | `Authorization: Bearer <token>` issued to one of `ORG_OIDC_MEMBER_CLIENTS` | The whole chart, as a directory shows people to each other. Of the organisation's own fields, only those marked *tellable*. |
| **Application** | `Authorization: Bearer <the person's token>`, issued to a registered client (`client_id`) | What its **shares** cover. The person behind the token always sees their own card. |
| **System** | `X-Org-Key: ooc_...` (a client's key) | What its shares cover, with no person behind it. |

A token is believed only after the sign-in service vouches for it: the service asks its OpenID Connect
**userinfo** endpoint and keeps the answer for two minutes. The service never checks a token's signature itself.
When the sign-in service cannot be reached, nobody is vouched for. The application is the one the token was
issued to (its `azp`, or else its `aud`). The person is found by the token's `sub`, then by its `email`.

### Shares

A share gives one application a part of the chart:

* **where**: a department and everything under it, or the whole organisation;
* **how deep**: `structure` (departments and seats, no names), `holders` (who holds the seats, by name) or `contact` (and how to reach them);
* **which fields**: only fields marked tellable can be named;
* **what for** (`purpose`) and **until when** (`valid_from`, `valid_to`).

Several shares add up, and the deepest one over a department wins there. **No share, no answer.** Every question an
application asks, answered or refused, is written down against the share that answered it (`GET /api/org/pillar/access`).

## The contract: `/api/org/v1/`

Every question is a `GET`. Each takes `?as_of=YYYY-MM-DD` (today, in `ORG_TZ`, when not asked), and works with or
without a closing slash.

| Path | Answer |
| --- | --- |
| `/` | `{service, version, implementation, as_of, you: {kind, client?, shares?, person?}, organisations, asks}` |
| `me` | The card of the person behind the sign-in. |
| `me/manager`, `me/chain`, `me/reports`, `me/peers` | Their manager, chain, reports and peers, as below. |
| `people/<ref>` | A person's card. `<ref>` is an id (`7`, `person:7`), an e-mail address, or a sign-in subject. |
| `people/<ref>/manager` | `{of, manager, as_of}`: who they answer to. |
| `people/<ref>/chain` | `{of, chain: [...], as_of}`: their manager, and on up. |
| `people/<ref>/reports` | `{of, deep, reports: [...], as_of}`: who answers to them (`?deep=1`: everyone under them). |
| `people/<ref>/peers` | `{of, peers: [...], as_of}`: who answers to the same person. |
| `claims/<ref>` | What their sign-in carries (`me` for oneself). |
| `tree` | `{as_of, departments: [...]}`: the departments, their seats and who holds them (`?root=<department id>`). |
| `reporting` | `{as_of, people: [...], seats: [...]}`: who answers to whom, as one list. |
| `departments/<id>` | One department, with `leads`: who leads it in fact. |
| `fields` | `{fields: [...]}`: the organisation's own fields (`?target=department\|position\|assignment\|person`). |

### The one rule for who answers to whom

The rule is read in this order:

1. the person named by hand for them;
2. otherwise, the seat their own seat reports to;
3. otherwise, the head of their department;
4. for a head, the head of the department above.

* A **vacant seat is passed through**: one answers to whoever is above it, never to nobody because a chair is empty.
* **Nobody answers to themselves**: someone holding the head seat and a seat under it answers upward.
* A person with several seats answers by their **primary** one.
* Every answer is **as of a day**, because assignments are dated.

### A person's card

```json
{
  "id": 7, "name": "Elena Petrova", "sub": "…", "email": "elena@example.com",
  "organisation": {"key": "main", "name": "Example Co."},
  "code": "E-1042",
  "seats": [{
    "position": {"id": "…", "title": "Software engineer", "code": "TEC-11", "extra": {}},
    "department": {"id": "…", "name": "Platform", "path": ["Example Co.", "Technology", "Platform"], "path_ids": ["…", "…", "…"]},
    "is_head": false, "primary": true, "acting": false, "since": "2024-01-01", "until": null, "extra": {}
  }],
  "department": {"…": "the primary seat's"}, "position": {"…": "the primary seat's"}, "is_head": false,
  "manager": {"id": 6, "name": "Omid Rahimi", "email": "omid@example.com"},
  "extra": {"grade": "A"},
  "as_of": "2026-10-16"
}
```

`email` appears only where the asker may be told how to reach people. An application that holds a person's token
always sees that person's own card; it sees *who* their manager is, but not how to reach them unless a share tells it.

### Claims

These are flat and small. An application can use them directly as the person's attributes:

```json
{
  "org": "main", "org_name": "Example Co.",
  "department": "Platform", "department_id": "…", "department_path": "Example Co. / Technology / Platform",
  "departments": ["…", "…", "…"],
  "position": "Software engineer", "position_id": "…", "position_code": "TEC-11", "is_head": false, "heads": [],
  "manager": "omid@example.com", "manager_name": "Omid Rahimi", "code": "E-1042",
  "fields": {"grade": "A"}
}
```

`fields` holds only the person fields marked `in_claims` (and, for an application, tellable and named by its share).

### The tree

```json
{"as_of": "2026-10-16", "departments": [
  {"id": "…", "name": "Technology", "parent": "…", "level": 1, "path": ["Example Co.", "Technology"],
   "organisation": "main", "depth": "contact", "extra": {},
   "head": {"id": 3, "name": "Sara Ahmadi", "email": "sara@example.com"},
   "positions": [{"id": "…", "title": "Chief technology officer", "code": "TEC-1", "is_head": true, "reports_to": null, "extra": {},
                  "holders": [{"id": 3, "name": "Sara Ahmadi", "email": "sara@example.com"}]}]}
]}
```

Departments come flat, parents before children; `parent` ties them together. At depth `structure`, `head` and
`holders` are left out; at `holders`, addresses are left out.

### Reporting

```json
{"as_of": "2026-10-16",
 "people": [{"id": 7, "name": "Elena Petrova", "email": "…", "position": "Software engineer", "position_id": "…",
             "department": "Platform", "department_id": "…", "is_head": false, "manager": 6}],
 "seats":  [{"id": "…", "title": "Software engineer", "code": "TEC-11", "department": "Platform", "department_id": "…",
             "is_head": false, "answers_to": "<seat id>", "holders": [{"id": 7, "name": "Elena Petrova"}]}]}
```

This is what the chart's *People* and *Positions* views draw. A manager or seat that is not among what the asker
may see is given as `null`, so the line ends there.

## For the people who keep it: `/api/org/pillar/`

Keepers only. Bodies are JSON (`Content-Type: application/json`). Every change is written down: who made it, what
it was, and the before and after.

| Resource | List / add | Read / change / remove |
| --- | --- | --- |
| Organisations | `GET`, `POST organisations` | `GET`, `PATCH`, `DELETE organisations/<id>` |
| Departments | `GET` (`?organisation=`, `?root=`), `POST departments` | `GET`, `PATCH` (`parent` moves it), `DELETE departments/<id>` |
| Positions | `GET` (`?department=`), `POST positions` | `GET`, `PATCH`, `DELETE positions/<id>` |
| People | `GET` (`?q=`, `?active=`, `?limit=`, `?offset=`), `POST people` | `GET` (with card, chain, reports), `PATCH`, `DELETE people/<id>` |
| Assignments | `GET` (`?person=`, `?position=`, `?current=1`), `POST assignments` | `GET`, `PATCH`, `DELETE assignments/<id>` |
| Fields | `GET` (`?target=`, `?all=1`), `POST fields` | `GET`, `PATCH`, `DELETE fields/<id>` (retires it) |
| Applications | `GET`, `POST clients` | `GET` (with shares), `PATCH`, `DELETE clients/<id>`; `POST clients/<id>/key` for a new key |
| Shares | `GET` (`?client=`), `POST shares` | `GET`, `PATCH`, `DELETE shares/<id>` |
| Keeper keys | `GET`, `POST keepers` | `DELETE keepers/<id>` (the last one stays) |

| Other | |
| --- | --- |
| `GET access` (`?client=`, `?limit=`) | The questions applications asked, against the share that answered each. |
| `GET changes` (`?since=<id>`, `?limit=`) | Every change, oldest first, after `since`. |
| `POST import` (`?dry=1`, `?organisation=`) | Departments, positions, people and who holds which, from CSV (`text/csv`) or JSON `{rows: [...]}`. If one row cannot be read, nothing changes. |
| `GET export?format=csv\|json` | CSV in the columns the import reads; JSON with everything. |

### What it refuses

* A department put under itself, or under anything below it.
* A second head seat in a department.
* A seat that would answer, through any number of seats, to itself.
* A manager named by hand who would close a circle.
* A share naming a field not marked tellable.
* Removing the last keeper key or the last organisation.

### Adding things

```http
POST /api/org/pillar/departments   {"name": "Platform", "parent": "<department id>"}
POST /api/org/pillar/positions     {"department": "<id>", "title": "Platform lead", "code": "TEC-10", "is_head": true}
POST /api/org/pillar/people        {"name": "Elena Petrova", "email": "elena@example.com", "sub": "<sign-in subject>"}
POST /api/org/pillar/assignments   {"person": "elena@example.com", "position": "<id>", "valid_from": "2026-01-01", "primary": true}
POST /api/org/pillar/fields        {"target": "person", "key": "grade", "label": {"en": "Grade", "fa": "رتبه"}, "kind": "choice",
                                    "options": ["A", "B", "C"], "shareable": true, "in_claims": true}
POST /api/org/pillar/clients       {"name": "Payroll", "key": true}             -> {client, key}  (the key is shown this once)
POST /api/org/pillar/clients       {"name": "CRM", "client_id": "crm"}          (an application that signs people in)
POST /api/org/pillar/shares        {"client": "<id>", "department": "<id>", "depth": "holders", "fields": ["grade"], "purpose": "…"}
```

A field's kind is one of `text`, `long`, `number`, `date`, `yesno`, `choice`, `choices`, `person`, `email`, `phone`
or `url`. Values live on the thing (`extra`) and are checked against the kind.

### Import

The columns are `department, position, code, is_head, email, name, person_code, primary, valid_from, valid_to`.
`department` is a path (`Example Co. / Technology / Platform`); missing departments are created along it.
Positions are matched by title within their department, and people by e-mail.

```csv
department,position,code,is_head,email,name,valid_from
Example Co.,Chief executive,CEO-1,yes,maya@example.com,Maya Lindqvist,2024-01-01
Example Co. / Technology,Chief technology officer,TEC-1,yes,sara@example.com,Sara Ahmadi,2024-01-01
```

The export writes cells that begin with `=`, `+`, `-` or `@` with a `'` in front, so a spreadsheet never reads a name as a formula.
