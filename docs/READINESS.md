# Stellar Testnet readiness

`GET /api/testnet/readiness` requires an authenticated session and is limited to
10 requests per minute per IP in the current single-process rate limiter.
It performs only reads. `/api/health` remains an independent database health check.

The response contains `status`, ISO `checkedAt` and `expiresAt` timestamps,
`network: "testnet"`, and `mainnetPayments: false`. A successful diagnostic request
returns HTTP 200 even when the reported deployment is not ready; authentication
and rate-limit failures use 401 and 429. Do not interpret HTTP 200 as `ready`.

| Status | Meaning and operator action |
| --- | --- |
| `ready` | Expected network, token instance and both pinned WASM executables were readable and matched at check time. Continue normal per-transaction verification. |
| `not_configured` | Testnet is disabled or configuration is invalid. Check the enable flag, contract ID and two hashes against reviewed deployment records. |
| `wrong_network` | RPC did not identify Stellar Testnet. Investigate the RPC response; no ledger read follows this result. |
| `entry_unavailable` | At least one expected ledger entry was omitted. A reset, missing upload, or archived entry can cause this. This RPC read cannot distinguish those causes. Investigate ledger history and the deployment before any separate restoration or redeployment. |
| `code_mismatch` | Token executable or retrieved bytecode differs from pinned code, or the entry has an unexpected type. Stop the affected workflow and reconcile configuration with reviewed source/build evidence. |
| `rpc_unavailable` | A request timed out, failed, or returned data the SDK could not parse. Wait for cache expiry and check again; do not resubmit payment actions. |

The service uses the existing fixed Testnet RPC with a 10-second timeout per
request. A probe makes at most two sequential requests (network, then a batched
ledger read). Results, including failures, are cached for 30 seconds per process;
concurrent callers share one probe. Configuration changes take effect after cache
expiry or process restart. HTTP responses remain `no-store` to avoid browser caches.
Multi-instance hosting needs shared rate limiting and cache coordination.

No secrets, signed XDR, account data or raw upstream errors are returned. This
does not prove a particular escrow is funded, validate a user's balance or prove
hosted wallet readiness. The transaction path retains its independent checks of
network, code, frozen terms and token balance. The diagnostic never signs,
deploys, restores storage, mints or transfers tokens.

Unit tests use synthetic ledger entries and mocked RPC responses; they are not
new live deployment evidence. The PostgreSQL integration test verifies session
protection, endpoint throttling and independence from basic health.
