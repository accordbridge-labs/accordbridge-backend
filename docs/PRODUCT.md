# AccordBridge product specification — draft 0.1

## Agreed direction

Organization: AccordBridge Labs (`accordbridge-labs`). Product: AccordBridge. Separate frontend, backend, and contracts repositories. Intended network and initial payment asset: Stellar and Stellar USDC. Naming checks identified existing businesses using similar names; the owner chose to retain AccordBridge. Naming is not trademark clearance.

The first users are independent web developers and designers working on fixed-price projects with existing clients. The proposed advantage is a coherent connection between accepted scope, submission versions, paid changes, and payment decisions. Escrow and milestones are not novel inventions.

## Initial scope

Accounts; wallet connection; agreements; milestones; escrow funding; submission and review; revision tracking; funded change requests; cancellation; dispute cases; receipts; notifications; restricted reviewer/support tools.

Defer job discovery, bidding, hourly tracking, a platform token, lending, multi-chain payments, embedded wallets, and bank/card funding.

## Roles

Client funds and reviews. Freelancer accepts work and submits. The designated resolver decides contested settlement under accepted terms. Support operates accounts and cases; support access must not automatically grant signing power. One user may have different roles in different projects.

## Agreement requirements

Before funding, both parties accept the same immutable version specifying deliverables, acceptance criteria, milestone amounts, asset, deadlines/timezone, revision limits, review process, fees, cancellation rules, resolver authority, and case costs. Changes create a new accepted record; historical versions remain accessible.

## Proposed lifecycle

Draft → proposed → mutually accepted → funding pending → funded → in progress → submitted → review → approved → payout pending → released.

Revision, cancellation, change request, and dispute are explicit branches. An API response, signature, or indexer event alone is insufficient proof that funds arrived. Confirm chain state before marking a milestone funded or settled.

Only funded work is shown as ready to start. Future milestones stay unfunded. A separate escrow per milestone is the preferred design to evaluate, not a validated deployment architecture.

## Working policy defaults

- Seven calendar days for review is a proposed default, displayed with an explicit deadline and timezone.
- Client silence escalates to the agreed reviewer. Contract-enforced timeout release is not an established capability of the evaluated provider.
- Revisions refer to accepted requirements. The number of rounds, response periods, and revised deadlines must be agreed; repeated disagreement escalates rather than indefinitely resetting the clock.
- Extra work requires mutual acceptance of price and schedule, then confirmed additional funding.
- A missed delivery date permits a cancellation request, with an opportunity to respond. It does not automatically decide entitlement to payment for partial work.
- Mutual settlements record both parties' consent. The actual refund transaction must follow the selected contract's authorization model.
- Disputed funds remain locked until an authorized decision. Refunds may incur provider fees; never promise a gross refund without a verified fee policy.

## Dispute process

Evidence submission → opportunity for mutual settlement → reviewer assignment/conflict check → reasoned decision → authorized payout. Resolver availability and consent must be established before funding. Define replacements and any appeal mechanism before implementation; an executed payout cannot simply be reversed by the interface.

The blockchain records and enforces authorized actions; it cannot assess subjective work quality. Public descriptions must accurately disclose operator and resolver powers.

## Open decisions

Revision timing; cancellation response period; reviewer replacement; appeals and finality; dispute fees; platform fees and refund subsidies; launch jurisdictions; identity requirements; evidence retention/deletion; wallet recovery; licenses; provider selection; transaction signing roles.

## Validation

Measure user comprehension, funding completion, submission-to-payment time, dispute frequency/resolution time, repeat use, and support cost. Public research is not proof of customer demand. Use synthetic-data prototypes, then testnet and a limited real-user pilot after launch readiness review.
