# Shared interface blueprint — proposal 0.1

Specification only. Frontend, backend and contracts share this model; backend payment implementation is a later phase. The implemented account, project, work and testnet routes are in [API.md](API.md) and [openapi.json](openapi.json); where this document differs, those describe what exists today. Policy inputs are in [POLICY.md](POLICY.md); component boundaries in [ARCHITECTURE.md](ARCHITECTURE.md).

## 1. Records

All IDs are UUIDs. All timestamps are RFC 3339 UTC strings. Records marked *immutable* are append-only; a correction creates a new row.

| Record | Key fields | Notes |
| --- | --- | --- |
| Project | `id`, `clientId`, `freelancerId`, `resolverId?`, `status` | Participants fixed at creation (matches current API). |
| Agreement version | `projectId`, `version`, `terms`, `termsHash`, `publisherId`, `createdAt` | *Immutable.* `termsHash` is SHA-256 of canonical JSON, used as the on-chain commitment. |
| Party acceptance | `projectId`, `version`, `userId`, `role`, `acceptedAt` | *Immutable.* Unique per project/version/role; never carried to another version. Resolver consent uses the same record with role `resolver`. |
| Milestone | `projectId`, `index`, `agreementVersion`, `amountBaseUnits`, `state`, `escrowRefId?` | State machine in PRODUCT.md. Only funded milestones are startable. |
| Escrow reference | `id`, `network`, `contractId`, `assetId`, `codeHash`, `authorityConfig`, `agreementVersion` | *Immutable.* Matches the ARCHITECTURE requirement. |
| Transaction attempt | `id`, `projectId`, `milestoneIndex`, `action`, `actorId`, `idempotencyKey`, `hash`, `state`, `expiresAt`, `minLedger`, `createdAt` | Current intents table extended with the idempotency key. |
| Submission version | `id`, `milestoneIndex`, `notes`, `links`, `submittedAt`, `reviewDeadline` | *Immutable.* Private deliverables stay off-chain. |
| Review | `submissionId`, `decision`, `feedback`, `reviewedAt` | *Immutable*, one per submission. |
| Change request | `id`, `projectId`, `baseVersion`, `description`, `amountBaseUnits`, `newDueDate`, `state` | Acceptance creates a new agreement version. |
| Case | `id`, `projectId`, `milestoneIndex`, `kind`, `state`, `openedBy`, `deadlines`, `resolverId?` | Kinds: `cancellation`, `dispute`, `unresponsive_client`. |
| Decision | `caseId`, `resolverId`, `outcome`, `splitBaseUnits?`, `reasoning`, `decidedAt` | *Immutable.* Payout still needs a confirmed transaction. |
| Receipt | `id`, `transactionAttemptId`, `confirmedLedger`, `amountBaseUnits`, `fees` | Created only after chain confirmation. |
| Notification delivery | `id`, `userId`, `type`, `state`, `attempts`, `lastAttemptAt` | Retries are bounded. |

Milestone states: `unfunded`, `funding_pending`, `funded`, `submitted`, `revision_requested`, `approved`, `payout_pending`, `released`, `refunded`, `cancelled`, `in_case`. `released` and `refunded` require a confirmed chain snapshot.

## 2. Amount encoding

- API requests and responses carry money as **decimal strings** with the asset code, never JSON numbers: `{"amount":"125.50","asset":"USDC"}`.
- Internally, and in any signed or hashed payload, amounts are **integer base units** serialized as decimal strings. Stellar assets use 7 decimals, so `"125.50"` is `"1255000000"`.
- Conversion rejects more fractional digits than the asset permits; rounding is never implicit.
- Calculation uses `bigint`. Fees are stated in base units. Percentages are basis points, integer.
- Agreement terms currently allow two decimals; widening requires a new `termsHash` version.

## 3. OpenAPI schemas

New schemas, added to `openapi.json` when implemented. All are strict (unknown fields rejected), matching the existing Zod schemas.

```yaml
Money:       { amount: string(decimal), asset: string }
BaseUnits:   string  # /^\d{1,38}$/
TransactionIntentRequest:
  projectId: uuid
  milestoneIndex: integer
  action: enum [fund, release, refund, settle, decide]
  expectedAgreementVersion: integer
  network: string        # must equal configured network passphrase
  asset: string          # verified asset identifier
  grossAmount: BaseUnits
  fees: BaseUnits
  recipient: string      # address or contract
  idempotencyKey: string # 16-64 chars [A-Za-z0-9_-]
TransactionIntent:
  id: uuid
  state: enum [prepared, submitted, confirmed, failed, expired, unknown]
  hash: string
  xdr: string
  expiresAt: timestamp
  lastCheckedLedger: integer?
CaseOpenRequest:  { milestoneIndex, kind, reason(<=2000), expectedVersion }
DecisionRequest:  { caseId, outcome: enum[release, refund, split], splitBaseUnits?, reasoning(<=10000) }
ErrorResponse:    { code: string, message: string, requestId: string, details?: object }
```

Planned routes (not implemented): `POST /projects/:id/milestones/:n/intents`, `GET /intents/:id`, `POST /intents/:id/submit`, `POST /intents/:id/check`, `POST /projects/:id/cases`, `GET /cases/:id`, `POST /cases/:id/evidence`, `POST /cases/:id/decision`, `GET /projects/:id/receipts`.

### Errors

Every failure uses `ErrorResponse` and the request ID already returned in the `X-Request-Id` header. `message` is safe for display; provider text never appears in it. Stable codes:

| HTTP | `code` | Meaning |
| --- | --- | --- |
| 400 | `validation_failed` | Schema or amount encoding error. |
| 401 | `unauthenticated` | No valid session. |
| 403 | `forbidden` | Role does not permit this action. |
| 404 | `not_found` | Also used to avoid disclosing project existence. |
| 409 | `stale_version` | Agreement, draft, submission or case version moved; reload. |
| 409 | `intent_pending` | An unresolved intent exists; reconcile first. |
| 409 | `idempotency_conflict` | Key reused with a different body. |
| 422 | `network_mismatch`, `asset_mismatch`, `amount_mismatch` | Intent differs from frozen terms. |
| 429 | `rate_limited` | Retry after the `Retry-After` header. |
| 503 | `chain_unavailable` | RPC or indexer down; the action is retryable and not failed. |

## 4. Transaction status

`prepared → submitted → confirmed | failed | expired`, plus `unknown` when the outcome cannot be established. Transitions:

- `prepared → submitted`: only after the signed hash matches the stored one and is persisted before broadcast (current behaviour).
- `submitted → confirmed/failed`: only from an independently fetched chain result. An API response, signature or indexer event alone is not proof.
- `submitted → unknown`: broadcast result lost or RPC unavailable. `unknown` **blocks new intents** for that milestone.
- `prepared/submitted → expired`: only when the retained ledger window covers the preparation ledger and has passed the transaction deadline (current rule).
- Milestone state changes (`funded`, `released`, `refunded`) follow `confirmed` plus a verification of contract balance and code hash.

## 5. Idempotency and recovery

1. Every financial mutation carries `idempotencyKey`. The service stores `(userId, key)` with a hash of the request body and the response. Same key and body returns the original result; same key and different body returns `409 idempotency_conflict`. Keys expire after 24 hours, but a transaction hash is unique forever.
2. At most one unresolved intent exists per milestone (extending the current per-project index).
3. The hash is stored before broadcast. After a crash, a recovery job finds `prepared` and `submitted` intents and calls the check path.
4. A job sleeps and retries with bounded backoff when RPC or the indexer is unavailable. It never creates a replacement transaction while an intent is unresolved.
5. If history has been pruned and the outcome is unknowable, the intent stays `unknown` and goes to operator investigation. No automatic unblocking, no blind resend.
6. After indexer downtime, reconciliation replays from the last confirmed ledger recorded on each escrow reference and compares contract balance, code hash and frozen terms with stored values. Disagreement raises an alert and freezes new intents on that escrow; the database never overwrites chain state.
7. Stale agreement versions, wrong network or wrong asset are rejected before a transaction is prepared.

## 6. Provider adapter

Application code depends only on this interface; Stellar/Soroban or any escrow provider types stay inside the adapter:

```ts
interface EscrowProvider {
  prepare(intent: TransactionIntentRequest, frozen: EscrowReference): Promise<PreparedTransaction>;
  broadcast(signed: string): Promise<{ hash: string }>;
  status(hash: string): Promise<'pending' | 'confirmed' | 'failed' | 'not_found'>;
  snapshot(ref: EscrowReference): Promise<ChainSnapshot>; // balance, code hash, terms hash, ledger
}
```

Responses from the adapter are validated like any external input. Provider error text is mapped to the codes above and logged with secrets redacted.

## 7. Privacy

- On-chain data is limited to: addresses, amounts, asset, hashes and opaque IDs. No names, emails, notes, file names, reasons or public URLs.
- Delivery notes, evidence, messages and decision reasoning live in the backend database or protected object storage with project-scoped access. A signed, short-lived URL is issued per request; permanent public links are not created.
- A hash commitment may reference private evidence, but a low-entropy value can be guessed; salt it.
- Retention and deletion follow [POLICY.md](POLICY.md) section 6. Logs never include passwords, session cookies, signed XDR or evidence content.

## 8. Access control and keys

| Boundary | Rule |
| --- | --- |
| Participants | Session identifies the user; role comes from project membership, never from JSON. |
| Resolver | Sees only cases assigned and consented to. Cannot read other project content. |
| Support | Account actions and metadata only. Content access needs a case reference and is audit-logged. Support cannot reassign a resolver, sign, or release funds. |
| Reviewer key | The resolver signs with their own wallet. The backend never stores seed phrases or signed envelopes after broadcast. The backend can prepare an unsigned transaction only. |
| Operator keys | Deployment or fee-collector keys, if any, are held in a secrets manager or hardware-backed signer, with separate keys per environment and no key shared with support accounts. Rotation requires a contract-authorized change, documented in the runbook. |
| Database | Database role used by the API cannot alter immutable tables except by append. Reviewer assignment in the database does not change on-chain authority. |

## 9. Open items

Final provider choice (decides `settle`/`decide` semantics), contract support for split decisions and timeouts, retention numbers, and how a replacement resolver is installed on chain. These must be settled before implementation starts.
