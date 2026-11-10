# TradeGuard diagnostic report — 10 November 2026

Current verification continuation: [Fidelity, TCI and specialist defence-fund verification](investor-verification.md) records the newer research priority, verified exposures and current ineligibility findings.

## Safety correction

The -8% remaining-average-cost stop previously required a complete institutional score. It now operates independently of institutional/financial evidence. Score exits and +15% profit exits still require complete evidence. A valid stop exits the entire remaining position and cannot repurchase in the same cycle.

A stale quote in another held stock no longer overwrites the stopped stock's valid trade permission. Missing/stale held valuations still halt all purchases. Market-open, current quote, current FX, future-date rejection, pause and duplicate-order checks still apply to each exit. If portfolio equity cannot be valued at all, the existing full-cycle skip remains; this change does not authorise fills with unknown equity.

## Investment intelligence

Added an operator-only SEC adapter and collection command. They retrieve two official SEC XML 13F information tables, compare CUSIP share quantities, retrieve matching US GAAP annual companyfacts, and obtain 90-day market return from Twelve Data. The persisted evidence includes both filing references and reporting periods, financial accession, capture/publication/expiry dates and a credential-free market reference. The existing documented scoring rubric calculates 60% investor behaviour and 40% financial/market checks. The collector appends evidence only and never invokes trading.

This is not yet an operational autonomous SEC ingestion service. Manager selection and independently verified three-year benchmark outperformance remain required. An operator must verify manager/security identity, original consecutive filings, publication dates and corporate-action adjustments. The connector does not independently verify those attestations. Missing CUSIPs are rejected rather than treated as verified sales. No live SEC collection was performed. Quarterly/TTM, IFRS and BAE ADR reconciliation are not implemented. Annual financial facts must satisfy the existing 120-day freshness policy, so many issuers remain ineligible between annual reporting windows. Automatic evidence refresh remains outstanding; collected evidence expires within 24 hours. These limitations keep purchases blocked where evidence is incomplete.

## Automation and preservation

The existing scheduled cycle continues to persist BUY/SELL/HOLD decisions and rejection reasons for all five stocks, including market-provider outages. Purchases require complete scores, fresh unused quotes/FX, fresh held valuations and all risk guards. The 20% per-stock ceiling, 30% minimum cash reserve and A$2,500 equity purchase halt remain unchanged. Real-money trading remains disabled, with no broker integration.

No deployed database writes, evidence imports, portfolio resets or forced trades were performed. Existing applied migrations were untouched. All test holdings and fills existed only in disposable isolated databases. This run did not independently re-inspect current production holdings.

## Validation and preview

The full suite passed 40 tests with zero failures; one opt-in live-provider test was skipped. TypeScript validation passed. New tests cover missing evidence during a synthetic 10% crash, stale unrelated holdings, full stop liquidation, original ledger preservation, the exact -8% boundary and blocked quotes. SEC fixture tests cover calculations, provenance and rejection paths; both passed again after the final date validation change.

Netlify Dev served the local preview on port 8889 with HTTP 200 and loaded the existing functions. Only the static page was requested; no trading endpoint was invoked. The local server was stopped after checking. No hosted preview or production deployment was created, and live provider connectivity was not verified. A hosted preview and deployment remain subject to user approval.

## Investor-source review continuation

The requested candidate proposal is in `docs/investor-candidates.md`. It shortlists Berkshire, Fundsmith and Pershing Square, distinguishes shareholder/NAV/fund performance from aggregated 13F behaviour, and proposes a comparable total-return CAGR qualification method. Berkshire report URLs were reachable; Fundsmith access was intermittent and Pershing/SEC archive access was blocked. No performance figures or current institutional holdings were independently verified. No candidate was enabled and no evidence was imported. Automatic ingestion, quarterly/TTM and BAE support remain outstanding. The shortlist is ready for review; it does not imply the full investment intelligence service is complete.
