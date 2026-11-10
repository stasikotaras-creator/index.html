// Derive discrete fiscal quarters from cumulative SEC facts; never mix accessions within a period.
export type FinancialPeriod = { start: string; end: string; filed: string; accession: string;
  revenue: number; operating: number; interest: number; cash: number; capex: number };
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
    basis, period: current.end, accessions };
}
export function secFinancialPeriods(facts: any): FinancialPeriod[] {
  const gaap = facts.facts?.['us-gaap'];
  const tags = { revenue: ['RevenueFromContractWithCustomerExcludingAssessedTax','Revenues','SalesRevenueNet'],
    operating: ['OperatingIncomeLoss'], interest: ['InterestExpenseNonOperating','InterestExpense'],
    cash: ['NetCashProvidedByUsedInOperatingActivities'], capex: ['PaymentsToAcquirePropertyPlantAndEquipment'] };
  const rows = (key: keyof typeof tags): any[] => tags[key].flatMap(tag => gaap?.[tag]?.units?.USD ?? [])
    .filter(r => ['10-K','10-Q'].includes(r.form));
  return rows('revenue').flatMap(r => {
    const p: any = { start:r.start, end:r.end, filed:r.filed, accession:r.accn, revenue:r.val };
    for (const key of ['operating','interest','cash','capex'] as const) {
      const matches = rows(key).filter(x => x.start === r.start && x.end === r.end && x.accn === r.accn && x.filed === r.filed);
      if (!matches.length || matches.some(x => x.val !== matches[0].val)) return [];
      p[key] = matches[0].val;
    }
    return [p];
  });
}
