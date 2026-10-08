# AccordBridge Backend

**Status: planning only.** No service, database, API, or hosted environment exists yet.

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

The service language, framework, database, storage provider, and hosting are not selected. Backend processes must not store user private keys. Reviewer/operator signing requires a separately reviewed authority and key-management design.

Related repositories: [frontend](https://github.com/accordbridge-labs/accordbridge-frontend), [contracts](https://github.com/accordbridge-labs/accordbridge-contracts).

See this repository's planning issues. License selection is pending.
