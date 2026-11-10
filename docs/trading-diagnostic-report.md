# Trading-engine diagnostic report

## Account preservation

Read-only inspection on 10 November 2026 confirmed A$2,200.20 cash, A$5,000 starting capital, exactly four trade rows and four funded positions in the supplied database connection. No deployed database writes, evidence imports, forced trades or resets were performed during this work.

| Stock | Existing shares | Original remaining cost basis AUD |
| --- | ---: | ---: |
| LMT | 0.8513 | 699.95 |
| RTX | 2.5472 | 699.97 |
| GD | 1.3635 | 699.95 |
| NOC | 0.9195 | 699.93 |

The new migration only adds an investment-evidence table. All four applied migrations were retained unchanged. Original purchase prices stay in the immutable trade ledger. Position cost basis changes only with subsequent simulated fills; installation does not rebalance the account.

## Findings and correction

The previous engine traded toward equal weights without a 60/40 model. Its evaluation panel could also show unavailable history because only the newest refresh row was queried. Missing provider configuration and provider failures returned without saving per-stock evaluations, and dashboard throttling could suppress scheduled work.

The upgraded engine evaluates after fetching fresh market prices and FX, using a decision timestamp sampled after the fetch. Scheduled cycles use the shared database lock and do not use dashboard throttling. Completed cycles, provider failures and missing provider configuration persist all five BUY/SELL/HOLD decisions, with reasons and rejected-order markers. The dashboard retrieves the latest non-null evaluation. Legacy decisions are not reconstructed.

The documented version-1 model combines 60% verified successful-investor behaviour with 40% independent financial/market checks. The complete rubric, provenance requirements, expiry rules, thresholds, profit targets, stops and operator evidence-loading command are in `docs/investment-model.md`. Evaluation JSON retains the actual evidence and computed component scores used at the time.

No institutional provider was selected and no verified evidence was supplied. Scores therefore remain incomplete in the deployed-data path until verified records are imported. This is an explicit HOLD condition, not an equal-weight fallback. The import path requires operator source verification; this release does not independently authenticate linked documents or fetch regulatory/performance datasets automatically. Test evidence uses example.org URLs and synthetic values exclusively inside disposable databases.

Strategy entries require score >=70 and independent score >=50. Model exits use score <=35, +15% profit or -8% loss from remaining average cost, with complete evidence. Allocation trims above 20% remain explicit risk controls. All fills require current quotes, market-open flags, fresh FX and fresh valuations of held stocks. Future-dated inputs are rejected. Buys preserve the 20% stock ceiling, 30% cash reserve and A$2,500 halt. No same-cycle sell and repurchase is allowed. Existing quote/run/snapshot uniqueness constraints and transactional cash/position updates remain in place.

The panel shows allocation at evaluation, component/composite scores or incompleteness, AUD/share profit and stop thresholds, exit conditions and next eligible trading conditions for all five stocks. Persisted decisions and rejected orders reside in the cycle evaluation; executed simulated fills remain in the trade ledger.

## Validation and release status

TypeScript checking passed. The isolated automated suite passed 36 tests with one opt-in live-provider test skipped. Coverage exercised the actual `runCycle` and `applyMarketData` production paths against disposable Postgres databases: provider fetch before fills, scoring, source availability and timestamps, risk limits, repeated/concurrent triggers, database duplicate constraints, outages, future quotes, stop/profit exits, five persisted decisions and preservation of a four-position ledger when institutional evidence is absent. No test connected to a deployed portfolio.

Preview changes and the additive migration were prepared for the platform's automatic preview deployment. A running hosted preview and post-deploy database migration have not been verified in this session; no preview URL is claimed here. After preview deployment, `/api/refresh` exercises the real cycle and `/api/dashboard` exposes its persisted five-stock evaluation. Missing institutional evidence must remain visible as incomplete rather than producing a forced trade. Scheduled functions run only on published deployments, so the preview's schedule cannot independently demonstrate a production cron invocation.

No build or production publication was run. No automatic merge, broker integration or real-money trading was added. Database outages or transaction failures still prevent guaranteed audit persistence and surface as scheduler errors. Publication remains pending preview review.
