// Derive discrete fiscal quarters from cumulative SEC facts; never mix accessions within a period.
export type FinancialPeriod = { start: string; end: string; filed: string; accession: string;
  revenue: number; operating: number; interest: number; cash: number; capex: number; concepts?: Record<string, string> };
const day = 86400000;
const metrics = ['revenue', 'operating', 'interest', 'cash', 'capex'] as const;
export function financialChecks(periods: FinancialPeriod[], now: Date, frequency: 2 | 4 = 4) {
  const valid = periods.filter(p => [p.start, p.end, p.filed].every(d => Number.isFinite(Date.parse(d)) && Date.parse(d) <= +now)
    && p.start < p.end && p.end <= p.filed && p.accession && metrics.every(k => Number.isFinite(p[k])));
  const latest = [...valid].sort((a,b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed));
  const unique = latest.filter((p,i) => latest.findIndex(q => q.start === p.start && q.end === p.end) === i);
  const quarters: FinancialPeriod[] = [];
  for (const p of unique) {
    const days = (Date.parse(p.end) - Date.parse(p.start)) / day;
    if (days >= (frequency === 4 ? 70 : 160) && days <= (frequency === 4 ? 105 : 200)) quarters.push(p);
    else {
      const previous = unique.find(q => q.start === p.start && (Date.parse(p.end) - Date.parse(q.end)) / day >= (frequency === 4 ? 70 : 160)
        && (Date.parse(p.end) - Date.parse(q.end)) / day <= (frequency === 4 ? 105 : 200));
      if (previous) quarters.push({ ...p, accession: p.accession + ',' + previous.accession, start: new Date(Date.parse(previous.end) + day).toISOString().slice(0,10),
        ...Object.fromEntries(metrics.map(k => [k, p[k] - previous[k]])) });
    }
  }
  quarters.sort((a,b) => b.end.localeCompare(a.end));
  const q = quarters.filter((p,i) => quarters.findIndex(x => x.end === p.end) === i).slice(0, frequency * 2);
  const contiguous = q.length === frequency * 2 && q.every((p,i) => !i || Date.parse(q[i-1].start) - Date.parse(p.end) === day);
  let current: FinancialPeriod, priorRevenue: number, basis: string, accessions: string[];
  if (contiguous) {
    const sum = (rows: FinancialPeriod[], key: typeof metrics[number]) => rows.reduce((n,p) => n + p[key], 0);
    current = { ...q[0], start: q[frequency - 1].start, ...Object.fromEntries(metrics.map(k => [k, sum(q.slice(0,frequency), k)])) };
    priorRevenue = sum(q.slice(frequency), 'revenue'); basis = frequency === 4 ? 'TTM (eight consecutive fiscal quarters)' : 'TTM (four consecutive fiscal half-years)'; accessions = q.map(p => p.accession);
  } else {
    const annual = unique.filter(p => { const d = (Date.parse(p.end)-Date.parse(p.start))/day; return d >= 350 && d <= 380; });
    current = annual[0];
    const prior = current && annual.find(p => Date.parse(current.start) - Date.parse(p.end) === day);
    if (!current || !prior || (q[0] && q[0].end > current.end)) throw new Error('Comparable consecutive quarterly/TTM financial data unavailable.');
    priorRevenue = prior.revenue; basis = 'annual'; accessions = [current.accession, prior.accession];
  }
  if (+now - Date.parse(current.filed) > 120 * day || +now - Date.parse(current.end) > 150 * day)
    throw new Error('Financial filing or reporting period is stale.');
  if (!(priorRevenue > 0) || !(current.interest > 0) || current.capex < 0) throw new Error('Comparable revenue, positive interest and nonnegative capex required.');
  return { publishedAt: current.filed, revenueGrowthPct: (current.revenue/priorRevenue-1)*100,
    freeCashFlowPositive: current.cash-current.capex > 0, interestCoverage: current.operating/current.interest,
    basis, period: current.end, accessions, concepts: current.concepts };
}
// Issuer-specific US GAAP mappings verified against each issuer's current 10-Q/10-K companyfacts.
// Each metric lists alternatives in priority order; an alternative is a sum of signed facts that must all
// be present for the exact same period and accession. Net interest is only accepted where the issuer's
// income statement presents interest on a net basis, and only when it is a net expense.
type Component = { tag: string; sign?: 1 | -1 };
type Alternative = { label: string; parts: Component[] };
export type IssuerProfile = { [K in typeof metrics[number]]: Alternative[] };
const alt = (label: string, ...parts: (string | Component)[]): Alternative =>
  ({ label, parts: parts.map(p => typeof p === 'string' ? { tag: p } : p) });
export const GENERIC_PROFILE: IssuerProfile = {
  revenue: [alt('Revenue from contracts', 'RevenueFromContractWithCustomerExcludingAssessedTax'), alt('Revenues', 'Revenues'), alt('Sales revenue net', 'SalesRevenueNet')],
  operating: [alt('Operating income', 'OperatingIncomeLoss')],
  interest: [alt('Interest expense (nonoperating)', 'InterestExpenseNonoperating'), alt('Interest expense', 'InterestExpense'), alt('Interest and debt expense', 'InterestAndDebtExpense')],
  cash: [alt('Operating cash flow', 'NetCashProvidedByUsedInOperatingActivities')],
  capex: [alt('Purchases of PP&E', 'PaymentsToAcquirePropertyPlantAndEquipment')],
};
export const ISSUER_PROFILES: Record<string, IssuerProfile> = {
  // LMT: interest tag is "Nonoperating" (lower-case o); capital expenditures use PaymentsToAcquireProductiveAssets.
  '936468': { ...GENERIC_PROFILE, revenue: [alt('Revenues', 'Revenues')],
    interest: [alt('Interest expense (nonoperating)', 'InterestExpenseNonoperating')],
    capex: [alt('Capital expenditures', 'PaymentsToAcquireProductiveAssets'), ...GENERIC_PROFILE.capex] },
  // RTX: income statement presents "Interest expense, net" only.
  '101829': { ...GENERIC_PROFILE, interest: [alt('Net interest expense (issuer-presented, nonoperating)', { tag: 'InterestIncomeExpenseNonoperatingNet', sign: -1 })] },
  // GD: income statement presents "Interest, net"; with discontinued operations, interim 10-Qs report
  // continuing and discontinued operating cash separately, so total operating cash is their sum.
  '40533': { ...GENERIC_PROFILE, revenue: [alt('Revenue from contracts', 'RevenueFromContractWithCustomerExcludingAssessedTax')],
    interest: [alt('Net interest expense (issuer-presented)', { tag: 'InterestIncomeExpenseNet', sign: -1 })],
    cash: [alt('Operating cash flow', 'NetCashProvidedByUsedInOperatingActivities'),
      alt('Operating cash flow (continuing + discontinued)', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations', 'CashProvidedByUsedInOperatingActivitiesDiscontinuedOperations')] },
  // NOC: gross interest is disclosed as InterestAndDebtExpense.
  '1133421': { ...GENERIC_PROFILE, revenue: [alt('Revenues', 'Revenues')], interest: [alt('Interest and debt expense', 'InterestAndDebtExpense')] },
};
export function secFinancialPeriods(facts: any, profile: IssuerProfile = ISSUER_PROFILES[String(Number(facts?.cik))] ?? GENERIC_PROFILE): FinancialPeriod[] {
  const gaap = facts.facts?.['us-gaap'];
  const rows = (tag: string): any[] => (gaap?.[tag]?.units?.USD ?? []).filter((r: any) => ['10-K','10-Q'].includes(r.form) && r.start);
  // Resolve one metric for an exact (start, end, accession) using the first fully present alternative.
  const resolve = (key: typeof metrics[number], r: any): { value: number; label: string } | null | 'conflict' => {
    for (const a of profile[key]) {
      let total = 0, ok = true;
      for (const c of a.parts) {
        const m = rows(c.tag).filter(x => x.start === r.start && x.end === r.end && x.accn === r.accn && x.filed === r.filed);
        if (!m.length) { ok = false; break; }
        if (m.some(x => x.val !== m[0].val)) return 'conflict';
        total += (c.sign ?? 1) * m[0].val;
      }
      if (ok) return { value: total, label: a.label };
    }
    return null;
  };
  const anchors = profile.revenue.flatMap(a => rows(a.parts[0].tag));
  const seen = new Set<string>();
  return anchors.flatMap(r => {
    const id = `${r.start}|${r.end}|${r.accn}`;
    if (seen.has(id)) return [];
    seen.add(id);
    const p: any = { start:r.start, end:r.end, filed:r.filed, accession:r.accn, concepts: {} };
    for (const key of metrics) {
      const v = resolve(key, r);
      if (!v || v === 'conflict') return [];
      p[key] = v.value; p.concepts[key] = v.label;
    }
    return [p];
  });
}
