# AccordBridge Backend

[![Backend checks](https://github.com/accordbridge-labs/accordbridge-backend/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/accordbridge-labs/accordbridge-backend/actions/workflows/ci.yml)
[![Dependency advisories](https://github.com/accordbridge-labs/accordbridge-backend/actions/workflows/dependency-advisories.yml/badge.svg?branch=main)](https://github.com/accordbridge-labs/accordbridge-backend/actions/workflows/dependency-advisories.yml)

**The off-chain API behind AccordBridge.**

AccordBridge Backend powers the freelancer–client workspace. Built with NestJS, TypeScript, and PostgreSQL, it manages accounts, private projects, versioned agreements, and work reviews, and connects the workspace to an experimental Stellar Soroban testnet escrow. Participants sign transactions in their own wallets; the service prepares unsigned transactions and reconciles their results without storing participant wallet keys.

> **Status: development / Testnet prototype.** There is no real-money integration, and this service is not production ready. Hosted preflight covered limited session and agreement checks; it did not validate wallet signing or production operations. See [testnet limitations](docs/TESTNET.md) and [hosting notes](docs/HOSTING.md).

## Contents

- [Scope and boundaries](#scope-and-boundaries)
- [Core Features](#core-features)
- [Rules the design keeps](#the-rules-the-design-keeps)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Setup](#environment-setup)
- [API Modules](#api-modules)
- [Off-Chain State Model](#off-chain-state-model)
- [Security and Prototype Boundaries](#security-and-prototype-boundaries)
- [Verification status](#verification-status)
- [Tests and CI](#tests-and-ci)
- [Before real value](#before-real-value)
- [Documentation](#documentation)
- [License](#license)

## Scope and boundaries

This service is the off-chain authority for the workspace. It never holds
escrow funds or participant keys, and it never decides settlement by itself.
The Soroban contracts hold tokens and enforce authorization; the frontend owns
presentation and explicit wallet prompts.

| Area | This service does | This service does not |
| --- | --- | --- |
| Identity and access | Sessions, password hashing, project membership, participant-scoped reads and writes. | Verify email identity, invite users, or provide account recovery. |
| Workflow state | Private drafts, immutable agreement versions, version-specific acceptance, delivery and review history. | Store uploaded files or fetch delivery links. |
| Testnet escrow | Verify wallet ownership challenges, prepare unsigned transactions, persist intents, submit signed transactions, reconcile chain state and balances. | Hold wallet keys, sign for a participant, or arbitrate a dispute. |
| Operations | Migrations, health and read-only readiness diagnostics, rate limits, request IDs, generated OpenAPI. | Guarantee continuous background processing on a sleeping free-tier host. |

The chain is authoritative for whether funds moved. An HTTP success, an
accepted agreement or an approved submission is not proof of settlement.

## Core Features

- **Accounts and sessions:** password-based registration and login with revocable, HttpOnly session cookies.
- **Private project workspace:** fixed client/freelancer membership, participant-scoped access, and author-private drafts.
- **Versioned agreements:** immutable published terms and acceptance records attached to each agreement version.
- **Work delivery and review:** versioned delivery notes and HTTPS links, client approval or revision requests, and review deadlines.
- **Experimental testnet escrow:** wallet ownership proofs, frozen agreement snapshots, participant-signed transactions, and verified chain-state reconciliation.
- **Operational controls:** PostgreSQL migrations, request metadata, rate limits, health and readiness endpoints, and a generated OpenAPI contract.

Mainnet payments, private file uploads, verified email, password recovery, invitations, and dispute case management are not implemented service guarantees. See the [product specification](docs/PRODUCT.md) and [roadmap](docs/ROADMAP.md) for scope and planned work.

## The rules the design keeps

These rules are enforced in code and pinned by tests, so they survive
refactoring.

| Rule | Where it lives | How it is pinned |
| --- | --- | --- |
| The chain decides whether funds moved. | `testnet.ts` and `stellar.ts` verify network, code, terms and balance before reporting settlement. | Integration tests use synthetic RPC state; an HTTP success alone never marks a transfer confirmed. |
| An unknown outcome stays unknown. | Transaction intents persist `prepared`/`submitted` state and are reconciled by reading the existing hash. | Tests cover restart recovery, duplicate runs and RPC failure without resubmitting a payment. |
| Participant keys stay with the participant. | The API builds unsigned XDR; signed envelopes are submitted but not stored by the runtime. | Build/transaction tests assert no signing key is required by the service. |
| Membership is checked before data is returned. | `projects.ts` guards every project route with session identity and fixed membership. | Authorization tests cover cross-participant access and private drafts. |
| Stale writes fail with a conflict. | Expected version and draft revision are checked inside PostgreSQL transactions. | Concurrency and stale-version tests are part of the 28-test suite. |
| The API schema is generated. | `docs/openapi.json` is produced from the running routes. | CI runs `npm run docs:api` and fails on a `git diff` drift. |
| Background work is bounded and restart-safe. | Session cleanup runs as an operator command with a capped batch. | Tests validate the bounded cleanup path against an isolated `_test` database. |

## Project Structure

```text
src/
├── app.ts                 # Nest application, middleware, routing, global guards
├── auth.ts                # Account registration, login, sessions, session guard
├── projects.ts            # Project membership, private drafts, versions, acceptance
├── work.ts                # Delivery submissions and client reviews
├── testnet.ts             # Wallet proof and escrow transaction-intent API
├── stellar.ts             # Soroban RPC access, simulation, transaction helpers
├── readiness.ts           # Read-only testnet deployment readiness check
├── database.ts            # PostgreSQL pool, transaction and migration helpers
├── schemas.ts             # Request validation schemas
├── request-metadata.ts    # Request IDs and structured request records
└── build-metadata.ts      # Validated public build revision
migrations/                # Ordered PostgreSQL schema migrations
docs/                      # API, architecture, testnet, hosting, and product guides
scripts/                   # Local database and documentation utilities
test/                      # Integration and state/authorization tests
```

## Getting Started

### Requirements

- Node.js **22.12 or later** (Node 24 LTS is supported).
- PostgreSQL binaries for the included local database helper, or an existing PostgreSQL database.
- A deployed testnet contract and Soroban RPC configuration only if you plan to use the optional testnet workflow.

### Local development

```sh
npm ci
npm run db:local
npm run db:migrate
npm start
```

The API listens on `http://127.0.0.1:4000`. `db:local` creates a dedicated PostgreSQL cluster at `.local/postgres`, bound to `127.0.0.1:55432`, and creates separate `accordbridge_dev` and `accordbridge_test` databases. It generates a random local password and writes `.env` and `.env.test` only when those files do not already exist. The database files remain after the API stops.

To stop the local database while keeping its data:

```sh
pg_ctl -D .local/postgres stop
```

For an existing database, configure `.env` as described below and run `npm run db:migrate`. Keep credentials out of Git. Migration files are applied in order and should not be edited after they have been applied to a shared database.

## Environment Setup

The local database helper creates `.env` for you. To configure an existing database or another environment, copy [`.env.example`](.env.example) to `.env` and set the values below.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string. Use an isolated database ending in `_test` for tests. |
| `FRONTEND_ORIGIN` | Yes | Exact browser origin allowed for unsafe requests, such as `http://127.0.0.1:3000`. Production requires HTTPS. |
| `PORT` | No | Listen port; defaults to `4000`. |
| `HOST` | No | Bind address; defaults to `127.0.0.1`. |
| `NODE_ENV` | No | Runtime mode. Set to `production` only behind the intended HTTPS frontend origin. |
| `BUILD_REVISION` | No | Full public Git commit SHA for deployment identification. |
| `STELLAR_TESTNET_ENABLED` | No | Enables the experimental testnet integration only when set to `true`. Defaults to disabled. |
| `STELLAR_ESCROW_WASM_HASH` | Testnet | Expected escrow contract executable hash. |
| `STELLAR_TEST_TOKEN_CONTRACT` | Testnet | Deployed valueless test-token contract address. |
| `STELLAR_TEST_TOKEN_WASM_HASH` | Testnet | Expected test-token executable hash. |
| `DB_STATEMENT_TIMEOUT_MS` | No | PostgreSQL statement timeout; defaults to `10000` ms. |
| `DB_LOCK_TIMEOUT_MS` | No | PostgreSQL lock wait timeout; defaults to `2000` ms. |
| `SESSION_CLEANUP_BATCH` | No | Expired sessions removed per cleanup run; defaults to `500`, maximum `5000`. |

Testnet contract values are public deployment identifiers, not secrets. **Do not put wallet secret keys in backend environment variables.** The `PG_BIN` variable may be used to point `db:local` at PostgreSQL binaries that are not on `PATH`.

The backend's `FRONTEND_ORIGIN` must exactly match the URL used in the browser; `localhost` and `127.0.0.1` are different origins. The frontend calls the backend through its same-origin `/api` proxy.

## API Modules

All routes are prefixed with `/api`. The [OpenAPI document](docs/openapi.json) is the machine-readable source for request and response schemas; see the [API guide](docs/API.md) for full behavior and examples.

| Module | Representative routes | Responsibility |
| --- | --- | --- |
| **Authentication** | `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | Creates accounts and manages the caller's session. |
| **Projects and agreements** | `GET/POST /projects`, `GET /projects/:id`, `PUT /projects/:id/draft`, `POST /projects/:id/publish`, `POST /projects/:id/accept` | Enforces project membership and manages drafts, immutable agreement versions, and version-specific acceptance. |
| **Work review** | `GET /projects/:id/work`, `POST /projects/:id/work/submissions`, `POST /projects/:id/work/reviews` | Stores versioned delivery records and client decisions. Approval is required for app-managed release preparation. |
| **Wallet and testnet escrow** | `GET /testnet/wallet`, `POST /testnet/wallet/challenge`, `POST /testnet/wallet/verify`, `GET/POST /testnet/projects/:id/...` | Links a public wallet address, prepares/submits signed testnet intents, and reconciles chain state. |
| **Readiness and health** | `GET /testnet/readiness`, `GET /health` | Checks configured testnet deployment readiness or database/API health. `/health` reports real-money payments as disabled. |

Browser mutations require the exact configured `Origin`, JSON content type, and `X-AccordBridge-Request: 1`. Authentication is an HttpOnly `accordbridge_session` cookie; user identity and role come from the session and project membership. Responses use `Cache-Control: no-store`.

Regenerate the OpenAPI document after changing request schemas or routes:

```sh
npm run docs:api
```

## Off-Chain State Model

PostgreSQL stores workspace identity and workflow records. Stellar testnet is authoritative for whether escrow transactions and token transfers actually occurred. The API's verified chain snapshot is a timestamped read model; an HTTP success or an agreement lock alone does not prove that escrow is funded.

```text
User ── session
  └── Project membership (one client + one freelancer)
       ├── private Draft ── publish ──> immutable Agreement Version
       │                                  └── per-version Acceptances
       ├── Work Submissions ──> Client Review
       │                         ├── revision requested ──> next submission
       │                         └── approved ──> app-managed release may be prepared
       └── Testnet Escrow snapshot + transaction intents
                                      └── chain reconciliation updates verified state
```

- Drafts belong to their author. Publishing creates an immutable version; acceptances never carry over to a newer version.
- Project writes use PostgreSQL transactions and row locks. Expected version and draft revision checks reject stale writes with a conflict instead of silently overwriting newer state.
- Work submissions and reviews are append-oriented history records scoped to the project's two participants. Delivery URLs are stored as links; the backend does not fetch or preserve linked files.
- Testnet escrow metadata freezes the agreement version, addresses, asset, amount, and terms hash. Transaction intents persist the public XDR/hash and track prepared, submitted, confirmed, failed, or expired state. Signed envelopes and wallet private keys are not stored by the runtime.
- Chain status is updated only after reconciliation verifies the configured network, deployed code, frozen terms, and escrow balance. Unknown transaction outcomes remain pending for investigation; the API does not blindly retry them.

The testnet contract supports the first milestone only. App-managed release requires the latest work submission to be approved, but the current contract still permits a client-authorized direct release outside the app policy. There is no resolver, dispute freeze, timeout release, or admin withdrawal. See [testnet limits](docs/TESTNET.md) and the [contract interface](https://github.com/accordbridge-labs/accordbridge-contracts/blob/main/docs/CONTRACT-INTERFACE.md).

## Security and Prototype Boundaries

- Passwords use scrypt with random salts. Session tokens are stored as hashes, expire, and are revoked on sign-out.
- Membership is fixed when a project is created. Drafts are author-private; project details and published history are limited to participants.
- Email is a login identifier and is not verified identity. Account email verification, password recovery, invitations, and account deletion are not implemented.
- Participant wallet private keys are never requested or stored. Wallet ownership linking verifies a signed, never-broadcast testnet challenge.
- Testnet tokens have no monetary value and are not USDC. The experimental contract is unaudited; do not use valuable assets.
- Rate limits are in-memory and intended for one service instance. Multi-instance deployment needs shared rate-limit storage and a reviewed proxy/IP policy.

Production security, operational recovery, and mainnet behavior have not been validated. See [hosting notes](docs/HOSTING.md) before deploying the prototype.

## Verification status

| Check | Result on `main` (27 Nov 2026) | What it establishes |
| --- | --- | --- |
| `npm test` with isolated PostgreSQL | 28 passed | Sessions, access control, versioned agreements, work review, intents and reconciliation with synthetic chain data. |
| `npm run build` | Passed | Strict TypeScript build. |
| `npm run docs:api` + drift check | No OpenAPI drift | The committed schema matches the routes. |
| `npm audit --json` | 0 advisories | Lockfile advisory scan; not an audit. |
| [App CI](https://github.com/accordbridge-labs/accordbridge-backend/actions/runs/46078221210) · [Advisory CI](https://github.com/accordbridge-labs/accordbridge-backend/actions/runs/46078221202) | Passed | Post-merge checks on the Apache-2.0 commits. |
| Hosted HTTP/browser preflight (18 Oct 2026) | Limited pass | Public rendering, auth boundaries, cookies, separate sessions, agreement persistence and authenticated readiness. No wallets or tokens. |
| Hosted two-participant Freighter run | **NOT RUN** | No live wallet signature or real chain settlement has been verified through the hosted app. |

Integration tests use a dedicated PostgreSQL cluster and synthetic chain
observations. They are not live Testnet writes, not a security audit, and not
proof of hosted wallet acceptance.

## Tests and CI

```sh
npm test
npm run build
npm run format:check
```

Tests use `.env.test` and require a database whose name ends in `_test`. They apply migrations and create/remove isolated fixtures; never point tests at customer data. Coverage includes authentication, access controls, stale draft/version handling, concurrent writes, work review, and testnet intent/reconciliation behavior.

CI runs the PostgreSQL integration suite and checks generated OpenAPI documentation for drift. Optional testnet smoke tests broadcast transactions and require the sibling contracts' test fixtures; see [testnet test instructions](docs/TESTNET.md#evidence-and-checks). Browser wallet acceptance is a separate manual check.

## Before real value

Real-money escrow would need a reviewed authority and dispute model, an audit
of the exact deployed contract, a real asset and mainnet configuration, shared
rate limiting and caches across instances, continuous reconciliation, monitoring,
incident response, tested backups, and legal/compliance decisions. These are
future gates, not shipped guarantees of this service. See the
[production escrow roadmap](https://github.com/accordbridge-labs/accordbridge-contracts/blob/main/docs/PRODUCTION-ESCROW-ROADMAP.md)
and [testnet limits](docs/TESTNET.md).

Do not describe a generated API schema, a mocked RPC test or a clean advisory
scan as proof of payment, an audit, or an audited production deployment.

## Documentation

- [API reference](docs/API.md) and [OpenAPI specification](docs/openapi.json)
- [Product scope](docs/PRODUCT.md), [architecture](docs/ARCHITECTURE.md), and [roadmap](docs/ROADMAP.md)
- [Testnet setup and limitations](docs/TESTNET.md)
- [Work delivery and review](docs/WORK-REVIEW.md)
- [Hosting guide](docs/HOSTING.md)
- [Dependency advisories and triage](docs/DEPENDENCY-ADVISORIES.md)
- [Contribution guide](https://github.com/accordbridge-labs/.github/blob/main/docs/START-HERE.md)
- Related repositories: [frontend](https://github.com/accordbridge-labs/accordbridge-frontend) · [contracts](https://github.com/accordbridge-labs/accordbridge-contracts)

## Database Request Limits and Session Maintenance

Application transactions set PostgreSQL `statement_timeout` to 10,000 ms and `lock_timeout` to 2,000 ms using transaction-local settings. Override them with positive integer `DB_STATEMENT_TIMEOUT_MS` and `DB_LOCK_TIMEOUT_MS` values. These limits apply per statement or lock wait, not to the entire HTTP request. Migrations explicitly opt out and retain the database's own limits. Queries outside `Database.transaction()` retain the database defaults.

A canceled statement aborts its transaction; rollback is attempted before the connection is released. A failed rollback discards the connection and preserves the original error. No write is automatically retried. A connection failure during `COMMIT` can have an unknown outcome: inspect current state before repeating a write.

Expired sessions are rejected immediately by authentication, but physical cleanup is operator-run, outside login and rotation. Run `npm run db:cleanup-sessions` against the intended environment. Each invocation removes at most 500 expired sessions; `SESSION_CLEANUP_BATCH` accepts 1–5000. Schedule one invocation periodically. It never loops through the whole backlog, and concurrent invocations skip locked candidates. Cleanup failures do not affect login, logout, or rotation. Validate changes only against an isolated `_test` database using `npm test`.

## License

Licensed under the [Apache License 2.0](LICENSE) with the attribution notices in [NOTICE](NOTICE). Third-party dependencies retain their own licenses and notices.
