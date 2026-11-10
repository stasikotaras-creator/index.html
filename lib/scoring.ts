// Versioned, point-in-time rubric. Inputs are source-linked facts, never model-generated scores.
export type Evidence = {
  provenance?: { input: import("./edgar.js").EdgarInput; financialAccession: string; financialPeriod: string; market: { return90dPct: number; sourceUrl: string; publishedAt: string } };
  publishedAt: string; capturedAt: string; expiresAt: string; sourceUrl: string;
  institutional: { investor: string; performanceSourceUrl: string; performancePublishedAt: string;
    years: number; annualReturn: number; benchmarkReturn: number; holdingChangePct: number };
  financial: { basis?: string; period?: string; accessions?: string[]; sourceUrl: string; publishedAt: string; revenueGrowthPct: number;
    freeCashFlowPositive: boolean; interestCoverage: number; return90dPct: number };
};
export type Score = { complete: boolean; institutional: number | null; independent: number | null;
  total: number | null; reason: string; evidence: Evidence | null };
const url = (s: string) => { try { return new URL(s).protocol === 'https:'; } catch { return false; } };
export function scoreEvidence(e: Evidence | undefined, now: Date): Score {
  const missing = (reason: string): Score => ({ complete: false, institutional: null, independent: null, total: null, reason, evidence: e ?? null });
  if (!e) return missing('Incomplete: no verified institutional and financial evidence available.');
  const time = (s: string) => Number.isFinite(Date.parse(s)) && Date.parse(s) <= now.getTime();
  const i = e.institutional, f = e.financial;
  if (!i || !f || !url(e.sourceUrl) || !url(i.performanceSourceUrl) || !url(f.sourceUrl) ||
      ![e.publishedAt, e.capturedAt, i.performancePublishedAt, f.publishedAt].every(time) ||
      !(Date.parse(e.expiresAt) > now.getTime()) || now.getTime() - Date.parse(e.publishedAt) > 180 * 86400000 ||
      now.getTime() - Date.parse(f.publishedAt) > 120 * 86400000 ||
      !i.investor || i.years < 3 || ![i.years, i.annualReturn, i.benchmarkReturn, i.holdingChangePct,
        f.revenueGrowthPct, f.interestCoverage, f.return90dPct].every(Number.isFinite) ||
      typeof f.freeCashFlowPositive !== 'boolean' || i.annualReturn <= i.benchmarkReturn)
    return missing('Incomplete: evidence is invalid, expired, future-dated, or lacks documented benchmark outperformance over at least three years.');
  const institutional = i.holdingChangePct > 0 ? 100 : i.holdingChangePct < 0 ? 0 : 50;
  const independent = [f.revenueGrowthPct > 0, f.freeCashFlowPositive, f.interestCoverage >= 3, f.return90dPct > 0]
    .filter(Boolean).length * 25;
  return { complete: true, institutional, independent, total: institutional * .6 + independent * .4,
    reason: `Documented holding change ${i.holdingChangePct}%; independent checks ${independent}/100. Disclosures describe past behaviour, not current holdings.`, evidence: e };
}
