# Financial integration verification — 10 November 2026

The merged integration did not produce a valid, source-backed investment score for any of the five stocks. The production dashboard was reachable, but every persisted score was incomplete with null institutional, independent and composite values. This was a blocked pipeline, not five zero scores or a successful live financial integration.

## Hosted observation

Read-only GET requests to https://revel-tradeguard.netlify.app/api/dashboard at 17:23:30 and 17:25:30 UTC confirmed production context, paper automation enabled and real-money trading disabled. Evaluation run 217, evaluated at 17:15:30 UTC, recorded HOLD for LMT, RTX, GD, NOC and BAE because verified institutional and financial evidence was missing. BAE also had a stale BAESY quote from 9 November at 20:58 UTC; its presence among five recorded prices did not make it tradeable.

Cash remained A$2,200.20. Positions remained LMT 0.8513, RTX 2.5472, GD 1.3635, NOC 0.9195 and BAE zero. Cost bases and the four-entry trade ledger were identical across both reads. No refresh/trading endpoint was invoked, evidence imported, portfolio reset, trade forced, migration changed or real-money setting enabled.

## Live source checks

The following probes ran through Netlify Dev locally at 17:25:29 UTC. They used real remote sources but did **not** establish connectivity from hosted Netlify Functions. No identifying SEC contact was configured in the available environment/project configuration; accessible anonymous metadata did not verify the collector's required identifying User-Agent.

| Stock | SEC retrieval | Current adapter result | Source-backed composite |
|---|---|---|---|
| LMT | Companyfacts HTTP 200 | 40 matched periods; rejected as stale | Unavailable |
| RTX | Companyfacts HTTP 200 | 26 matched periods; rejected as stale | Unavailable |
| GD | Companyfacts HTTP 200 | 66 matched periods; rejected as stale | Unavailable |
| NOC | Companyfacts HTTP 200 | Zero periods containing all required matching facts | Unavailable |
| BAE / BAESY | Official results index HTTP 200 | No independently verified compatible report set | Unavailable |

SEC sources: [LMT](https://data.sec.gov/api/xbrl/companyfacts/CIK0000936468.json), [RTX](https://data.sec.gov/api/xbrl/companyfacts/CIK0000101829.json), [GD](https://data.sec.gov/api/xbrl/companyfacts/CIK0000040533.json), [NOC](https://data.sec.gov/api/xbrl/companyfacts/CIK0001133421.json).

Further live inspection established that current company facts existed, but the mapper could not assemble them. Latest complete matched periods were LMT 29 September 2013, RTX 31 December 2024 and GD 31 December 2023. LMT disclosed `InterestExpenseNonoperating`, while the adapter requested `InterestExpenseNonOperating` with different case; its supported capex tag ended in 2013. GD also disclosed continuing-operations cash flow outside the selected cash-flow mapping. RTX's supported interest facts ended in 2024. NOC had no supported direct interest-expense tag. These require issuer-specific, source-verified mappings/disclosures; stale-data limits should not be relaxed to manufacture scores.

[TCI submissions](https://data.sec.gov/submissions/CIK0001647251.json) returned HTTP 200 with matching CIK and latest original period 30 June 2026. The [associated archive directory](https://www.sec.gov/Archives/edgar/data/1647251/000164725126000007/index.json) returned HTTP 403. The two information tables, CUSIP share comparisons and original/amended filing reconciliation were therefore not verified end to end. TCI performance qualification remained unverified. The earlier [investor review](investor-verification.md) also documented benchmark underperformance for Fidelity FSDAX, ITA and XAR, which cannot be bypassed by a positive absolute return.

The [BAE results index](https://www.baesystems.com/en/investors/results-and-reports) was reachable. This did not establish compatibility with the adapter, which requires official inline-XBRL reports, independently verified hashes/publication dates, matching issuer identity, unsegmented GBP IFRS metrics and specifically disclosed interest expense. No such report set was supplied or qualified. PDF, custom taxonomy and unsupported-format compatibility remained blockers. The 4:1 ordinary-share/ADR mapping and GBP ratio handling passed synthetic tests only; ordinary-share institutional holdings still require reconciliation with the traded BAESY security.

Live Twelve Data daily history requests succeeded for LMT, RTX, GD, NOC and BAESY, with USD identity and usable 90-day baselines. The four US latest dates were 10 November; BAESY's was 9 November. Momentum history met the collector's five-day rule but did not make the stale intraday BAESY quote eligible for execution. All five calculated 90-day returns were negative at capture; this is a failed momentum check, not missing data.

## Scoring and protective execution

The final suite passed 46 tests with zero failures; its opt-in live-provider test was skipped in that run. A separate enabled live-provider test passed using a disposable PGlite database, recorded five real quotes and FX, and made no trades. This exercised the real cycle with missing evidence, not a successful source-backed score.

A new isolated end-to-end test passed for all five stocks simultaneously: synthetic positions each declined 10% from remaining average cost with no investment evidence. The real cycle persisted five full SELL exits, zero remaining positions/cost bases, correct cash proceeds and five incomplete-score SELL decisions. A subsequent cycle added no fills. Existing tests also passed the exact -8% boundary, stale unrelated holding behavior, stale/closed/future quote rejection, pause and duplicate guards. These were simulated executions only, with no connection to the existing portfolio. TypeScript validation passed.

The 60/40 formula, source provenance construction and quarterly/TTM/BAE calculations passed fixture tests. A complete live chain from qualified investor performance through two verified filings, company financials, market history, persisted evidence and a composite score remained unverified for every stock. Operator-only collection still requires reviewed manifests and expires evidence within 24 hours; autonomous evidence refresh remains absent.

## Preview and remaining deployment blocker

A preview-only read-only diagnostic endpoint was added at `/api/verify-financial-data`. It has no database access, evidence insertion or trading calls and returns 404 in production. The existing verification page returned HTTP 200 locally on port 8889, and the diagnostic endpoint returned live source results. The local server was stopped after verification.

A separate draft deployment was attempted with only the static verification page/report and the diagnostic function, excluding portfolio and trading endpoints. The CLI rejected it with `Forbidden`; no successful hosted preview URL was returned. The CLI also rejected combining a deployment-context flag with its no-build option, so the retry used the supported draft deployment form. No build command or production deployment was run. Deployment access must be restored before a working hosted preview and hosted-function source connectivity can be confirmed. Existing site protection was not weakened. The earlier research-only draft described in the investor report was not treated as a working integration preview.

Remaining blockers were deployment access; hosted source-connectivity verification; missing identifying SEC contact; SEC archive 403; qualified investor performance and consecutive security holdings; US issuer tag/disclosure coverage; independently verified compatible BAE reports and ADR holdings reconciliation; stale BAESY execution quotes; and an operational evidence refresh process. Production changes should wait for a working hosted preview and resolution of the evidence blockers.
