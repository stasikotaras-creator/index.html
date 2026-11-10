# REVEL TradeGuard trading diagnostic

Evidence captured on 10 November 2026 at 16:03 UTC. Values below refer to production run **212**, evaluated at **2026-11-10 16:00:41.047 UTC**; its transaction finished at 16:00:41.695 UTC. Prices and decisions can change after this observation.

## Findings

The trading algorithm continues to run. The initial four simulated purchases brought LMT, RTX, GD and NOC to their equal-weight targets. The strategy does not buy again simply because time has passed. These holdings currently exceed their 14% targets and do not exceed their 20% sell limits. BAE has no position because its BAESY ADR quote fails the 20-minute freshness requirement. No transaction needs to be forced to explain this behavior.

The requested **60/40 investment scoring model is absent**. There is no institutional-data ingestion, institutional score, composite score, score threshold, signal-based entry, stop-loss or take-profit rule in the deployed engine. Institutional data is unavailable rather than a numerical zero; it never enters a score calculation, so it does not currently create a NaN or invalid composite decision. However, trades are made without that requested model: this is a strategy implementation gap, not evidence that the 60/40 strategy is operating correctly. No model or thresholds were invented in this preview.

## Per-stock production assessment

All quote timestamps are UTC. Allocations use recorded AUD prices and total equity of A$5,138.94. The exact HOLD explanations below for the four held stocks are reconstructed from the deployed pure order planner and recorded state; historical production runs did not persist routine HOLD reasons. BAE's rejection is an exact stored production message.

| Stock | Position (shares) | Value AUD | Allocation | Latest verified quote | Decision / responsible rule | Another purchase eligible now? | Sell condition reached? | Failed/rejected orders |
|---|---:|---:|---:|---|---|---|---|---|
| LMT | 0.8513 | 742.27 | 14.4440% | 2026-11-10 16:00:00 | HOLD — target shortfall −A$22.82 is below the A$25 minimum; sell requires >20% allocation | No — already above 14% target | No | No recorded failure or rejection for a new order; no new order planned |
| RTX | 2.5472 | 737.31 | 14.3476% | 2026-11-10 16:00:00 | HOLD — target shortfall −A$17.86 is below the A$25 minimum; sell requires >20% allocation | No — already above 14% target | No | No recorded failure or rejection for a new order; no new order planned |
| GD | 1.3635 | 727.21 | 14.1511% | 2026-11-10 16:00:00 | HOLD — target shortfall −A$7.76 is below the A$25 minimum; sell requires >20% allocation | No — already above 14% target | No | No recorded failure or rejection for a new order; no new order planned |
| NOC | 0.9195 | 731.94 | 14.2430% | 2026-11-10 16:00:00 | HOLD — target shortfall −A$12.49 is below the A$25 minimum; sell requires >20% allocation | No — already above 14% target | No | No recorded failure or rejection for a new order; no new order planned |
| BAE (BAESY) | 0 | 0.00 | 0% | 2026-11-09 20:58:00 | HOLD — quote exceeds 20-minute freshness limit | No — stale quote; otherwise portfolio has buying capacity | No — no position | Exact rejection: `BAE: quote is 1143 min old, no simulated trade.` |

The original four fills occurred together in run 110 at **2026-11-09 14:30:39.430 UTC**, for A$699.95 LMT, A$699.97 RTX, A$699.95 GD and A$699.93 NOC. Their exact stored rule was `Equal-weight buy towards 14.000000000000002% target`. The floating-point percentage text is cosmetic. BAE was already rejected then: `BAE: quote is 3932 min old, no simulated trade.` Later closed-market cycles recorded `BAE: market closed, no simulated trade.` No SELL fills exist.

## Schedule and production execution evidence

The handler at the published commit `4699566200168adb8308bbbbeef0e0b2b41a79a8` matches the checkout's scheduled handler. It calls `runCycle("schedule")`, which fetches quotes/FX, calls `applyMarketData`, invokes `planOrders`, and transactionally persists fills, positions, account cash, valuation snapshots and run notes. It does not merely refresh prices. The published engine and rules source were also retrieved from that commit for inspection.

Production execution logs were read for the preceding 24 hours. They contained 191 log entries, zero error/fatal entries, and repeated successful `scheduled price run` results from 2026-11-09 16:15 through 2026-11-10 16:00 UTC. The latest entry reported `{"ran":true,"runId":212,"status":"ok","notes":["BAE: quote is 1143 min old, no simulated trade."]}`. The schedule is every 15 minutes Monday–Friday UTC, including closed-market hours. The scheduler only runs on published deploys; previews do not receive scheduled invocations.

Read-only SQL inspection of the available database connection returned 212 recorded runs: 161 scheduled and 51 dashboard-triggered, all marked `ok`, with 102 valuation snapshots after the initial purchases, exactly four trade rows and an inactive persistent risk halt. These account, position, quote, latest-run and trade values matched the live production `/api/dashboard` response, whose deploy context was `production`. SQL was accessed through the supplied connection; changing a branch-name environment variable does not itself prove that connection was retargeted. Live production API and production function logs provide independent confirmation of the current portfolio and scheduler findings.

No failed run rows or order errors were present in the inspected stored evidence; no scheduled errors appeared in the reviewed log window. The original implementation has no rejected-order table, and a transaction-level exception can roll back its run row. Consequently, absence of recorded failures cannot establish that no failure ever occurred outside this evidence window. HOLD decisions are not broker order failures; there is no broker integration.

## Market data

All five latest snapshots were fetched at 2026-11-10 16:00:41.047 UTC. Four NYSE quotes were timestamped 16:00:00, approximately 41 seconds old at evaluation. USD/AUD was 1.45802, timestamped 15:59:00, approximately 101 seconds old and within the 120-minute FX limit.

BAE maps to the OTC ADR **BAESY**, not the London BA. listing. Its timestamp remained 2026-11-09 20:58:00 despite the new fetch and a provider market-open flag. The engine correctly rejected it as approximately 1,143 minutes old. A run status of `ok` means all five prices were recorded, not that all five were fresh enough to trade. This provider flag/status distinction explains the misleading appearance of healthy BAE data. The evidence establishes stale provider output; it does not establish whether the upstream cause is OTC inactivity, feed delay or entitlement.

## Sizing and reserve calculations

Cash is **A$2,200.20 (42.8143% of equity)**; invested market value is **A$2,938.74**. The minimum cash reserve is **A$1,541.68**, leaving **A$658.52** available for purchases. Each 14% target is **A$719.45**, and the 20% stock ceiling is **A$1,027.79**.

For BAE, budget before share rounding would be `min(719.45 target shortfall, 1027.79 allocation room, 658.52 cash room)` = **A$658.52**, above the A$25 minimum. A fresh eligible quote could therefore support a partial target purchase while retaining 30% cash. The four original positions do not incorrectly exhaust purchasing capacity. Their price gains mean buying BAE fully to 14% would now exceed the cash available above reserve; this is the intended constraint. Repeat purchases in existing stocks require a target shortfall of at least A$25, plus fresh market-open quotes, unused quotes, an active paper-trading switch, and no risk halt. There is no prohibition on buying an already-held stock.

## Preview changes and verification

Added a visible **Last Trading Evaluation** panel with timestamp, per-stock BUY/SELL/HOLD, reason, evaluation-time shares/allocation, latest quote timestamp, purchase eligibility and whether the allocation sell condition was reached. The exact plan's decisions are stored alongside each completed refresh in a nullable JSON database column, using a new additive migration. Previous migration files remain unchanged. Legacy rows explicitly state that no evaluation was persisted rather than fabricating historical decisions. Failed refreshes show their cycle error and do not masquerade as completed trading evaluations. The panel also discloses the absent 60/40 model and institutional data.

TypeScript checking passed. The isolated suite passed 29 tests, with one opt-in live-provider test skipped and no failures. A new integration test exercised the real scheduled algorithm against a disposable database: four existing funded holdings remained HOLD, stale BAE stayed rejected, all five decisions persisted with an evaluation timestamp, and the ledger stayed at four simulated fills. Existing tests checked reserve limits, position caps, duplicate-order guards, quote freshness, risk halts and transactional persistence.

No production deployment, production write, portfolio reset, forced transaction, loosened risk limit or real-money integration was performed. The preview receives the additive schema change through the normal deployment process. Its first completed refresh populates the new panel; older rows correctly show unavailable evaluation history. Production publication remains subject to approval.
