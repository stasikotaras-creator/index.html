// SEC evidence adapter. No inference of manager success from 13F holdings.
import { load } from 'cheerio';
import { financialChecks, secFinancialPeriods } from './financials.js';
import type { Evidence } from './scoring.js';
export type EdgarInput = {
  currentFilingUrl: string; previousFilingUrl: string;
  currentPublishedAt: string; previousPublishedAt: string;
  currentPeriod: string; previousPeriod: string;
  cusip: string; companyCik: string;
  performance: Evidence['institutional'];
};
export async function collectEdgarEvidence(input: EdgarInput, userAgent: string, now: Date,
  market: { return90dPct: number; sourceUrl: string; publishedAt: string }, fetchImpl: typeof fetch = fetch, financialOverride?: Evidence['financial']): Promise<Evidence> {
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
  const facts = financialOverride ? null : JSON.parse(await get(factsUrl));
  if (!financialOverride && Number(facts.cik) !== Number(input.companyCik)) throw new Error('Company identity mismatch.');
  const financial = financialOverride ?? { ...financialChecks(secFinancialPeriods(facts), now), sourceUrl: factsUrl, return90dPct: market.return90dPct };
  return {
    sourceUrl: input.currentFilingUrl, publishedAt: input.currentPublishedAt, capturedAt: now.toISOString(),
    expiresAt: new Date(Math.min(now.getTime() + 86400000, Date.parse(financial.publishedAt) + 120 * 86400000)).toISOString(),
    institutional: { ...input.performance, holdingChangePct: (a - b) / b * 100 },
    financial: { ...financial, return90dPct: market.return90dPct },
    provenance: { input, financialAccession: financial.accessions?.join(',') ?? financial.sourceUrl, financialPeriod: financial.period ?? financial.publishedAt, market },
  };
}

// Resolve original consecutive 13F filings for a previously verified manager.
export async function refreshEdgarInput(input: EdgarInput, managerCik: string, userAgent: string,
  fetchImpl: typeof fetch = fetch): Promise<EdgarInput> {
  if (!/^\d{1,10}$/.test(managerCik) || !userAgent.includes('@')) throw new Error('Verified manager CIK and SEC contact required.');
  const get = async (url: string) => {
    const r = await fetchImpl(url, { headers: { 'User-Agent': userAgent }, redirect:'error', signal:AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`SEC discovery HTTP ${r.status}`);
    return r.json();
  };
  const data = await get(`https://data.sec.gov/submissions/CIK${managerCik.padStart(10,'0')}.json`);
  if (Number(data.cik) !== Number(managerCik)) throw new Error('Manager identity mismatch.');
  const recent = data.filings?.recent;
  const rows = (recent?.form ?? []).flatMap((form: string,i: number) => form === '13F-HR' ? [{
    accession:recent.accessionNumber[i], period:recent.reportDate[i], published:recent.filingDate[i] }] : [])
    .sort((a: any,b: any) => b.period.localeCompare(a.period) || b.published.localeCompare(a.published));
  const filings = rows.filter((r: any,i: number) => rows.findIndex((x: any) => x.period === r.period) === i).slice(0,2);
  if (filings.length !== 2) throw new Error('Two original 13F filings unavailable.');
  if ((recent.form as string[]).some((form,i) => form === '13F-HR/A' && filings.some((f: any) => f.period === recent.reportDate[i])))
    throw new Error('Amended 13F period requires source review before refresh.');
  const urls: string[] = [];
  for (const filing of filings) {
    if (!/^\d{10}-\d{2}-\d{6}$/.test(filing.accession)) throw new Error('Invalid SEC accession.');
    const base = `https://www.sec.gov/Archives/edgar/data/${Number(managerCik)}/${filing.accession.replaceAll('-','')}/`;
    const index = await get(base+'index.json');
    const files = (index.directory?.item ?? []).filter((x: any) => /\.xml$/i.test(x.name) && !x.name.includes('/') && !x.name.includes('..'));
    let table: string | undefined;
    for (const file of files) {
      const r = await fetchImpl(base+file.name, { headers:{'User-Agent':userAgent}, redirect:'error', signal:AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`SEC discovery HTTP ${r.status}`);
      const body = await r.text();
      if (/<(?:\w+:)?informationTable[\s>]/.test(body)) {
        if (table) throw new Error('Multiple information tables require review.');
        table = base+file.name;
      }
    }
    if (!table) throw new Error('13F information table unavailable.');
    urls.push(table);
  }
  return { ...input, currentFilingUrl:urls[0], previousFilingUrl:urls[1], currentPeriod:filings[0].period,
    previousPeriod:filings[1].period, currentPublishedAt:filings[0].published, previousPublishedAt:filings[1].published };
}
