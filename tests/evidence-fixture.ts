// Synthetic evidence only for isolated tests; never inserted into deployed databases.
import type { Evidence } from '../lib/scoring.js';
import { scoreEvidence } from '../lib/scoring.js';
export const evidence: Evidence = {
  sourceUrl: 'https://example.org/TEST/filing', publishedAt: '2026-11-01T00:00:00Z',
  capturedAt: '2026-11-01T00:00:00Z', expiresAt: '2027-01-01T00:00:00Z',
  institutional: { investor: 'SYNTHETIC TEST INVESTOR', performanceSourceUrl: 'https://example.org/TEST/performance',
    performancePublishedAt: '2026-11-01T00:00:00Z', years: 5, annualReturn: 12, benchmarkReturn: 8, holdingChangePct: 5 },
  financial: { sourceUrl: 'https://example.org/TEST/financials', publishedAt: '2026-11-01T00:00:00Z',
    revenueGrowthPct: 5, freeCashFlowPositive: true, interestCoverage: 5, return90dPct: 10 },
};
export const testScores = Object.fromEntries(['LMT','RTX','GD','NOC','BAE'].map(s => [s, scoreEvidence(evidence, new Date('2026-11-10'))]));
