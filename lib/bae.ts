// BAE reports in GBP under IFRS. Financial ratios need no ADR or FX conversion;
// price momentum must use BAESY, the same security as the trading engine.
import { load } from 'cheerio';
import { financialChecks, type FinancialPeriod } from './financials.js';
// GLEIF: BAE SYSTEMS PLC, registered as 01470151 (GB).
export const BAE_LEI = '8SVCSVKSGDWMW2QHOH83';
export type BaeReport = { url: string; publishedAt: string; sha256?: string };
export async function collectBaeFinancials(reports: BaeReport[], now: Date, fetchImpl: typeof fetch = fetch) {
  const periods: FinancialPeriod[] = [];
  for (const report of reports) {
    const url = new URL(report.url);
    if (url.protocol !== 'https:' || !['www.baesystems.com','baesystems.com'].includes(url.hostname) || url.username || url.password)
      throw new Error('Official BAE HTTPS report required.');
    if (!Number.isFinite(Date.parse(report.publishedAt)) || Date.parse(report.publishedAt) > +now) throw new Error('Invalid BAE publication date.');
    const response = await fetchImpl(url, { redirect:'error', signal:AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`BAE report HTTP ${response.status}`);
    const body = await response.text();
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update(body).digest('hex');
    if (!report.sha256 || hash !== report.sha256) throw new Error('BAE source must match the independently verified report hash.');
    const $ = load(body, { xmlMode: true });
    const local = (name: string) => $('*').filter((_,el) => (el as any).name?.split(':').pop()?.toLowerCase() === name.toLowerCase());
    const tags = { revenue:'Revenue', operating:'ProfitLossFromOperatingActivities', interest:'InterestExpense',
      cash:'CashFlowsFromUsedInOperatingActivities', capex:'PurchaseOfPropertyPlantAndEquipment' };
    const contexts = local('context');
    contexts.each((_,el) => {
      const context = $(el), id = context.attr('id');
      if (context.find('*').toArray().some(e => ['explicitMember','typedMember'].includes((e as any).name?.split(':').pop()))) return;
      const text = (tag: string) => context.find('*').filter((_,e) => (e as any).name?.split(':').pop() === tag).text().trim();
      const entity = text('identifier');
      if (!['BAE SYSTEMS PLC','BAE Systems plc','01470151',BAE_LEI].includes(entity)) return;
      const p: any = { start:text('startDate'), end:text('endDate'), filed:report.publishedAt, accession:report.url+'#sha256='+hash };
      for (const [key,tag] of Object.entries(tags)) {
        const facts = local('nonFraction').filter((_,e) => $(e).attr('contextRef') === id && $(e).attr('name') === 'ifrs-full:'+tag);
        const values: number[] = [];
        facts.each((_,e) => {
          const f = $(e), unit = local('unit').filter((_,u) => $(u).attr('id') === f.attr('unitRef')).text().trim();
          if (unit !== 'iso4217:GBP' || f.attr('nil') === 'true') return;
          const raw = f.text().trim();
          // Only explicit, supported numeric formatting is accepted.
          if (!/^-?[\d,]+(?:\.\d+)?$/.test(raw)) return;
          const value = Number(raw.replaceAll(',','')) * 10 ** Number(f.attr('scale') ?? 0) * (f.attr('sign') === '-' ? -1 : 1);
          if (Number.isFinite(value)) values.push(value);
        });
        if (!values.length || values.some(v => v !== values[0])) return;
        p[key] = values[0];
      }
      periods.push(p);
    });
  }
  const checks = financialChecks(periods, now, 2);
  return { ...checks, sourceUrl:reports.find(r => r.publishedAt === checks.publishedAt)?.url ?? reports[0]?.url, reportSources: reports };
}

// UK reporting adapter: BAE's official annual report is filed in ESEF/UKSEF inline XBRL (UK-adopted IFRS)
// with the FCA National Storage Mechanism. XBRL International's filings index publishes the same
// issuer-filed package as validated xBRL-JSON. Interim (half-year) results are not tagged, so only
// annual periods are machine-verifiable; the existing 120-day freshness policy is applied unchanged.
export const ESEF_INDEX = 'https://filings.xbrl.org';
const BAE_CONCEPTS: Record<keyof Omit<FinancialPeriod,'start'|'end'|'filed'|'accession'|'concepts'>, { concept: string; label: string }> = {
  revenue: { concept: 'ifrs-full:Revenue', label: 'Revenue' },
  operating: { concept: 'ifrs-full:ProfitLossFromOperatingActivities', label: 'Operating profit' },
  // BAE does not tag a standalone IFRS InterestExpense total; FinanceCosts (which includes interest on
  // loans and leases) is the conservative, larger denominator for interest coverage.
  interest: { concept: 'ifrs-full:FinanceCosts', label: 'Finance costs (conservative interest proxy)' },
  cash: { concept: 'ifrs-full:CashFlowsFromUsedInOperatingActivities', label: 'Cash flows from operating activities' },
  // Issuer extension anchored to IFRS purchases of PP&E (includes investment property).
  capex: { concept: 'baesystemsplc:PurchaseOfPropertyPlantAndEquipmentAndInvestmentPropertyClassifiedAsInvestingActivities', label: 'Purchase of PP&E and investment property' },
};
export type EsefFiling = { periodEnd: string; dateAdded: string; jsonUrl: string; reportUrl: string; errors: number };
export async function listBaeEsefFilings(fetchImpl: typeof fetch = fetch): Promise<EsefFiling[]> {
  const r = await fetchImpl(`${ESEF_INDEX}/api/entities/${BAE_LEI}/filings`, { redirect: 'error', signal: AbortSignal.timeout(8000), headers: { accept: 'application/vnd.api+json, application/json' } });
  if (!r.ok) throw new Error(`ESEF index HTTP ${r.status}`);
  const j = await r.json();
  return (j.data ?? []).map((d: any) => d.attributes).filter((a: any) => a.country === 'GB' && typeof a.json_url === 'string')
    .map((a: any) => ({ periodEnd: a.period_end, dateAdded: String(a.date_added).slice(0, 10), jsonUrl: ESEF_INDEX + a.json_url,
      reportUrl: ESEF_INDEX + a.report_url, errors: Number(a.error_count ?? 0) }))
    .sort((a: EsefFiling, b: EsefFiling) => b.periodEnd.localeCompare(a.periodEnd));
}
export function esefPeriods(report: any, filing: EsefFiling, hash: string): FinancialPeriod[] {
  if (report?.documentInfo?.documentType !== 'https://xbrl.org/2021/xbrl-json') throw new Error('Not an xBRL-JSON report.');
  if (!String(report.documentInfo?.namespaces?.['ifrs-full'] ?? '').startsWith('https://xbrl.ifrs.org/taxonomy/')) throw new Error('IFRS taxonomy not declared.');
  const byPeriod = new Map<string, any>();
  for (const f of Object.values<any>(report.facts ?? {})) {
    const d = f.dimensions ?? {};
    const key = (Object.entries(BAE_CONCEPTS).find(([, c]) => c.concept === d.concept) ?? [])[0];
    if (!key) continue;
    // Unsegmented, consolidated GBP facts for the verified LEI only.
    if (Object.keys(d).some(k => !['concept', 'entity', 'period', 'unit', 'language'].includes(k))) continue;
    if (d.entity !== `scheme:${BAE_LEI}` || d.unit !== 'iso4217:GBP' || !/^[^/]+\/[^/]+$/.test(d.period ?? '')) continue;
    const [s, e] = d.period.split('/');
    const start = s.slice(0, 10), end = new Date(Date.parse(e.slice(0, 10)) - 86400000).toISOString().slice(0, 10);
    const value = Number(f.value);
    if (!Number.isFinite(value)) continue;
    const row = byPeriod.get(start + end) ?? { start, end, filed: filing.dateAdded, accession: `${filing.reportUrl}#sha256=${hash}`, concepts: {} };
    if (key in row && row[key] !== value) row.conflict = true;
    row[key] = value; row.concepts[key] = BAE_CONCEPTS[key as keyof typeof BAE_CONCEPTS].label;
    byPeriod.set(start + end, row);
  }
  return [...byPeriod.values()].filter(r => !r.conflict && Object.keys(BAE_CONCEPTS).every(k => Number.isFinite(r[k])));
}
export async function collectBaeEsefFinancials(now: Date, fetchImpl: typeof fetch = fetch) {
  const filings = (await listBaeEsefFilings(fetchImpl)).filter(f => f.errors === 0 && Date.parse(f.dateAdded) <= +now);
  const latest = filings[0];
  if (!latest) throw new Error('No validated BAE ESEF filing available.');
  const r = await fetchImpl(latest.jsonUrl, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`ESEF report HTTP ${r.status}`);
  const body = await r.text();
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256').update(body).digest('hex');
  const periods = esefPeriods(JSON.parse(body), latest, hash);
  const base = { source: latest.reportUrl, periodEnd: latest.periodEnd, indexedAt: latest.dateAdded, sha256: hash,
    periods: periods.map(p => ({ start: p.start, end: p.end, revenue: p.revenue, operating: p.operating, interest: p.interest, cash: p.cash, capex: p.capex })) };
  // Half-yearly TTM is attempted first; BAE interims are untagged, so this falls back to annual.
  try { return { ...base, complete: true as const, checks: financialChecks(periods, now, 2), reason: null }; }
  catch (e) { return { ...base, complete: false as const, checks: null, reason: (e as Error).message }; }
}
