# Workspace API v0.1

The machine-readable contract is [openapi.json](openapi.json), generated from request schemas by `npm run docs:api`. Invalid published terms have additional cross-field validation: required nonblank text, valid calendar dates and positive decimal amounts up to 1,000,000 USDC with two decimal places. Drafts may have blank text but retain the same bounded structure.

All routes use `/api`. Browser requests go through the frontend's same-origin proxy. Mutations require `Origin` equal to `FRONTEND_ORIGIN`, `Content-Type: application/json`, and `X-AccordBridge-Request: 1`. Authentication is an HttpOnly `accordbridge_session` cookie, never an actor ID in JSON. Responses use `Cache-Control: no-store`.

| Method / path | Request / behavior |
| --- | --- |
| POST /auth/register | `{name,email,password}`; creates account and session. Password length 12–128. |
| POST /auth/login | `{email,password}`; returns public account data and rotates the session. |
| POST /auth/logout | Revokes session; clears cookie. Idempotent. |
| GET /auth/me | Current account `{id,name,email}`. |
| GET /projects | Membership-scoped list; unpublished draft titles shown only to their author. |
| POST /projects | `{counterpartyId,role,agreement}`; creates a project and caller-private draft revision 1, base version 0. Counterparty must be a different existing account. |
| GET /projects/:id | Caller role, fixed participants, all published versions and acceptances, and only caller's draft. |
| PUT /projects/:id/draft | `{agreement,expectedVersion,expectedRevision}`; use revision 0 when caller has no saved draft. Returns next draft revision. |
| POST /projects/:id/publish | `{expectedVersion,expectedRevision}`; publishes the caller's saved draft, increments agreement version, and removes that caller's draft. Other participants' old drafts remain private and become stale. |
| POST /projects/:id/accept | `{version}`; identity and role come from the session. Repeating acceptance of the same current version is harmless. |
| GET /health | Database readiness and `payments: disabled`. |

The UI saves before publishing. If saving succeeds and publishing fails, the draft is still stored. A 409 means the version/revision changed or terms are locked; reload and review before retrying. Do not blindly overwrite a newer proposal with an old draft. The UI keeps failed-save edits visible and offers an explicit discard/reload action.

Versions have immutable agreement JSON, publisher ID and timestamp. Acceptances have user ID, role and timestamp and are keyed by project/version/user, with a unique project/version/role constraint. They never migrate to a new version. Draft and publication writes use a single PostgreSQL transaction with a project row lock.

There are no payment, file-upload or administrative signing endpoints. The persisted project does not import state from the payment demo. Account email verification/recovery and invitations remain future work.
