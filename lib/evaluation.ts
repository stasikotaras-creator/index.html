import type { PlanInput, PlanResult, StockDecision } from './rules.js';

export type TradingEvaluation = {
  evaluatedAt: string;
  status: 'evaluated' | 'unavailable';
  model: 'equal-weight';
  scoring: { implemented: false; institutionalData: 'unavailable'; message: string };
  stocks: (StockDecision & { shares: number; allocation: number | null; quoteTime: string | null })[];
};

// This describes the actual plan, never a second trading strategy or an inferred historical fill.
export function describeEvaluation(input: PlanInput, plan: PlanResult, now: Date,
  quoteTimes: Record<string, string | null>): TradingEvaluation {
  const equity = input.cash + input.symbols.reduce((sum, s) => sum + (input.shares[s] ?? 0) *
    (input.valuationPrices[s] ?? 0), 0);
  return {
    evaluatedAt: now.toISOString(), status: 'evaluated', model: 'equal-weight',
    scoring: { implemented: false, institutionalData: 'unavailable',
      message: '60/40 investment scoring is not implemented. Institutional data is unavailable; no investment score is calculated. Decisions use equal-weight risk rebalancing only.' },
    stocks: plan.decisions.map(d => ({ ...d, shares: input.shares[d.symbol] ?? 0,
      allocation: plan.skipped || !(equity > 0) ? null : (input.shares[d.symbol] ?? 0) * (input.valuationPrices[d.symbol] ?? 0) / equity,
      quoteTime: quoteTimes[d.symbol] ?? null })),
  };
}
