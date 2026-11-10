// REVEL TradeGuard risk rules and order planning.
// Pure functions only: no database, no network. The live engine (lib/simulation.ts) and the
// isolated test suite (tests/) both call planOrders, so the tests check the exact production rules.

export const START_CAPITAL = 5000;
export const MAX_ALLOCATION = 0.2; // max 20% of equity per stock
export const TARGET_ALLOCATION = 0.14; // equal weight: 5 x 14% = 70% invested
export const MIN_CASH_RESERVE = 0.3; // keep at least 30% of equity in cash
export const BUY_HALT_EQUITY = 2500; // no new buys at or below A$2,500
export const MIN_TRADE_AUD = 25; // ignore rebalancing differences smaller than this

export const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
const floorShares = (n: number) => Math.floor(n * 10000) / 10000;

export type PlanInput = {
  forceBuyHalt?: boolean;
  symbols: readonly string[];
  cash: number;
  shares: Record<string, number>;
  costBasis?: Record<string, number>;
  // Latest recorded AUD price per symbol, used for valuation.
  valuationPrices: Record<string, number | undefined>;
  // Fresh AUD trade price for symbols that may trade this cycle, or the reason they may not.
  tradeable: Record<string, { priceAud: number } | { blocked: string }>;
};

export type PlannedOrder = {
  symbol: string; side: "BUY" | "SELL"; shares: number; priceAud: number; valueAud: number;
  rule: string; cashAfter: number; equityBefore: number; sharesAfter: number; costBasisAfter: number;
};

export type StockDecision = {
  symbol: string; decision: "BUY" | "SELL" | "HOLD"; reason: string;
  buyEligible: boolean; sellConditionReached: boolean;
};

export type PlanResult = {
  decisions: StockDecision[];
  orders: PlannedOrder[]; notes: string[]; cash: number; equity: number | null;
  shares: Record<string, number>; costBasis: Record<string, number>; buysHalted: boolean; skipped: boolean;
};

export function planOrders(input: PlanInput): PlanResult {
  const shares: Record<string, number> = { ...input.shares };
  const cost: Record<string, number> = { ...(input.costBasis ?? {}) };
  let cash = input.cash;
  const notes: string[] = [];
  const orders: PlannedOrder[] = [];
  const decisions: StockDecision[] = input.symbols.map(symbol => ({ symbol, decision: "HOLD",
    reason: "No order required.", buyEligible: false, sellConditionReached: false }));
  const decisionOf = (s: string) => decisions.find(d => d.symbol === s)!;

  const sharesOf = (s: string) => shares[s] ?? 0;
  const priceOf = (s: string) => {
    const t = input.tradeable[s];
    return t && "priceAud" in t ? t.priceAud : input.valuationPrices[s];
  };
  const valueOf = (s: string) => sharesOf(s) * (priceOf(s) ?? 0);
  const equity = () => cash + input.symbols.reduce((sum, s) => sum + valueOf(s), 0);
  const blocked = (s: string) => {
    const t = input.tradeable[s];
    if (!t) return `${s}: no fresh verified price this run.`;
    return "blocked" in t ? t.blocked : null;
  };
  const tradePrice = (s: string) => (input.tradeable[s] as { priceAud: number }).priceAud;

  const unpriced = input.symbols.filter((s) => sharesOf(s) > 0 && !(priceOf(s)! > 0));
  if (unpriced.length) {
    for (const d of decisions) d.reason = `Equity cannot be valued (no price for ${unpriced.join(", ")}); simulated trading skipped.`;
    notes.push(`Equity cannot be valued (no price for ${unpriced.join(", ")}); simulated trading skipped.`);
    return { decisions, orders, notes, cash, equity: null, shares, costBasis: cost, buysHalted: false, skipped: true };
  }

  const record = (s: string, side: "BUY" | "SELL", qty: number, rule: string) => {
    const price = tradePrice(s);
    const eqBefore = equity();
    const value = round(qty * price, 2);
    if (side === "BUY") {
      cash = round(cash - value, 2);
      cost[s] = (cost[s] ?? 0) + value;
      shares[s] = round(sharesOf(s) + qty, 6);
    } else {
      const frac = sharesOf(s) > 0 ? qty / sharesOf(s) : 0;
      cost[s] = Math.max(0, (cost[s] ?? 0) * (1 - frac));
      cash = round(cash + value, 2);
      shares[s] = Math.max(0, round(sharesOf(s) - qty, 6));
    }
    Object.assign(decisionOf(s), { decision: side, reason: rule, buyEligible: side === "BUY" });
    orders.push({ symbol: s, side, shares: qty, priceAud: price, valueAud: value, rule, cashAfter: cash,
      equityBefore: eqBefore, sharesAfter: shares[s], costBasisAfter: cost[s] });
  };

  // 1) Trim positions above the 20% limit back to the 14% target (sells are allowed even when buys are halted).
  for (const s of input.symbols) {
    const e = equity();
    if (valueOf(s) <= e * MAX_ALLOCATION + 0.005) continue;
    decisionOf(s).sellConditionReached = true;
    const why = blocked(s);
    if (why) { decisionOf(s).reason = `${why} (position above 20% limit)`; notes.push(decisionOf(s).reason); continue; }
    const excess = valueOf(s) - e * TARGET_ALLOCATION;
    const qty = Math.min(sharesOf(s), floorShares(excess / tradePrice(s)));
    if (qty > 0) record(s, "SELL", qty, `Trim: position above ${MAX_ALLOCATION * 100}% limit, rebalanced to ${TARGET_ALLOCATION * 100}% target`);
  }

  // 2) Buy towards the equal-weight 14% target within the risk limits.
  for (const s of input.symbols) {
    const e = equity();
    if (input.forceBuyHalt || e <= BUY_HALT_EQUITY) {
      const reason = input.forceBuyHalt ? "BUYS HALTED: persistent risk halt is active." : `BUYS HALTED: equity A$${e.toFixed(2)} is at or below A$${BUY_HALT_EQUITY.toFixed(2)}.`;
      if (!notes.includes(reason)) notes.push(reason);
      if (decisionOf(s).decision !== "SELL" && !decisionOf(s).sellConditionReached) decisionOf(s).reason = reason;
      continue;
    }
    const shortfall = e * TARGET_ALLOCATION - valueOf(s);
    if (shortfall < MIN_TRADE_AUD) {
      if (!decisionOf(s).sellConditionReached) decisionOf(s).reason = `Buy shortfall A$${shortfall.toFixed(2)} is below A$${MIN_TRADE_AUD.toFixed(2)} minimum (14% target); sell requires allocation above 20%.`;
      continue;
    }
    const why = blocked(s);
    if (why) { decisionOf(s).reason = why; notes.push(why); continue; }
    const capRoom = e * MAX_ALLOCATION - valueOf(s);
    const cashRoom = cash - e * MIN_CASH_RESERVE;
    const budget = Math.min(shortfall, capRoom, cashRoom);
    if (budget < MIN_TRADE_AUD) {
      decisionOf(s).reason = `${s}: buy blocked by ${cashRoom <= capRoom ? "30% cash reserve" : "20% stock limit"}.`;
      notes.push(decisionOf(s).reason);
      continue;
    }
    // Floor to whole cents below the budget so rounding can never breach the cash reserve or the cap.
    const qty = floorShares((budget - 0.01) / tradePrice(s));
    if (qty <= 0) decisionOf(s).reason = "Buy quantity rounds to zero at four decimal places.";
    if (qty > 0) record(s, "BUY", qty, `Equal-weight buy towards ${TARGET_ALLOCATION * 100}% target`);
  }

  const e = equity();
  return { decisions, orders, notes, cash, equity: e, shares, costBasis: cost, buysHalted: Boolean(input.forceBuyHalt) || e <= BUY_HALT_EQUITY, skipped: false };
}
