# Data-access diagnostic — 10 November 2026

All results below are from live, read-only requests made through the real preview function (`/api/verify-financial-data`) under Netlify Dev at about 17:40 UTC. Nothing was traded, imported or reset, and no risk limit was changed. Real-money trading remains disabled.

## Results by integration

| Integration | Result | Detail |
|---|---|---|
| SEC identification | PASS | `SEC_USER_AGENT` configured as "Name contact@domain"; requests ≤5/second, gzip, Retry-After backoff |
| SEC submissions · TCI (CIK 1647251) | PASS | Identity verified; latest original 13F-HR period 30 Jun 2026, filed 14 Aug 2026 |
| SEC holdings archive | PASS | `index.json` HTTP 200 (previously 403) |
| SEC 13F information table | PASS | Retrieved and parsed (11 CUSIPs) |
| TCI holdings in research universe | FAIL | No LMT, RTX, GD, NOC or BAESY CUSIP in the latest 13F |
| Investor qualification | FAIL | No manager has verified ≥3-year benchmark outperformance |
| SEC financials · LMT | PASS | TTM, eight consecutive quarters to 27 Sep 2026, filed 22 Oct 2026 |
| SEC financials · RTX | PASS | TTM to 30 Sep 2026, filed 20 Oct 2026 |
| SEC financials · GD | PASS | TTM to 4 Oct 2026, filed 30 Oct 2026 |
| SEC financials · NOC | PASS | TTM to 30 Sep 2026, filed 20 Oct 2026 |
| BAE ESEF report (UK IFRS) | PASS | FY2025 annual report, LEI 8SVCSVKSGDWMW2QHOH83, GBP, unsegmented facts, SHA-256 recorded |
| BAE financial checks | FAIL | Stale: latest tagged report indexed 24 Mar 2026; the 120-day policy is unchanged |
| Market history · LMT/RTX/GD/NOC/BAESY | PASS ×5 | Fresh history; all five 90-day returns negative (−0.33%, −9.77%, −6.57%, −4.31%, −14.47%) |
| Protective −8% stop (synthetic, no research data) | PASS | −8.00% SELL, −9.00% SELL, −7.99% no order |
| 60/40 score · all five | FAIL (incomplete) | No institutional evidence; incomplete, not zero |

## 1. SEC archive 403

The 403 body read "Your Request Originates from an Undeclared Automated Tool". The diagnostic probe sent no User-Agent when `SEC_USER_AGENT` was unset. `www.sec.gov/Archives` enforces SEC's fair-access policy; `data.sec.gov` happened to accept the default client. After the operator contact was configured, the same archive URL returned HTTP 200.

All SEC requests now go through one client (`lib/sec.ts`), which:
- refuses to send a request without a "Name contact@domain" User-Agent;
- requests gzip;
- serialises requests at ≤5/second;
- retries only 429/503, honouring Retry-After;
- reports any 403 with a diagnosis and does not retry, spoof or work around it.

## 2. US financial mappings

The mapper now uses verified per-issuer profiles. Each metric must come from the same filing and period, and quarters are derived from year-to-date filings.

- **LMT:** `InterestExpenseNonoperating` (lower-case "o") and `PaymentsToAcquireProductiveAssets` (capital expenditures).
- **RTX:** the income statement presents only "Interest expense, net". `InterestIncomeExpenseNonoperatingNet` is sign-inverted and accepted only when it is a net expense.
- **GD:** net interest is handled the same way (`InterestIncomeExpenseNet`). GD has discontinued operations, so continuing-operations cash flow alone is rejected. Total operating cash is continuing plus discontinued operating cash from the same filing.
- **NOC:** gross `InterestAndDebtExpense`.

RTX and GD interest coverage is therefore on the issuer-presented net basis, and the evidence records which concepts were used.

## 3. BAE Systems (UK)

The BAE results page answers HTTP 200, but the body is an Incapsula bot challenge, not the report index. Earlier "reachable" findings were false positives, and the challenge was not bypassed.

The new UK adapter reads BAE's official ESEF annual report (UK-adopted IFRS, as filed with the FCA National Storage Mechanism) from XBRL International's filings index. It accepts only facts that are:
- for LEI 8SVCSVKSGDWMW2QHOH83 (confirmed with GLEIF; the old allow-list had a wrong LEI);
- in GBP and unsegmented.

Interest uses FinanceCosts, a conservative superset of interest. Capex uses BAE's extension concept for PP&E purchases. BAE's half-year results are not tagged, so only annual data can be verified. That data is stale today, and BAE stays incomplete until the FY2026 report is filed.

## 4–6. Portfolio, scores and stop

- **Portfolio:** production read-back is unchanged: A$5,000 starting capital, A$2,200.20 cash, LMT 0.8513, RTX 2.5472, GD 1.3635, NOC 0.9195, BAE 0, four trades, real money off. The five-stock universe is unchanged.
- **Scores:** none were reported. Every stock lacks a qualified investor's holding-change evidence.
- **Stop:** the −8% stop passes independently of research data, both in the preview self-test and in the suite.
- **Tests:** 52 tests pass, 0 fail, and 1 opt-in live-provider test is skipped. TypeScript validation passes.

## 7. Hosted preview "Forbidden"

There are two separate causes, and neither is an application fault.

1. **CLI draft deploy rejected.** This environment authenticates with a scoped runner token: user-level API calls return Unauthorized. That token is not authorised to create manual CLI deploys. Git and agent-runner deploy previews build successfully (deploy-preview-10, deploy-preview-11 and agent previews are all "ready"). The supported route is the automatic preview of this change.
2. **Preview URLs return 401 to anonymous visitors.** They redirect to Netlify team login (`edge-access`), because non-production deploys are visible only to team members. Signed-in team members can open the preview. This protection was not weakened.

## Remaining blockers

- A qualified investor (verified ≥3-year benchmark outperformance) that holds the five securities in consecutive original 13F filings.
- BAE FY2026 ESEF filing, or tagged interim data.
- BAESY ordinary/ADR holdings reconciliation.
