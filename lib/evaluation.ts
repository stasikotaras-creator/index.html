import type { PlanInput, PlanResult, StockDecision } from './rules.js';

export type TradingEvaluation = {
  evaluatedAt: string;
  status: 'evaluated' | 'unavailable';
  model: 'documented-60-40-v1';
  scoring: { implemented: boolean; institutionalData: 'complete' | 'incomplete'; message: string };
  stocks: (StockDecision & { shares: number; allocation: number | null; quoteTime: string | null; score: import("./scoring.js").Score | null; profitTargetAud: number | null; stopLossAud: number | null; exitConditions: string; nextTradeConditions: string })[];
};

// This describes the actual plan, never a second trading strategy or an inferred historical fill.
export function describeEvaluation(input: PlanInput, plan: PlanResult, now: Date,
  quoteTimes: Record<string, string | null>): TradingEvaluation {
  const equity = input.cash + input.symbols.reduce((sum, s) => sum + (input.shares[s] ?? 0) *
    (input.valuationPrices[s] ?? 0), 0);
  return {
    evaluatedAt: now.toISOString(), status: 'evaluated', model: 'documented-60-40-v1',
    scoring: { implemented: true, institutionalData: input.symbols.every(s => input.scores?.[s]?.complete) ? 'complete' : 'incomplete',
      message: '60% documented successful-investor behaviour + 40% independent analysis. Incomplete evidence blocks strategy orders. Allocation trims are explicit risk controls.' },
    stocks: plan.decisions.map(d => ({ ...d, shares: input.shares[d.symbol] ?? 0,
      allocation: plan.skipped || !(equity > 0) ? null : (input.shares[d.symbol] ?? 0) * (input.valuationPrices[d.symbol] ?? 0) / equity,
      score: input.scores?.[d.symbol] ?? null,
      profitTargetAud: (input.shares[d.symbol] ?? 0) > 0 ? (input.costBasis?.[d.symbol] ?? 0) / input.shares[d.symbol] * 1.15 : null,
      stopLossAud: (input.shares[d.symbol] ?? 0) > 0 ? (input.costBasis?.[d.symbol] ?? 0) / input.shares[d.symbol] * .92 : null,
      exitConditions: 'With complete evidence: score <=35, +15% profit or -8% loss from remaining average cost. Risk trim above 20% allocation applies independently. Fresh open-market quote required.',
      nextTradeConditions: 'BUY: complete score >=70, independent >=50; fresh unused quote, open market, fresh FX and held valuations; equity > A$2,500; no risk halt; >=A$25 room toward 14% sizing, <=20% stock and >=30% cash. No same-cycle sell and buy.',
      quoteTime: quoteTimes[d.symbol] ?? null })),
  };
}
