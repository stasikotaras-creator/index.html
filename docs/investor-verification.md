# Defence investor verification — 10 November 2026

Research captured between approximately 17:08 and 17:16 UTC on 10 November 2026. Priority followed the requested order: Fidelity Select Defense and Aerospace Portfolio, TCI Fund Management, then specialist defence funds. All findings below are research only. No evidence was imported, no manager was enabled, and no portfolio or risk settings were changed.

## Fidelity Select Defense and Aerospace Portfolio (FSDAX)

**Current decision: ineligible for new strategy purchases.** Fidelity is a relevant sector research source and has verified company exposure, but the latest common five-year performance window underperforms its published sector benchmark. The latest common three-year window also underperforms. Dated fund holdings have not been converted into the consecutive-quarter share comparison required by the institutional rubric.

### Identity and sources

The official Fidelity fund response identifies FSDAX, CUSIP **316390806**, fund number 67, inception 8 May 1984, an actively managed retail mutual fund. This is the verified fund identifier; superficially similar Fidelity fund identifiers must not be substituted.

- [Fund summary](https://fundresearch.fidelity.com/mutual-funds/summary/316390806).
- [Official performance response](https://fundresearch.fidelity.com/mutual-funds/api/v1/investments/316390806/performance-risk?funduniverse=RETAIL).
- [Official composition response](https://fundresearch.fidelity.com/mutual-funds/api/v1/investments/316390806/composition?funduniverse=RETAIL).
- [Official report selector](https://fundresearch.fidelity.com/prospectus/eproredirect?clientId=Fidelity&applicationId=MFL&securityId=316390806&securityIdType=CUSIP&critical=N). Its Fidelity ActionsXchange document repository supplied the annual financial statements (collection 1062293, document **1.813657.PDF**, published 29 April 2026), semiannual financial statements (collection 1105399, **1.813660.PDF**, published 30 October 2026), and September holdings listing (collection 1106871, **dscportm.67.ALL.260930.260930.st_r_domeq_aa.NA.1.pdf**, published 30 October 2026). The selector uses transient document URLs; document identities and content hashes are recorded below instead of copying those query strings.
- [SEC registrant metadata](https://data.sec.gov/submissions/CIK0000320351.json) confirms **FIDELITY SELECT PORTFOLIOS**, CIK 320351. The annual financial statements identify the Defense and Aerospace Portfolio as a fund of this trust and identify **Fidelity Management & Research Company LLC** as investment adviser. These establish the fund/trust/adviser relationship. A Fidelity-wide 13F cannot substitute for this fund's portfolio.

The SEC metadata contains multiple NPORT-P filings for the trust, including reports dated 31 August 2026 filed 26 October 2026. Archive XML access returned HTTP 403, so no particular NPORT accession or series identifier was independently assigned to FSDAX. The present collector only handles manager 13F-HR, not fund-specific N-PORT. No placeholder manager CIK or accession was supplied to bypass that distinction.

### Performance against the appropriate benchmark

The provider labels the S&P 500 as its primary broad-market benchmark and **MSCI US IMI Aerospace & Defense 25/50 Linked Index** as its secondary, sector-specific benchmark. The sector benchmark is the relevant comparison for this defence-sector qualification. Broad-market results are disclosed alongside it; the benchmark was not switched to make the candidate pass.

All figures are provider-published annualized percentage returns for the same end date and horizon. Quarter-end fund returns below use the provider's before-tax series, not after-tax liquidation returns. Comparisons concern the fund as a whole; none establishes which holding generated the return.

| Period ending | Horizon | FSDAX | Sector index | Difference (percentage points) | S&P 500 |
| --- | --- | ---: | ---: | ---: | ---: |
| 31 October 2026 | 3 years | 25.21% | 25.98% | −0.77 | 23.40% |
| 31 October 2026 | 5 years | 15.70% | 17.11% | −1.41 | 12.06% |
| 31 October 2026 | 10 years | 13.83% | 15.58% | −1.75 | 15.44% |
| 30 September 2026 | 3 years | 27.49% | 27.21% | +0.28 | 22.89% |
| 30 September 2026 | 5 years | 15.94% | 16.79% | −0.85 | 13.79% |
| 30 September 2026 | 10 years | 14.11% | 15.59% | −1.48 | 15.33% |

September's three-year comparison beats the sector index slightly. It was not selected over the newer October data or the preferred common five-year window. Using the disclosed complete calendar-year returns for 2023–2025 gives a compounded annualized fund return of **26.3861%**, versus **26.8776%** for the sector benchmark; 2021–2025 gives **17.7568%** versus **19.8198%**. These cross-checks used `100 × (product(1 + annualReturn / 100)^(1 / years) − 1)`, not arithmetic averages. The calendar figures are distinct from trailing October figures.

The official manager profile names Todd M Haggerty with tenure since 31 July 2025. Longer fund returns do not establish a three-year personal track record for the current named manager. The provider response was checked; no claim was made that the web performance schedule was independently audited or fully reconciled to an audited total-return ledger. Actual publication timestamps of the live API tables were not supplied; their **as-of dates** are not publication dates. They cannot be backdated into trade evidence.

### Direct exposure and dated holdings

The Defense and Aerospace Portfolio's Schedule of Investments, PDF page 3 in both annual and semiannual financial statements, reports the following **direct common-stock quantities**:

| Company | 28 February 2026 shares | 31 August 2026 shares | 30 September 2026 listing weight | Security identity |
| --- | ---: | ---: | ---: | --- |
| LMT | 78,200 | 102,200 | 1.523% | Lockheed Martin common, CUSIP 539830109 |
| RTX | 2,754,800 | 2,735,800 | 15.08% in composition response | RTX common, CUSIP 75513E101 |
| GD | 475,800 | 418,100 | 4.12% in composition response | General Dynamics common, CUSIP 369550108 |
| NOC | 82,300 | 77,400 | 1.113% | Northrop Grumman common, CUSIP 666807102 |
| BAE | 1,166,700 | 1,163,700 | 0.913% | BAE Systems PLC ordinary shares, ISIN GB0002634946; not the BAESY ADR |

The September listing corroborates named exposure. It explicitly allows look-through allocations from underlying Fidelity Central Funds and is unaudited, so the annual/semiannual Schedule of Investments is the basis for the direct-holding conclusion. Rounded top-ten weights differ from full-listing precision; they are not share quantities. The February-to-August change spans six months, not consecutive quarters, and was not used to generate a 100/50/0 institutional signal. Dollar values and weights do not establish purchases or sales. BAE ordinary-share exposure does not establish a BAESY ADR holding; a verified security and corporate-action reconciliation remains necessary.

## TCI Fund Management

**Current decision: ineligible — performance and matching exposure unverified.** [TCI's official website](https://www.tcifund.com/) identifies TCI Fund Management Limited, UK company 08898250, an FCA-regulated adviser, and describes the concentrated TCI Master Fund. The public page offers an investor login; a dated public fund/share-class total-return series, fees, currency and comparable benchmark series were not obtained. Media claims of strong returns would not satisfy this requirement.

[SEC submissions](https://data.sec.gov/submissions/CIK0001647251.json) identify **TCI Fund Management Ltd**, CIK 1647251. The latest two original 13F-HR filings visible in the retrieved metadata were:

| Reporting period | Filed | Accession |
| --- | --- | --- |
| 30 June 2026 | 14 August 2026 | 0001647251-26-000007 |
| 31 March 2026 | 15 May 2026 | 0001647251-26-000004 |

The September-quarter filing was not assumed to exist before publication. SEC archive directory requests returned HTTP 403; the actual information tables were not retrieved. Direct LMT, RTX, GD, NOC and BAE exposure therefore remained **unverified for all five**. Matching an adviser name does not reconcile Master Fund performance with the manager's aggregate 13F. TCI was not enabled, and research continued to specialist funds.

## Specialist defence-sector funds

### iShares U.S. Aerospace & Defense ETF (ITA)

**Current decision: ineligible — benchmark underperformance.** The [official factsheet](https://www.ishares.com/us/literature/fact-sheet/ita-ishares-u-s-aerospace-defense-etf-fund-fact-sheet-en-us.pdf), as of 30 September 2026, reports USD NAV annualized returns of **25.92% / 15.63% / 13.47%** over three/five/ten years, compared with **26.35% / 16.04% / 13.92%** for the **Dow Jones U.S. Select Aerospace & Defense Index**. The five-year difference is −0.41 percentage points. The factsheet states that distributions are reinvested and fund expenses are deducted. Strong absolute performance does not satisfy outperformance.

The [official holdings CSV](https://www.ishares.com/us/products/239502/ishares-u-s-aerospace-defense-etf/latest-holdings.csv), dated **9 November 2026**, reports RTX **10,251,164** shares / **16.50%**, LMT **1,062,064** / **5.12%**, NOC **1,080,382** / **4.78%**, and GD **1,579,406** / **4.69%**. No BAE security was found in this dated full list; this is not proof of a sale. Only one dated snapshot was retrieved, so no holding-change signal was calculated. The [prospectus](https://www.ishares.com/us/literature/prospectus/p-ishares-trust-dj-us-sector-3-31.pdf) identifies iShares Trust and includes ITA. [SEC metadata](https://data.sec.gov/submissions/CIK0001100663.json) confirms **iSHARES TRUST**, CIK 1100663. No fund-specific N-PORT accession/series mapping was completed.

### State Street SPDR S&P Aerospace & Defense ETF (XAR)

**Current decision: ineligible — benchmark underperformance.** The [official product page](https://www.ssga.com/us/en/individual/etfs/spdr-sp-aerospace-defense-etf-xar) reports, as of **30 September 2026**, before-tax NAV annualized returns of **27.89% / 14.70% / 15.59%** over three/five/ten years, versus **28.33% / 15.07% / 15.99%** for the **S&P Aerospace & Defense Select Industry Index**. The five-year difference is −0.37 percentage points. The page specifies net-of-fee performance with dividends and capital gains reinvested.

The [official daily holdings workbook](https://www.ssga.com/library-content/products/fund-data/etfs/us/holdings-daily-us-en-xar.xlsx), dated **9 November 2026**, reports LMT **295,466** shares / **3.305565%**, NOC **300,544** / **3.081582%**, GD **439,374** / **3.025850%**, and RTX **784,373** / **2.928772%**, with matching nine-character CUSIPs. No BAE security was found in this dated full list; no liquidation was inferred. [SEC metadata](https://data.sec.gov/submissions/CIK0001064642.json) confirms **SPDR SERIES TRUST**, CIK 1064642. The exact XAR series/accession reconciliation was not completed; the trust identity alone would not qualify holdings. No consecutive comparable snapshots were scored.

Both ETFs track sector indices. Their disclosed holdings are useful sector references, but benchmark rebalancing is not evidence of discretionary stock selection skill.

## Five-stock strategy status and protective stops

The managed preview database's last persisted trading evaluation, read without invoking a refresh, was **2026-11-10T17:00:40.826Z**. It contained no qualifying investment evidence. The new research above was deliberately kept out of trading evidence because it did not qualify.

| Stock | Institutional /100 (60%) | Independent /100 (40%) | Composite /100 | Recorded decision | Quote timestamp UTC | Qualifying source/publication/capture/expiry |
| --- | --- | --- | --- | --- | --- | --- |
| LMT | unavailable | unavailable | incomplete | HOLD | 10 Nov 2026 17:00:00 | none / unavailable |
| RTX | unavailable | unavailable | incomplete | HOLD | 10 Nov 2026 17:00:00 | none / unavailable |
| GD | unavailable | unavailable | incomplete | HOLD | 10 Nov 2026 17:00:00 | none / unavailable |
| NOC | unavailable | unavailable | incomplete | HOLD | 10 Nov 2026 17:00:00 | none / unavailable |
| BAE | unavailable | unavailable | incomplete | HOLD | 9 Nov 2026 20:58:00 | none / unavailable |

These are historical recorded decisions, not live instructions. BAE's quote was also stale. Incomplete is not zero: neither a full composite nor an independent component was invented from unverified company financial data. Research-source dates above do not populate missing trading-evidence timestamps. New 60/40 purchases remain blocked until complete, current, matching evidence passes the existing rubric.

The existing −8% stop remains independent of investor evidence. It sells the entire remaining position at or below 92% of remaining average cost, subject to existing fresh-quote, fresh-FX, market-open, valuation, pause and duplicate-execution protections. Missing investor evidence cannot veto that protective exit; unknown equity or an invalid execution quote can still prevent a fill. No thresholds were relaxed and no same-cycle repurchase was introduced. Regression tests cover missing evidence, stale unrelated holdings and ledger preservation. A further test covers all five protective stops when the investor fails the sector benchmark and verifies HOLD when the stop is not reached.

## Source integrity

The following SHA-256 hashes identify the retrieved public source bytes. They are document hashes, not credentials. No raw third-party logo URLs, signed image references or transient document query strings were added to the repository.

| Source | SHA-256 |
| --- | --- |
| Fidelity performance response | 24a596d029454ec6ab754fbcfefd7698b12ea4f01d91f7502ae0410ba2d3bbba |
| Fidelity composition response | 3d794511a1e4ba183d97901bad031ecbe8e6a0c44ab54780a61b7a9832479343 |
| Fidelity annual statements, 1.813657.PDF | ff474a6074c8992d11903e646c5de656ac11d2d3f0aa498f7f54633940010bb3 |
| Fidelity semiannual statements, 1.813660.PDF | dd61eb5397c5082e42d4992bdea0a7f8bb99ad09f8d8e99e8b0418187d284d93 |
| Fidelity September holdings PDF | 778f053de79b444807f1d2463bb9a476051af7ada44bb8ca2cd4fa1c0ecb4df9 |
| TCI SEC metadata | 62809dd133f25a1d2447602f2b2f8839a0a580956afa99179fbad07cb801c641 |
| ITA factsheet | 039700a410395617de45b1a5aa4690348646a0ef763e1f94b1ed16f54a359e53 |
| ITA holdings CSV | 26c1b70d74099dc9e4d237a6f4746407172ffe65487ea884e217758b1324e9be |
| XAR holdings workbook | 966d10ec36404cfae6d465c174d24d170afbc960829515ac5270e024387b6614 |

No current candidate supplied a complete eligible evidence chain. Research can continue without changing that conclusion into a forced score or trade. The quarterly/TTM and separate BAE company-financial adapters remain implemented and fixture-tested; live BAE report compatibility and the scheduled autonomous evidence service remain unverified. Existing portfolio positions, migrations and risk protections were preserved, and real-money trading remained disabled.

## Validation and preview boundary

The full automated suite passed **45 tests with zero failures**, preserving all 44 previously passing tests and adding one five-stock protective-stop regression. One opt-in live-market-provider test remained skipped. TypeScript validation passed. The new regression verified that all five positions exited at the exact −8% boundary with an ineligible investor score and that the same positions remained HOLD without a stop trigger; the existing suite continued to cover missing investor evidence, stale unrelated holdings, duplicate-order prevention and ledger preservation.

Netlify Dev on port 8889 returned HTTP 200 for the verification page, report and existing dashboard page. Content checks verified the five incomplete HOLD rows and the report link; the dashboard's inline JavaScript parsed. The read-only verification preview contained no scripts, forms, trading endpoints or portfolio connection. This checked the report presentation and did not establish a successful live dashboard API or live BAE ingestion.

A separate hosted **draft research preview** reached the ready state without changing the published production deployment. Anonymous HTTP requests to it returned **401**. Existing visitor protection was preserved, so authenticated hosted rendering remained unverified. The draft packaged the verification page and this report only; it was not a full-application deployment or end-to-end hosted ingestion test. Production deployment was not performed.

A final read-only database inspection showed the existing GD 1.3635, LMT 0.8513, NOC 0.9195 and RTX 2.5472 positions, four trade records and zero investment-evidence rows. BAE had no position. No refresh/trading endpoint or evidence-import command was invoked. These records were not rewritten by the research, tests or static preview deployment.
