# Roadmap and decision record

## Current boundary

Organization and documentation setup only. No application implementation, contract deployment, or real funds. The organization owner has requested separate repositories and selected AccordBridge as the working brand.

## Phases

1. **Specification:** resolve financial and dispute policy; define component interfaces. Exit: each material success/failure case has a defined actor, state transition, and authority.
2. **Prototype:** design six end-to-end synthetic-data flows. Exit: clients and freelancers understand agreement, funding and next action without coaching.
3. **Escrow evaluation:** verify source, tests, audit scope, deployed version, fee behaviour, and authority. Exit: a documented provider/custom-build decision and reproducible evidence.
4. **Testnet implementation:** complete account-to-settlement workflow. Exit: meaningful tests for permissions, accounting, retries, disputes, refunds and recovery.
5. **Launch preparation:** independent review, monitored support/security channel, reviewer operations, launch-market review and incident plan. Exit: critical findings addressed and pilot limits established.
6. **Limited pilot:** real users and limited financial exposure; measure completion and support costs before expansion.

Phases 2 and 3 may overlap after specification work. Schedule and budget follow the technical decision; no delivery dates are promised.

## Decisions

| Item | Status |
| --- | --- |
| AccordBridge Labs organization and three separate component repositories | Agreed |
| Stellar USDC, fixed-price developer/designer projects | Initial product direction |
| Vercel frontend hosting | Intended; not configured |
| Existing Stellar wallet connection | Initial direction |
| One escrow per milestone | Preferred evaluation candidate |
| Seven-day review then human escalation | Proposed policy |
| Trustless Work | Provisional; verification gaps remain |
| Custom contracts | No build decision yet |
| Frameworks, hosting for backend, fees, licenses | Pending |

## Business model

Evaluate a disclosed fee on released payments. Determine how provider fees, refunds, dispute costs and operating costs affect economics before setting a price. The inspected provider source can deduct fees from dispute distributions, including refunds; account for this explicitly.
