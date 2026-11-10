# Documented 60/40 model, version 1

This paper-only policy replaces automatic equal-weight entries. Its thresholds are explicit policy choices, not a claim of predictive validity. Installing the code does not modify existing holdings or their original trade prices. The remaining cost basis changes only on an actual simulated fill.

## Evidence and point-in-time rules

An operator-only SEC EDGAR connector is available; no manager/performance source has yet been selected. The engine therefore starts with incomplete scores and makes no strategy trades until verified evidence is recorded. It never invents investor holdings, success, financial results or a substitute score. Public regulatory filings are suitable evidence of past reported holdings, but do not establish current holdings or investment success.

An operator must verify original documents and provide the exact source URLs before recording evidence. Verify that the investor's annualised return exceeds the stated comparable benchmark over the same period of at least three years, and that the stock's split-adjusted holding change compares two disclosed reporting periods. Verify financial facts against published accounts and the 90-day return against dated market data for the same instrument. Include any missing, sold-out position in the comparison rather than treating absence as unchanged. An HTTPS link alone is not verification.

Evidence is an append-only Netlify Database record per symbol. The evaluator selects the latest record already stored at decision time. Publication, performance publication, financial publication and capture timestamps must not be in the future. Holdings evidence must be no older than 180 days, financial evidence no older than 120 days, and the operator-specified expiry must be in the future. Expired or invalid latest evidence fails closed; the engine does not fall back to an older favourable record. Performance and benchmark percentages must use the same units and period. All source facts and computed scores are copied into the cycle evaluation for replay and audit.

The server-side operator command is `npx tsx scripts/record-evidence.ts SYMBOL evidence-file --sources-verified`. Run it only against the intended database branch, after the migration is deployed. It stamps capture/record time, validates the rubric and appends a record. There is no public evidence-writing endpoint. The TypeScript `Evidence` type in `lib/scoring.ts` defines required fields. The isolated test fixture illustrates the format using explicitly synthetic data; never import that fixture into a deployed database. Source verification remains an operator responsibility; this release does not automatically download or authenticate financial documents.

## Scoring

Documented successful-investor behaviour receives 100 points for increased reported holdings, 50 for unchanged holdings and 0 for decreased holdings. Eligibility requires documented benchmark outperformance over at least three years; an unqualified investor yields an incomplete score, not zero.

Independent analysis receives 25 points for each of: positive revenue growth, positive free cash flow, interest coverage of at least 3 and positive 90-day return. All four inputs require verified sources, even if a check fails. A complete composite is `0.60 × institutional + 0.40 × independent`. Any missing or invalid evidence produces a null composite, not a reweighted 40% strategy.

## Entry, exits and risk

BUY requires composite >=70 and independent >=50. Qualified entries size towards 14% of current equity, with a minimum A$25 budget, a hard 20% per-stock purchase ceiling and 30% cash reserve. Equity at or below A$2,500 or an active persisted risk halt blocks purchases.

For a held stock, the -8% stop from remaining average AUD cost is an independent risk exit even with missing or expired investor evidence. Complete evidence permits additional full exits at composite <=35 or a +15% profit target. The evaluation shows AUD/share targets and the exact triggered exit. It cannot sell and repurchase a stock in one cycle. Without complete evidence, score and profit-target exits are inactive; the stop remains active. Allocation above 20% can still trigger an explicitly labelled risk trim towards 14%, independently of investment scoring. This retains the existing mandatory risk control; it is never presented as a scored investment signal.

Every fill requires a positive, finite, fresh quote from this cycle, an open provider market flag, fresh FX and an unused quote timestamp. Quotes older than 20 minutes, FX older than 120 minutes and timestamps more than one minute in the future block trading. Held positions must all have fresh valuations so equity-based limits can be verified. Risk limits cannot prevent market movements from taking an existing position above 20% or cash below 30%; blocked trims are recorded rather than filled at stale prices.

## Persistence and scheduling

The scheduled handler awaits `runCycle`, which fetches quotes and FX before invoking the evaluator, with the evaluation clock sampled after fetching. Scheduled cycles wait for the transaction lock and are not dropped by dashboard throttling. Repeated provider quotes cannot produce another fill. Each evaluated cycle persists five timestamped BUY/SELL/HOLD decisions, precise reasons, explicit rejected-order sides when a valid intended order is blocked, score components and evidence, targets, allocation and future eligibility conditions in `fetch_runs.evaluation`. Executed fills remain in `trades`. These changes commit atomically with positions and cash.

Provider failures and missing credentials also persist five HOLD decisions and an error run; historical evaluations are never invented. Database outages or transaction failure cannot guarantee persistence; the scheduled handler logs failure. The dashboard finds the latest non-null persisted evaluation rather than hiding it behind an unevaluated legacy row. Netlify scheduled functions run on published deployments only; previews exercise the same cycle through `/api/refresh` or isolated tests.

There is no broker integration. Real-money trading remains disabled.

## SEC collection

`npx tsx scripts/collect-edgar-evidence.ts manifest.json --sources-verified` fetches official SEC XML information tables and US GAAP companyfacts, plus Twelve Data daily history. It appends a verified evidence record only; it never runs trading. Configure an identifying `SEC_USER_AGENT` contact and the existing market-provider credential before collection. No collection was run against a deployed database during development.

The manifest contains `symbol` and `edgar` (the documented `EdgarInput` type in lib/edgar.ts). An operator must verify both filings belong to the same manager, represent consecutive original quarters, use the correct CUSIP/security class, and have accurate publication dates. Amendments, splits and ADR conversions require reconciliation before import. Both periods must contain positive comparable share holdings; missing rows are not assumed liquidations. Manager annualised returns and a comparable benchmark over at least three years require independent documented verification; SEC holdings do not prove success.

The adapter calculates share percentage change, annual revenue growth, operating cash flow less capital expenditure, operating income divided by positive interest expense, and 90-calendar-day price return. Financial facts must share an accession and annual period. Latest annual filings must meet the existing 120-day freshness policy. Quarterly/TTM and IFRS facts are not yet supported; BAE stays blocked unless separately verified evidence is supplied. Provenance retains previous/current filing references, reporting periods, financial accession and credential-free market source.

The scheduled trading cycle consumes the latest dated evidence and persists five decisions even during provider outages. SEC collection is currently operator initiated, not a scheduled automatic refresh. Evidence expires after at most 24 hours and requires recollection; expiry blocks purchases, never valid stops.
