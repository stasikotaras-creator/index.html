// BAE reports in GBP under IFRS. Financial ratios need no ADR or FX conversion;
// price momentum must use BAESY, the same security as the trading engine.
import { load } from 'cheerio';
import { financialChecks, type FinancialPeriod } from './financials.js';
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
      if (!['BAE SYSTEMS PLC','BAE Systems plc','01470151','BAESYSTEMS','549300J7ZQK2K7WSQ747'].includes(entity)) return;
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
