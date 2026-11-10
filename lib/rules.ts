import type { Score } from "./scoring.js";
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
  scores?: Record<string, Score>;
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
  rejectedOrder?: "BUY" | "SELL";
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
    return "blocked" in t ? t.blocked : !(Number.isFinite(t.priceAud) && t.priceAud > 0) ? `${s}: invalid trade price.` : null;
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

  if (input.forceBuyHalt || equity() <= BUY_HALT_EQUITY)
    notes.push(input.forceBuyHalt ? 'BUYS HALTED: persistent risk halt or incomplete fresh portfolio valuation.' : `BUYS HALTED: equity A$${equity().toFixed(2)} is at or below A$2500.00.`);

  // 1) Trim positions above the 20% limit back to the 14% target (sells are allowed even when buys are halted).
  for (const s of input.symbols) {
    const e = equity();
    const average = sharesOf(s) > 0 ? (cost[s] ?? 0) / sharesOf(s) : 0;
    const score = input.scores?.[s];
    const stop = sharesOf(s) > 0 && Number.isFinite(average) && average > 0 && priceOf(s)! <= average * .92;
    const exit = stop || (sharesOf(s) > 0 && score?.complete && (score.total! <= 35 ||
      (average > 0 && priceOf(s)! >= average * 1.15)));
    if (valueOf(s) <= e * MAX_ALLOCATION + 0.005 && !exit) continue;
    const exitReason = exit
      ? stop ? `Risk stop reached: AUD ${priceOf(s)} <= ${round(average * .92, 4)} (-8% from remaining average cost).` : `60/40 exit: ${score!.total! <= 35 ? `score ${score!.total} <=35` : priceOf(s)! >= average * 1.15 ? `profit target reached: AUD ${priceOf(s)} >= ${round(average * 1.15, 4)}` : `stop reached: AUD ${priceOf(s)} <= ${round(average * .92, 4)}`}`
      : `Risk trim: allocation ${(valueOf(s) / e * 100).toFixed(4)}% exceeds 20%; reduce to 14% sizing target.`;
    decisionOf(s).sellConditionReached = true;
    const why = blocked(s);
    if (why) { decisionOf(s).rejectedOrder = "SELL"; decisionOf(s).reason = `${why} Rejected SELL: ${exitReason}`; notes.push(decisionOf(s).reason); continue; }
    const excess = valueOf(s) - e * TARGET_ALLOCATION;
    const qty = exit ? sharesOf(s) : Math.min(sharesOf(s), floorShares(excess / tradePrice(s)));
    if (qty > 0) record(s, "SELL", qty, exitReason);
  }

  // 2) Only qualified 60/40 signals can buy towards the 14% sizing target.
  for (const s of input.symbols) {
    const e = equity();
    if (decisionOf(s).sellConditionReached) continue;
    const score = input.scores?.[s];
    const unavailable = blocked(s);
    if (!score?.complete || score.total! < 70 || score.independent! < 50 || unavailable) {
      decisionOf(s).reason = [unavailable, !score?.complete ? score?.reason ?? "Incomplete: institutional evidence unavailable; no substitute strategy." :
        `60/40 score ${score.total}; BUY requires >=70 and independent >=50.`].filter(Boolean).join(' ');
      if (score?.complete && score.total! >= 70 && score.independent! >= 50 && e * TARGET_ALLOCATION - valueOf(s) >= MIN_TRADE_AUD) decisionOf(s).rejectedOrder = "BUY";
      notes.push(decisionOf(s).reason);
      continue;
    }
    if (input.forceBuyHalt || e <= BUY_HALT_EQUITY) {
      const reason = input.forceBuyHalt ? "BUYS HALTED: persistent risk halt is active." : `BUYS HALTED: equity A$${e.toFixed(2)} is at or below A$${BUY_HALT_EQUITY.toFixed(2)}.`;
      decisionOf(s).rejectedOrder = "BUY";
      if (!notes.includes(reason)) notes.push(reason);
      if (decisionOf(s).decision !== "SELL" && !decisionOf(s).sellConditionReached) decisionOf(s).reason = reason;
      continue;
    }
    const shortfall = e * TARGET_ALLOCATION - valueOf(s);
    if (shortfall < MIN_TRADE_AUD) {
      if (!decisionOf(s).sellConditionReached) decisionOf(s).reason = `Buy shortfall A$${shortfall.toFixed(2)} is below A$${MIN_TRADE_AUD.toFixed(2)} minimum (14% target); no allocation or model exit condition reached.`;
      continue;
    }
    const why = blocked(s);
    if (why) { decisionOf(s).reason = why; notes.push(why); continue; }
    const capRoom = e * MAX_ALLOCATION - valueOf(s);
    const cashRoom = cash - e * MIN_CASH_RESERVE;
    const budget = Math.min(shortfall, capRoom, cashRoom);
    if (budget < MIN_TRADE_AUD) {
      decisionOf(s).rejectedOrder = "BUY";
      decisionOf(s).reason = `${s}: buy blocked by ${cashRoom <= capRoom ? "30% cash reserve" : "20% stock limit"}.`;
      notes.push(decisionOf(s).reason);
      continue;
    }
    // Floor to whole cents below the budget so rounding can never breach the cash reserve or the cap.
    const qty = floorShares((budget - 0.01) / tradePrice(s));
    if (qty <= 0) { decisionOf(s).rejectedOrder = "BUY"; decisionOf(s).reason = "Buy quantity rounds to zero at four decimal places."; }
    if (qty > 0) record(s, "BUY", qty, `60/40 score ${score.total}: buy towards ${TARGET_ALLOCATION * 100}% sizing target`);
  }

  const e = equity();
  return { decisions, orders, notes, cash, equity: e, shares, costBasis: cost, buysHalted: Boolean(input.forceBuyHalt) || e <= BUY_HALT_EQUITY, skipped: false };
}
