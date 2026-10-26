# AccordBridge Backend

[![Backend checks](https://github.com/accordbridge-labs/accordbridge-backend/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/accordbridge-labs/accordbridge-backend/actions/workflows/ci.yml)

**The off-chain API behind AccordBridge.**

AccordBridge Backend powers the freelancer–client workspace: it manages accounts, private projects, versioned agreements, and work reviews using NestJS, TypeScript, and PostgreSQL. It also connects the workspace to an experimental Stellar Soroban testnet escrow flow by preparing transactions for participants to sign and reconciling their results. Participant wallet keys remain in their wallets.

> **Status: development / Testnet prototype.** This repository is not production ready and has no real-money integration. The hosted testnet preflight covered a limited set of session and agreement checks; it did not validate wallet signing or production operations. See [testnet limitations](docs/TESTNET.md) and [hosting notes](docs/HOSTING.md) before trying the demo.

[Get started](#run-locally) · [API reference](#api-reference) · [Architecture](docs/ARCHITECTURE.md) · [Testnet](#stellar-testnet) · [Contributing](https://github.com/accordbridge-labs/.github/blob/main/docs/START-HERE.md)

## What the API provides

- **Private participant accounts and projects:** session-based access, fixed project membership, and participant-scoped records.
- **Agreement history:** private drafts, immutable published versions, and acceptance tied to a specific version.
- **Work review:** versioned delivery submissions, participant-visible HTTPS links, review deadlines, decisions, and revision requests.
- **Experimental Stellar testnet escrow:** wallet ownership proofs, frozen agreement snapshots, unsigned transaction preparation, signed transaction submission, and chain-state reconciliation.
- **Operational foundations:** PostgreSQL migrations, generated OpenAPI documentation, readiness checks, and CI integration coverage.

The product is intentionally bounded. Mainnet payments, private file uploads, account email verification and recovery, invitations, and dispute case management are not implemented service guarantees. See the [product specification](docs/PRODUCT.md) and [roadmap](docs/ROADMAP.md) for scope and planned work.

## How it fits together

```text
Browser / participant wallet
          │  session-authenticated API requests
          ▼
AccordBridge API ───── PostgreSQL
  │  unsigned XDR        private records and transaction intents
  │  signed XDR
  ▼
Stellar Soroban testnet
  escrow contract and test-token state
```

The API owns project access and workflow state. The contract governs escrow state on testnet. A successful HTTP response alone does not prove that a transaction settled; the API reconciles the transaction with the configured network and contract. Read the [architecture notes](docs/ARCHITECTURE.md) for component boundaries.

## Run locally

### Requirements

- Node.js **22.12 or later** (Node 24 LTS is also supported).
- PostgreSQL binaries for the included local database helper, or an existing PostgreSQL database.
- For the optional testnet workflow: deployed AccordBridge contracts and a configured Soroban RPC endpoint. See [testnet setup](docs/TESTNET.md).

### Quick start

```sh
npm ci
npm run db:local
npm run db:migrate
npm start
```

The API listens on `http://127.0.0.1:4000`. `db:local` creates a dedicated PostgreSQL cluster in the ignored `.local/postgres` directory, bound to `127.0.0.1:55432`, with separate `accordbridge_dev` and `accordbridge_test` databases. It creates a random password and only writes `.env` or `.env.test` when those files do not already exist. The cluster data remains on disk after the API stops.

To stop the local database without removing its data:

```sh
pg_ctl -D .local/postgres stop
```

To use an existing database instead, copy `.env.example` to `.env`, set `DATABASE_URL` and the required application settings, then run the migrations. Keep credentials out of Git. Use the comments in [`.env.example`](.env.example) as the configuration reference.

For local browser use, set `FRONTEND_ORIGIN` to the exact frontend origin (for example, `http://127.0.0.1:3000`). `localhost` and `127.0.0.1` are different origins. The frontend accesses this API through its same-origin `/api` proxy.

## API reference

- [OpenAPI specification](docs/openapi.json) — machine-readable API contract.
- [API guide](docs/API.md) — routes, request behavior, authentication, and experimental testnet endpoints.
- [Delivery and review flow](docs/WORK-REVIEW.md) — submission history, review decisions, revision limits, and deadlines.
- [Readiness diagnostic](docs/READINESS.md) — authenticated testnet/network and deployment checks.

The API uses `/api` routes. Browser mutations require the configured `Origin`, JSON content type, and `X-AccordBridge-Request: 1` header. Authentication uses an HttpOnly session cookie; callers do not provide an account ID to act as another user. The generated API contract can be refreshed with:

```sh
npm run docs:api
```

## Security and prototype boundaries

- Passwords are hashed with scrypt and per-password random salts. Session tokens are stored as hashes, expire, and are revoked at sign-out.
- Project membership is fixed at creation. Drafts are author-private; published agreement versions and project details are limited to the participants.
- Wallet proof is separate from account registration. Email addresses are login identifiers and are not verified proof of identity or wallet ownership.
- No participant wallet private key is stored or requested. Testnet transaction preparation returns unsigned transactions for participant wallet signing.
- Testnet escrow is experimental and uses test tokens. A funding lock protects the agreement snapshot, but the lock itself is not proof of funding; verified contract state and token balance are required.

Rate limits are currently in-memory and intended for a single service instance. Multi-instance deployment needs shared rate-limit storage and a reviewed reverse-proxy IP configuration. Production security, operational recovery, and mainnet behavior have not been validated. See [testnet limits](docs/TESTNET.md) and [deployment notes](docs/HOSTING.md).

## Tests and development

```sh
npm test
npm run build
npm run format:check
```

The integration suite uses `.env.test` and requires its database name to end in `_test`. Tests migrate that database and create/remove isolated fixtures; never point it at customer data. Coverage includes authentication and session revocation, access boundaries, draft/version conflicts, concurrent writes, funding locks, and testnet workflow behavior.

CI runs the PostgreSQL integration suite and checks generated API documentation for drift. See [contribution guidance](https://github.com/accordbridge-labs/.github/blob/main/docs/START-HERE.md) before opening a pull request.

## Related projects

- [AccordBridge frontend](https://github.com/accordbridge-labs/accordbridge-frontend)
- [AccordBridge contracts](https://github.com/accordbridge-labs/accordbridge-contracts)

## Database request limits and session maintenance

Application transactions set PostgreSQL `statement_timeout` to 10,000 ms and
`lock_timeout` to 2,000 ms using transaction-local settings. Override them with
positive integer `DB_STATEMENT_TIMEOUT_MS` and `DB_LOCK_TIMEOUT_MS` values. These
limits apply per statement or lock wait, not to the entire HTTP request. Migrations
explicitly opt out and retain the database's own limits. Queries outside
`Database.transaction()` retain the database defaults.

A canceled statement aborts its transaction; rollback is attempted before the
connection is released. A failed rollback discards the connection and preserves
the original error. No write is automatically retried. A connection failure during
COMMIT can have an unknown outcome: inspect current state before repeating a write.

Expired sessions are rejected immediately by authentication, but physical cleanup
is operator-run, outside login and rotation. Run `npm run db:cleanup-sessions`
against the intended environment (or run `node dist/src/session-cleanup.js` with
injected environment variables). Each invocation removes at most 500 expired
sessions; `SESSION_CLEANUP_BATCH` accepts 1–5000. Schedule one invocation
periodically to match traffic; it never loops through the entire backlog.
Concurrent invocations skip locked candidates. Cleanup failures do not affect
login, logout, or rotation. The existing expiry index supports candidate
selection. Validate changes only against an isolated database ending in `_test`
using `npm test`.

## License

Licensed under the [MIT License](LICENSE). Third-party dependencies retain their
own licenses and notices.
