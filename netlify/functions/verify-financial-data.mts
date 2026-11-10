import type { Config, Context } from '@netlify/functions';
import { financialChecks, secFinancialPeriods } from '../../lib/financials.js';

// Preview-only, read-only probes. No database, trading cycle, or evidence insertion.
export default async (req: Request, context: Context) => {
  if (context.deploy.context === 'production') return new Response('Not found', { status: 404 });
  const now = new Date();
  const agent = Netlify.env.get('SEC_USER_AGENT');
  const key = Netlify.env.get('TWELVE_DATA_API_KEY');
  const companies = { LMT: '0000936468', RTX: '0000101829', GD: '0000040533', NOC: '0001133421' };
  const financials: Record<string, unknown> = {};
  for (const [symbol, cik] of Object.entries(companies)) {
    const source = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
    try {
      const r = await fetch(source, { headers: agent ? { 'User-Agent': agent } : {}, redirect: 'error', signal: AbortSignal.timeout(5000) });
      if (!r.ok) { financials[symbol] = { source, status: r.status, complete: false }; continue; }
      const facts = await r.json();
      if (Number(facts.cik) !== Number(cik)) throw new Error('Company identity mismatch.');
      const periods = secFinancialPeriods(facts);
      try { financials[symbol] = { source, status: r.status, matchedPeriods: periods.length, complete: true, ...financialChecks(periods, now) }; }
      catch (e) { financials[symbol] = { source, status: r.status, matchedPeriods: periods.length, latestMatchedPeriod: [...periods].sort((a, b) => b.end.localeCompare(a.end))[0]?.end ?? null, complete: false, reason: (e as Error).message }; }
    } catch { financials[symbol] = { source, complete: false, reason: 'SEC request failed or timed out.' }; }
  }
  const managerSource = 'https://data.sec.gov/submissions/CIK0001647251.json';
  let manager: unknown;
  try {
    const r = await fetch(managerSource, { headers: agent ? { 'User-Agent': agent } : {}, signal: AbortSignal.timeout(5000) });
    const data = r.ok ? await r.json() : null;
    const recent = data?.filings?.recent;
    const i = recent?.form?.indexOf('13F-HR') ?? -1;
    manager = { source: managerSource, status: r.status, identityVerified: Number(data?.cik) === 1647251 };
    if (i >= 0) {
      const archive = `https://www.sec.gov/Archives/edgar/data/1647251/${recent.accessionNumber[i].replaceAll('-', '')}/index.json`;
      const a = await fetch(archive, { headers: agent ? { 'User-Agent': agent } : {}, redirect: 'error', signal: AbortSignal.timeout(5000) });
      manager = { ...(manager as object), latestPeriod: recent.reportDate[i], archive, archiveStatus: a.status, qualification: 'Not verified; metadata access does not qualify an investor.' };
    }
  } catch { manager = { source: managerSource, reason: 'SEC discovery failed or timed out.' }; }
  const baeSource = 'https://www.baesystems.com/en/investors/results-and-reports';
  let bae: unknown;
  try {
    const r = await fetch(baeSource, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    bae = { source: baeSource, status: r.status, compatible: false, reason: 'No independently verified inline-XBRL report URLs, publication dates and hashes supplied. Index reachability does not verify financial compatibility.' };
  } catch { bae = { source: baeSource, compatible: false, reason: 'Report index failed, redirected, or timed out; verified inline-XBRL reports remain required.' }; }
  const market: Record<string, unknown> = {};
  // Only assess returned metadata and dates; never return credential-bearing URLs or provider errors.
  for (const symbol of ['LMT', 'RTX', 'GD', 'NOC', 'BAESY']) {
    if (!key) { market[symbol] = { complete: false, reason: 'Provider not configured in preview.' }; continue; }
    const u = new URL('https://api.twelvedata.com/time_series');
    u.search = new URLSearchParams({ symbol, interval: '1day', outputsize: '120', apikey: key }).toString();
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(4000) });
      const data = r.ok ? await r.json() : null;
      const rows = (data?.values ?? []).filter((x: any) => Date.parse(x.datetime) <= +now).sort((a: any, b: any) => b.datetime.localeCompare(a.datetime));
      const latest = rows[0];
      const baseline = rows.find((x: any) => latest && Date.parse(x.datetime) <= Date.parse(latest.datetime) - 90 * 86400000);
      const complete = data?.meta?.symbol === symbol && data?.meta?.currency === 'USD' && latest && baseline &&
        +now - Date.parse(latest.datetime) <= 5 * 86400000 && [latest, baseline].every(x => Number.isFinite(Number(x.close)) && Number(x.close) > 0);
      market[symbol] = { status: r.status, complete: Boolean(complete), latest: latest?.datetime ?? null, baseline: baseline?.datetime ?? null,
        return90dPct: complete ? (Number(latest.close) / Number(baseline.close) - 1) * 100 : null };
    } catch { market[symbol] = { complete: false, reason: 'Market history request failed or timed out.' }; }
  }
  return Response.json({ checkedAt: now.toISOString(), context: context.deploy.context, readOnly: true,
    secContactConfigured: Boolean(agent?.includes('@')), marketConfigured: Boolean(key), financials, manager, bae, market,
    scores: 'Not generated: independently qualified manager performance, consecutive verified security holdings and complete company evidence are required. No evidence was imported.' },
    { headers: { 'cache-control': 'no-store' } });
};
export const config: Config = { path: '/api/verify-financial-data', method: 'GET' };
