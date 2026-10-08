# Experimental Stellar testnet integration

This is a development experiment, not the production escrow-provider decision. ABUSD has no monetary value; it is not USDC. Only milestone 1 is wired into the workspace. Each project deploys its own Soroban escrow, pinned to the uploaded WASM hash. Both contract constructors reject other networks. Fees are zero except test-XLM network fees.

## Setup

Build and deploy the sibling contracts repository as described in its README, or use its recorded public deployment while still available. Set `STELLAR_TESTNET_ENABLED=true` and copy `escrowWasmHash`, `tokenContract`, and `tokenWasmHash` from `deployments/testnet.json` into the three matching variables in `.env.example`. Run `npm run db:migrate`, restart the API, and start the frontend. These configuration values are public; no wallet secrets belong in the service. Testnet resets or archived contract storage can require fresh deployment.

## Authority and state

Each account links one standard G-address using its master-key signature over a random, expiring transaction challenge. Sequence zero and zero fee make the challenge unsuitable for broadcast. This is a narrow development proof, not SEP-10 authentication or support for multisig, disabled master keys, contract wallets, key rotation or recovery. Account sessions still authorize application access.

Both participants accept the current application agreement, then both wallets separately approve its frozen hash on chain. The client deploys, funds, and may release the full amount only to the original freelancer. Both participant refund votes are required to return the full amount to the original client. Refund votes cannot be withdrawn; one vote does not prevent a client release. There is no resolver, admin withdrawal, split, dispute freeze or timeout release. Do not treat this experiment as the final dispute policy.

The hash binds the full agreement, project/version, first milestone, participant addresses, testnet passphrase, token, amount in seven-decimal base units, and zero fees. Decimal USDC amounts in existing agreements are used as the same nominal ABUSD number solely for testing.

Preparing deployment permanently freezes this agreement version, even if signing is cancelled. A new transaction may be prepared for the same frozen version after verified failure/expiry; editing or abandoning that snapshot is not implemented. `fundingStarted` means terms locked, not funds received.

The service saves each transaction hash before sending. Only one unresolved intent is allowed per project. Check reconciles success/failure; NOT_FOUND permits expiry only when the retained ledger window covers the original preparation ledger and has passed the transaction deadline. If that history has disappeared, the intent stays blocked for investigation. No blind retry or automatic unblocking exists. Transaction XDR and public hashes persist; signed envelopes/private keys are not stored by the runtime.

Reads require matching state/balance ledger numbers, reject snapshots behind the confirmed transaction or previous snapshot, and compare deployed WASM, immutable terms, and token balance before storing a timestamped snapshot. External RPC calls and SQL locks make this suitable for local testing only; durable background reconciliation, operational monitoring, archival recovery and production concurrency hardening remain outstanding. `/health` reports real-money payments disabled, not RPC readiness; `/testnet/wallet` reports configuration availability.

## Evidence and checks

`npm test` covers real signature validation with generated keys and isolated PostgreSQL API tests using a mocked RPC, including pending/unknown and verified expiry. `npm run test:testnet` requires the sibling contracts' ignored fixture keys and public deployment, uses only an isolated `_test` database, and broadcasts real testnet signatures. It records public hashes in [testnet-api.json](evidence/testnet-api.json). It has executed deployment, both approvals, faucet, funding, first refund vote retaining funds, and second vote returning funds. Contract-level release has separate evidence in the contracts repository. These are not an audit or mainnet evidence. Freighter extension approval still needs a manual two-wallet browser check.
