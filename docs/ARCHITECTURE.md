# Architecture and interface responsibilities — proposal

## Component boundaries

| Component | Owns | Must not assume |
| --- | --- | --- |
| Frontend | Presentation, consent UI, wallet signing prompts | A successful HTTP request means a payment settled |
| Backend | Private records, workflow, access control, reconciliation | Its database can override contract authorization |
| Contracts | Asset custody and permitted financial transitions | A string or file hash proves satisfactory work |
| Wallet | User signing | The application may collect seed phrases |
| Resolver service | Evidence assessment and authorized settlement decisions | Reviewer assignment in the database changes on-chain roles |

Frontend hosting is intended to use Vercel. A local NestJS/TypeScript API and PostgreSQL workspace now exist; backend hosting remains undecided. Verify hosting-plan compatibility with private organization repositories before deployment.

## Proposed records

User; wallet ownership; project; agreement version; party acceptance; milestone; escrow reference; transaction attempt; submission version; review; change request; dispute case; decision; receipt; notification delivery.

Every escrow reference must include the network, contract ID, verified asset identifier, source/version evidence where available, and applicable authority configuration. Display amounts as decimal strings; perform financial calculations using integer base units. Do not use floating-point arithmetic for money.

## Interface contracts to define

The implemented account/project API is described in [OpenAPI](openapi.json) and [API notes](API.md). Transaction intents, chain status, errors and event schemas for payments remain to be specified. The current API has no payment endpoints.

Financial intents must identify actor, project/milestone, expected agreement version, network, asset, gross amount, fees, recipient/contract, and an idempotency identifier. Reconcile unknown transaction outcomes before retrying. Reject stale agreement versions and network/asset mismatches.

Treat provider responses as external input. Independently confirm financial state and keep enough transaction references to recover after indexer/API downtime. Provider-specific types belong behind an adapter so provider changes do not rewrite the product model.

## Private information

Store files, conversations, and identifying dispute material in protected storage with project-scoped access. Use minimal opaque references or commitments on-chain; even a public file URL or dispute reason can leak data. Specify retention and deletion behaviour before customer uploads.

## Operational concerns

Plan notification retries, deadline jobs, chain reconciliation, contract storage lifetime/restoration, logs with secret redaction, backups, incident response, and key recovery. A scheduler can submit an authorized action; it cannot bypass missing contract permissions or create a timeout right by itself.
