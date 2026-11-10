// SEC evidence adapter. No inference of manager success from 13F holdings.
import { load } from 'cheerio';
import type { Evidence } from './scoring.js';
export type EdgarInput = {
  currentFilingUrl: string; previousFilingUrl: string;
  currentPublishedAt: string; previousPublishedAt: string;
  currentPeriod: string; previousPeriod: string;
  cusip: string; companyCik: string;
  performance: Evidence['institutional'];
};
export async function collectEdgarEvidence(input: EdgarInput, userAgent: string, now: Date,
  market: { return90dPct: number; sourceUrl: string; publishedAt: string }, fetchImpl: typeof fetch = fetch): Promise<Evidence> {
  if (!userAgent.includes('@')) throw new Error('SEC requires an identifying contact User-Agent.');
  const get = async (source: string) => {
    const u = new URL(source);
    if (u.protocol !== 'https:' || !['www.sec.gov', 'data.sec.gov'].includes(u.hostname) || u.username || u.password)
      throw new Error('Only official SEC HTTPS sources are accepted.');
    const res = await fetchImpl(u, { headers: { 'User-Agent': userAgent, accept: 'application/json, application/xml, text/xml' },
      signal: AbortSignal.timeout(8000), redirect: 'error' });
    if (!res.ok) throw new Error(`SEC HTTP ${res.status}`);
    return res.text();
  };
  for (const date of [input.currentPublishedAt, input.previousPublishedAt, input.currentPeriod, input.previousPeriod, market.publishedAt])
    if (!Number.isFinite(Date.parse(date)) || Date.parse(date) > now.getTime()) throw new Error('Invalid evidence date.');
  const gap = (Date.parse(input.currentPeriod) - Date.parse(input.previousPeriod)) / 86400000;
  if (gap < 80 || gap > 100 || Date.parse(input.previousPublishedAt) >= Date.parse(input.currentPublishedAt) ||
    Date.parse(input.currentPeriod) > Date.parse(input.currentPublishedAt) || Date.parse(input.previousPeriod) > Date.parse(input.previousPublishedAt))
    throw new Error('Holdings periods and publication dates must be consecutive and ordered.');
  // Sequential requests keep well below SEC's 10 requests/second fair-access ceiling.
  const current = await get(input.currentFilingUrl);
  const previous = await get(input.previousFilingUrl);
  const holdings = (xml: string) => {
    const $ = load(xml, { xmlMode: true });
    let count = 0, shares = 0;
    $('*').filter((_, el) => (el as any).name?.split(':').pop() === 'infoTable').each((_, el) => {
      const field = (name: string) => $(el).find('*').filter((_, e) => (e as any).name?.split(':').pop() === name).text().trim();
      if (field('cusip') !== input.cusip || field('putCall')) return;
      if (field('sshPrnamtType') !== 'SH') throw new Error('Non-share holding cannot be compared.');
      const n = Number(field('sshPrnamt'));
      if (!Number.isFinite(n) || n < 0) throw new Error('Invalid holding quantity.');
      count++; shares += n;
    });
    if (!count) throw new Error('CUSIP missing; absence is not treated as a verified liquidation.');
    return shares;
  };
  const a = holdings(current), b = holdings(previous);
  if (!(b > 0)) throw new Error('No positive prior holding for percentage comparison.');
  if (!/^\d{1,10}$/.test(input.companyCik)) throw new Error('Invalid company CIK.');
  const factsUrl = `https://data.sec.gov/api/xbrl/companyfacts/CIK${input.companyCik.padStart(10, '0')}.json`;
  const facts = JSON.parse(await get(factsUrl));
  if (Number(facts.cik) !== Number(input.companyCik)) throw new Error('Company identity mismatch.');
  const gaap = facts.facts?.['us-gaap'];
  type Fact = { start: string; end: string; filed: string; val: number; accn: string; form: string };
  const annual = (tags: string[]): Fact[] => {
    for (const tag of tags) {
      const rows = (gaap?.[tag]?.units?.USD ?? []).filter((r: Fact) =>
        ['10-K', '10-K/A'].includes(r.form) && Number.isFinite(r.val) && Date.parse(r.filed) <= now.getTime() &&
        (Date.parse(r.end) - Date.parse(r.start)) / 86400000 >= 350 &&
        (Date.parse(r.end) - Date.parse(r.start)) / 86400000 <= 380);
      if (rows.length) return rows.sort((a: Fact, b: Fact) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed));
    }
    throw new Error('Required comparable US GAAP annual facts unavailable.');
  };
  const revenues = annual(['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet']);
  const r = revenues[0], prior = revenues.find(x => x.end < r.start);
  if (!prior || !(prior.val > 0)) throw new Error('Comparable prior annual revenue missing.');
  const same = (tags: string[]) => {
    const row = annual(tags).find(x => x.start === r.start && x.end === r.end && x.accn === r.accn);
    if (!row) throw new Error('Financial facts do not share reporting period and accession.');
    return row.val;
  };
  const interest = same(['InterestExpenseNonOperating', 'InterestExpense']);
  if (!(interest > 0)) throw new Error('Positive disclosed interest expense required.');
  const cash = same(['NetCashProvidedByUsedInOperatingActivities']);
  const capex = same(['PaymentsToAcquirePropertyPlantAndEquipment']);
  const operating = same(['OperatingIncomeLoss']);
  if (now.getTime() - Date.parse(r.filed) > 120 * 86400000) throw new Error('Financial filing exceeds 120-day policy; purchase remains blocked.');
  return {
    sourceUrl: input.currentFilingUrl, publishedAt: input.currentPublishedAt, capturedAt: now.toISOString(),
    expiresAt: new Date(Math.min(now.getTime() + 86400000, Date.parse(r.filed) + 120 * 86400000)).toISOString(),
    institutional: { ...input.performance, holdingChangePct: (a - b) / b * 100 },
    financial: { sourceUrl: factsUrl, publishedAt: r.filed, revenueGrowthPct: (r.val / prior.val - 1) * 100,
      freeCashFlowPositive: cash - capex > 0, interestCoverage: operating / interest, return90dPct: market.return90dPct },
    provenance: { input, financialAccession: r.accn, financialPeriod: r.end, market },
  };
}
