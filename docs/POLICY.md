# Financial rules and dispute operating policy — proposal 0.1

Resolves the open decisions listed in [PRODUCT.md](PRODUCT.md). **Status legend:** *Agreed* means already recorded as an owner decision elsewhere in these docs. *Proposed* means a recommendation that needs owner and legal review before implementation. Nothing here is legal advice, and nothing here is implemented: the current testnet contract has no resolver, split, freeze or timeout release ([TESTNET.md](TESTNET.md)).

All deadlines are stored and compared in UTC and displayed with the viewer's timezone plus the UTC value. A period of "N days" means N×24 hours from the server timestamp of the triggering event, not N calendar-day boundaries. An agreement may state a different period only within the bounds below.

## 1. Time periods

| Rule | Status | Value |
| --- | --- | --- |
| Client review period | Proposed (matches `reviewDays`, 1–30) | Default 7 days from each submission; set per agreement. |
| Freelancer response to a revision request | Proposed | Default 7 days, agreement range 2–30. A missed response is not a forfeiture; it permits the client to open a cancellation request. |
| Revision rounds | Agreed that the limit is in the agreement (`revisions`, 0–10) | A revision request must cite accepted criteria. Rounds are consumed by requests, not resubmissions. |
| Cancellation response period | Proposed | The other party has 5 days from notice (range 3–14) to accept, counter-propose or dispute. Silence never counts as consent. |
| Dispute evidence window | Proposed | 7 days from case opening, for both parties, extendable once by 3 days by the resolver. |
| Mutual settlement window | Proposed | Runs concurrently with the evidence window; any signed settlement closes the case. |
| Resolver decision | Proposed | Target 10 days after evidence closes. A missed target triggers replacement (section 3), not payout. |
| Appeal window | Proposed | None for the first release (see section 3). |

## 2. Client silence

Proposed sequence after the review deadline passes with no review:

1. Reminder notifications to the client at 48 hours and 24 hours before the deadline, and at the deadline.
2. At the deadline the milestone becomes `review_overdue`. The freelancer may open an escalation. The deadline, the submission version and all reminders are recorded.
3. The client receives a further 3 days (range 1–7) notice period.
4. If still silent, the case goes to the designated resolver as an *unresponsive-client* case. The resolver decides on the accepted criteria and the submission record. This is a human decision.

The application must not describe step 4 as automatic release. Unless a selected contract is verified to enforce a timeout release, silence changes workflow state only; funds stay locked until an authorized action. If a future contract does enforce a timeout, update this policy and the agreement text first.

## 3. Resolver

| Topic | Status | Rule |
| --- | --- | --- |
| Consent | Agreed that availability and consent must be established before funding | The resolver must accept the specific agreement version, including its fee and cost terms, before it can be funded. Consent is recorded with timestamp and agreement version. |
| Conflicts | Proposed | The resolver must disclose any financial, family, employment or prior-dispute relationship with either party. Either party may object at agreement time. A resolver is disqualified if they are a party, share an account owner or wallet owner with a party, or are an AccordBridge operator with signing power over that project. |
| Availability | Proposed | The resolver declares availability when consenting. If they cannot act within the decision target, a replacement process starts. |
| Replacement before funding | Proposed | Either party or the resolver may withdraw; this creates a new agreement version needing fresh acceptance. |
| Replacement after funding | Proposed | Only by mutual written consent of both parties, or by AccordBridge Labs appointing a pre-listed alternate where the agreement named a fallback panel. The replacement has the same conflict check. The contract's authority configuration must change through its authorized path; a database assignment alone changes nothing on chain. |
| Decision authority | Agreed in principle (resolver decides contested settlement under accepted terms) | Allowed outcomes: release full, refund full, or split by stated amounts, subject to what the selected contract can enforce. The resolver may not rewrite scope, add payment, or award costs beyond the accepted agreement. |
| Reasoned decision | Agreed | Written reasoning referencing accepted criteria and evidence is required before payout. |
| Finality / appeal | Proposed | First release has no appeal, and the agreement must say so before acceptance. A decision may be corrected only for clerical error, or where a party shows undisclosed conflict within 3 days. An executed payout cannot be reversed by the interface. |

## 4. Fees

| Item | Status | Proposal |
| --- | --- | --- |
| Platform fee | Open; evaluate a disclosed fee on released payments ([ROADMAP.md](ROADMAP.md)) | Launch default 0% on testnet and pilot. A later fee must be a fixed percentage disclosed in the accepted agreement, charged only on amounts released to the freelancer, and never changed for funded work. |
| Provider and network fees | Agreed that refunds may incur fees and gross refund must not be promised | Shown before signing, paid by the signer for transaction fees. Fees a provider deducts from distributions are shown as a line in the agreement. |
| Refund fees | Proposed | Refunds are net of provider-deducted fees. AccordBridge does not subsidize them in the pilot. The UI says "refund amount may be reduced by provider fees" until the selected provider's fee behaviour is verified. |
| Dispute costs | Proposed | Agreement states a resolver fee (fixed amount, capped). Default allocation is split equally; the resolver may allocate it to one party only where the agreement says so. |
| Subsidies | Proposed | None in the pilot. Any later subsidy is a visible, budgeted line, not a hidden discount. |

## 5. Roles and signing authority

| Capability | Client | Freelancer | Resolver | Support | Signing authority |
| --- | --- | --- | --- | --- | --- |
| Read project and evidence | Yes | Yes | Assigned cases only | Metadata by default; content only with logged case access | No |
| Accept agreements, fund, approve, release | Yes | Accept only | No | No | Own wallet only |
| Submit work | No | Yes | No | No | No |
| Open dispute or cancellation | Yes | Yes | No | No | No |
| Decide dispute | No | No | Yes | No | Resolver's own wallet or key, per contract |
| Reset password, resend notices, correct profile data | No | No | No | Yes | No |
| Reassign resolver, approve payout | No | No | No | No | Not by support. Needs the contract's configured authority |

Support roles never hold, receive or use wallet keys. Elevated support access to project content requires a case reference, a recorded reason and an audit log entry. Resolver and support are separate accounts; no account holds both for the same project. Reviewer key management is described in [INTERFACES.md](INTERFACES.md).

## 6. Evidence retention and launch market

| Topic | Status | Proposal |
| --- | --- | --- |
| Evidence retention | Open in PRODUCT.md | Agreement versions, acceptances, submission and review records, decisions and transaction references: kept at least 7 years or as local law requires. Uploaded files and messages tied to a closed case: deleted 12 months after case closure unless a legal hold applies. Deleted content leaves a hash-free tombstone (type, date, reason). |
| Deletion requests | Proposed | Personal profile data may be deleted on request when no open case or legal hold exists. Records needed for financial accounting are retained but minimized. |
| Launch jurisdictions | Open; requires legal review | Do not enable mainnet payments until a written review of money-transmission, consumer and sanctions rules for each launch country. Pilot starts in a small allow-list of countries chosen after that review. Sanctioned jurisdictions are blocked. |
| Identity | Open | No identity verification on testnet. The pilot decision depends on the legal review. |

## 7. Scenario table

Each row gives the actor with authority, the resulting state and what is not claimed. Funds move only through the contract path.

| # | Scenario | Trigger and actor | Resulting state | Funds |
| --- | --- | --- | --- | --- |
| 1 | Client approves | Client approves latest submission | `approved` → `payout pending` | Client signs release; confirmed on chain before `released`. |
| 2 | Client requests revision | Client, citing criteria, within review period | `revision requested`; freelancer period starts | Locked. |
| 3 | Freelancer misses revision response | Period ends | Client may open cancellation | Locked. |
| 4 | Revisions exhausted | Limit reached | Separate agreement, mutual settlement or dispute | Locked. |
| 5 | Client silent | Review period + notice ends | Escalated to resolver | Locked until authorized decision. |
| 6 | Freelancer misses delivery date | Client opens cancellation | Other party responds within cancellation period | Locked; entitlement for partial work not decided automatically. |
| 7 | Cancellation, no response | Response period ends | Escalates to dispute | Locked. |
| 8 | Mutual cancellation | Both parties record consent | Settlement recorded | Refund per contract authorization, net of provider fees. |
| 9 | Change request | Both accept price and schedule | New agreement version; extra funding confirmed on chain | Only funded scope is started. |
| 10 | Change request unfunded | Client does not fund | Change not started | Existing funds unaffected. |
| 11 | Dispute opened | Either party | Evidence window and settlement window | Locked. |
| 12 | Dispute settled | Both consent | Case closed | Per settlement and contract authority. |
| 13 | Resolver decides | Resolver, reasoned decision | Decision recorded; payout by authorized action | Release, refund or split as stated. |
| 14 | Resolver conflict found | Party objection or disclosure | Replacement process (section 3) | Locked. |
| 15 | Resolver unavailable | Decision target missed | Replacement process | Locked. |
| 16 | Provider fee on refund | Any refund | Refund shown net of fees | Per verified fee policy. |
| 17 | Payment outcome unknown | Transaction not yet confirmed | Intent stays pending; reconcile ([INTERFACES.md](INTERFACES.md)) | Not treated as paid or refunded. |
| 18 | Support request | Support staff | May assist accounts; cannot sign or move funds | Unchanged. |
| 19 | Legal hold or deletion request | Operator | Retention rules in section 6 | Unchanged. |
| 20 | Wallet lost or key rotated | Participant | Out of scope for the first release; cannot rely on recovery. See [TESTNET.md](TESTNET.md) | Cannot be assumed recoverable. |

## 8. Decisions needing owner or legal sign-off

Platform fee percentage, dispute cost allocation, appeal policy, retention periods, launch countries, identity requirements and the fallback resolver panel. Section 1–3 periods are suggested defaults and may be adjusted before the agreement schema carries them.
