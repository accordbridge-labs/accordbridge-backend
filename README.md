# AccordBridge Backend

**Status: working local development service.** TypeScript, NestJS 11 and PostgreSQL now power accounts, sessions, participant-scoped projects, private drafts, immutable agreement versions and version-specific acceptance. Experimental Stellar testnet escrow is available; no hosted environment or real-money integration exists.

This repository owns the canonical product specification and the proposed service boundary for AccordBridge, a Stellar freelancer–client payment workspace.

## Responsibility

- Accounts, wallet-ownership verification, and project-scoped access.
- Versioned agreements and acceptance records.
- Private submission/evidence storage and controlled access.
- Change requests, review deadlines, reminders, and case management.
- Transaction tracking, chain reconciliation, and idempotent workflows.
- Payment receipts and operational records.

## Documents

- [Product specification](docs/PRODUCT.md)
- [Architecture and interfaces](docs/ARCHITECTURE.md)
- [Roadmap and decisions](docs/ROADMAP.md)

## Run locally

Use Node.js 22.12+ or Node 24 LTS and PostgreSQL binaries. On this workstation Postgres.app is installed. The helper also accepts `PG_BIN=/path/to/postgresql/bin` and otherwise checks PATH.

```sh
npm ci
npm run db:local
npm run db:migrate
npm start
```

`db:local` creates a dedicated cluster under ignored `.local/postgres`, listening only on `127.0.0.1:55432`, with separate `accordbridge_dev` and `accordbridge_test` databases. It generates a random password, stores it in a mode-600 ignored file, and writes `.env` and `.env.test` only if they do not exist. It does not modify an existing system PostgreSQL cluster. Database files persist when the app stops or the browser refreshes.

For an existing database, copy `.env.example` to `.env`, supply the connection string, and run migrations. Keep credentials out of Git. Migrations are transactional, use a migration lock, and verify the hash of previously applied files. Create a new migration to change an applied schema.

The API listens on `127.0.0.1:4000`. The frontend uses its server-side `/api` proxy. Keep `FRONTEND_ORIGIN` identical to the browser origin (`http://127.0.0.1:3000` locally; `localhost` is a different origin). `NODE_ENV=production` requires an HTTPS frontend origin and enables Secure session cookies. Production hosting and proxy configuration have not been validated.

To stop the helper's cluster without deleting its data:

```sh
pg_ctl -D .local/postgres stop
```

## Implemented rules

- Register, sign in, inspect the current account, and sign out. Passwords use scrypt with random salts; session cookies are HttpOnly and SameSite=Lax. Random session tokens are hashed in PostgreSQL, expire after seven days, and are revoked on logout. Login rotates the browser's existing session.
- Project creation uses the other participant's exact account ID, shared out of band. Membership is fixed; the server derives the caller's role. No user directory or email invitation is exposed.
- Drafts belong to their author. Only the two project participants see published agreements and their version history. Unrelated accounts receive 404 rather than project details.
- Draft saves and publications check expected version/revision. Project-row locks serialize conflicting publications and acceptance. New versions retain old acceptance history and start with no current acceptances. Acceptance ignores no caller-supplied identity: such extra fields are rejected.
- Published milestone prices remain decimal strings. Validation uses integer cents and currently permits two decimal places. This development convention is not a final Stellar asset-precision decision.
- A server-owned funding lock blocks agreement edits and acceptance. Preparing the first testnet deployment locks terms before signing. This lock is not proof of funding; only verified contract state and token balance establish funding.

Unsafe requests require both the configured Origin and `X-AccordBridge-Request: 1`; cross-origin CORS is not enabled. Request size is limited to 64 KB. There are per-IP, per-handler in-memory rate limits (15/minute on authentication routes; 240/minute elsewhere). These are for a single local service; shared rate-limit storage and a reviewed reverse-proxy IP policy are required before multi-instance deployment.

## API and tests

See [OpenAPI](docs/openapi.json) and [API notes](docs/API.md). Regenerate the contract with `npm run docs:api`.

```sh
npm test
npm run build
npm run format:check
```

Tests require `.env.test` to select a database whose name ends in `_test`. They migrate that database, create unique fixtures, and remove those fixtures afterward. Coverage includes session revocation, wrong origins, unrelated-user denial, private drafts, restart persistence, concurrent writes, forged acceptance, stale versions and funding locks. Do not point tests at customer data.

## Development boundary

Email addresses are login identifiers and **are not verified**. Accounts are not proof of email ownership, identity, or wallet ownership. Participants must exchange account IDs deliberately. Email verification, password recovery, invitations, account deletion, session-management UI, audit operations, backups, deployment, private file storage and mainnet payment integration are not implemented. Existing test accounts should not be treated as production identities.

No user wallet private keys are stored or requested. Resolver/operator signing requires a separately reviewed authority and key-management design. Dispute and fee policies remain open in the product specification.

Related repositories: [frontend](https://github.com/accordbridge-labs/accordbridge-frontend), [contracts](https://github.com/accordbridge-labs/accordbridge-contracts).

See this repository's planning issues. License selection is pending.

## Stellar testnet

See [setup, authority and recovery limits](docs/TESTNET.md). Migration 002 adds wallet proofs, frozen escrow snapshots and transaction intents. No backend wallet key is needed.
