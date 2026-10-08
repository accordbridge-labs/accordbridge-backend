# First-milestone delivery and review

Migration 003 adds append-only submission versions and one immutable review per submission. Only project participants may read these records. The freelancer submits; the client approves or requests revisions. Caller identity comes from the session.

## API

- `GET /api/projects/:id/work`: `{canAct, submissions}` ordered newest first, including delivery notes, HTTPS links, UTC submission/review-deadline timestamps and review decisions.
- `POST /api/projects/:id/work/submissions`: `{version, expectedLatestId, notes, links}`. Use null for the first expected ID. Notes are required (maximum 5,000 characters); supply 1–10 HTTPS links without embedded credentials, each at most 2,000 characters. Only a revision request permits a replacement submission. A stale or repeated submission returns 409; reload history before retrying.
- `POST /api/projects/:id/work/reviews`: `{submissionId, decision, feedback}` where decision is `approved` or `revision_requested`. Revision feedback is mandatory; maximum feedback length is 5,000 characters. Only the latest submission can be reviewed. Identical repeat reviews are idempotent; conflicting decisions return 409.

Submission and review require a funded first milestone snapshot checked within five minutes and no prepared/submitted chain intent. Use the existing check endpoint to refresh it. Every mutation locks the project row, as do transaction preparation and reconciliation. On-chain state can change outside the app after a snapshot; a work record is not proof of continuing funding or payment.

The number of revision requests is capped by the accepted agreement. Each resubmission starts a fresh `reviewDays` calendar-day period from its server timestamp; deadlines are stored/displayed in UTC. Exhausted revisions require discussion of a separate agreement or mutual refund. There is no automatic escalation, dispute resolver or deadline-driven payout.

## Approval and payment boundary

Both preparing and submitting an app-managed release require approval of the latest submission. The frontend enables the release action after approval, but never signs or broadcasts automatically. Wallet signing, transaction reconciliation and contract rules still determine payment. Approval is final for that submission and cannot be edited.

This is application policy, not a new contract restriction. The existing testnet contract still authorizes client release independently of these off-chain records. Previously signed transactions or direct contract calls may bypass the application review policy. No contract was redeployed for this feature.

## Content and retention

Delivery notes and link strings are saved to PostgreSQL, not the public chain. URLs are never fetched, previewed or verified by the backend. Linked content can change or disappear and has its own access permissions; these records are not immutable file evidence. There are no uploads, notifications, file hashes or private object-storage guarantees. Previous versions remain visible to both participants.

## Validation

Isolated-database tests cover participant access, role enforcement, unsafe-link rejection, stale funding snapshots, simultaneous submission attempts, deadlines, stale reviews, repeat decisions, revision limits, retained history and approval-gated release. Desktop/mobile browser tests exercise real workspace APIs against explicitly synthetic funding snapshots.

`npm run test:testnet -- --review-release` runs generated fixture wallets through real testnet funding, first submission, requested revision, resubmission, approval and client-signed release. It writes public transaction evidence to `docs/evidence/testnet-work-review.json`. The default testnet smoke retains mutual-refund coverage. Neither automated path drives the Freighter extension or uses valuable tokens.
