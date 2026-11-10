import type { Config, Context } from '@netlify/functions';
import { load } from 'cheerio';
import { financialChecks, secFinancialPeriods } from '../../lib/financials.js';
import { createSecClient, SecAccessError, validSecUserAgent } from '../../lib/sec.js';
import { collectBaeEsefFinancials } from '../../lib/bae.js';
import { planOrders } from '../../lib/rules.js';
import { scoreEvidence } from '../../lib/scoring.js';

// Preview-only, read-only probes. No database, trading cycle, evidence insertion or secrets in output.
// Each integration is requested separately (?integration=...) so every check fits the function timeout.
type Result = { integration: string; result: 'PASS' | 'FAIL'; detail: string; source?: string; data?: unknown };
const COMPANIES = { LMT: '936468', RTX: '101829', GD: '40533', NOC: '1133421' } as const;
// CUSIPs of the traded securities (BAE trades as the BAESY ADR).
const CUSIPS: Record<string, string> = { LMT: '539830109', RTX: '75513E101', GD: '369550108', NOC: '666807102', BAESY: '05523R107' };
const TCI_CIK = '1647251';
const pass = (integration: string, detail: string, extra: Partial<Result> = {}): Result => ({ integration, result: 'PASS', detail, ...extra });
const fail = (integration: string, detail: string, extra: Partial<Result> = {}): Result => ({ integration, result: 'FAIL', detail, ...extra });
const why = (e: unknown) => e instanceof SecAccessError ? `${e.diagnosis} (HTTP ${e.status})` : (e as Error)?.message ?? 'Unknown error';

async function secFinancials(agent: string | undefined, now: Date): Promise<Result[]> {
  if (!validSecUserAgent(agent)) return Object.keys(COMPANIES).map(s => fail(`SEC financials · ${s}`, 'SEC_USER_AGENT not configured; request not sent.'));
  const sec = createSecClient(agent);
  const out: Result[] = [];
  for (const [symbol, cik] of Object.entries(COMPANIES)) {
    const source = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik.padStart(10, '0')}.json`;
    try {
      const facts = await sec.json(source);
      if (Number(facts.cik) !== Number(cik)) throw new Error('Company identity mismatch.');
      const periods = secFinancialPeriods(facts);
      try {
        const c = financialChecks(periods, now);
        out.push(pass(`SEC financials · ${symbol}`, `${c.basis} to ${c.period}, filed ${c.publishedAt}.`, { source, data: c }));
      } catch (e) { out.push(fail(`SEC financials · ${symbol}`, why(e), { source, data: { matchedPeriods: periods.length } })); }
    } catch (e) { out.push(fail(`SEC financials · ${symbol}`, why(e), { source })); }
  }
  return out;
}

async function secHoldings(agent: string | undefined): Promise<Result[]> {
  if (!validSecUserAgent(agent)) return [fail('SEC identification', 'SEC_USER_AGENT missing or not in "Name contact@domain" form. SEC returns 403 "Undeclared Automated Tool" without it.')];
  const out: Result[] = [pass('SEC identification', 'Declared User-Agent with contact email is configured; requests limited to ≤5/second with gzip and Retry-After backoff.')];
  const sec = createSecClient(agent);
  const submissions = `https://data.sec.gov/submissions/CIK${TCI_CIK.padStart(10, '0')}.json`;
  try {
    const data = await sec.json(submissions);
    if (Number(data.cik) !== Number(TCI_CIK)) throw new Error('Manager identity mismatch.');
    const recent = data.filings.recent;
    const i = recent.form.indexOf('13F-HR');
    if (i < 0) throw new Error('No original 13F-HR filing found.');
    out.push(pass('SEC submissions · TCI', `Identity verified; latest original 13F-HR period ${recent.reportDate[i]}, filed ${recent.filingDate[i]}.`, { source: submissions }));
    const base = `https://www.sec.gov/Archives/edgar/data/${TCI_CIK}/${recent.accessionNumber[i].replaceAll('-', '')}/`;
    try {
      const index = await sec.json(base + 'index.json');
      const files = (index.directory?.item ?? []).map((x: any) => x.name).filter((n: string) => /\.xml$/i.test(n) && !/primary_doc/i.test(n));
      out.push(pass('SEC holdings archive', `HTTP 200 with declared User-Agent (previously 403 without identification). ${files.length} information-table file(s).`, { source: base + 'index.json' }));
      const table = files[0] ? await sec.text(base + files[0]) : '';
      if (!/informationTable/.test(table)) throw new Error('Information table not found in archive.');
      const $ = load(table, { xmlMode: true });
      const held = new Set<string>();
      $('*').filter((_, el) => (el as any).name?.split(':').pop() === 'cusip').each((_, el) => { held.add($(el).text().trim().toUpperCase()); });
      const matches = Object.entries(CUSIPS).filter(([, c]) => held.has(c)).map(([s]) => s);
      out.push(pass('SEC 13F information table', `Retrieved and parsed (${held.size} CUSIPs).`, { source: base + files[0] }));
      out.push((matches.length ? pass : fail)('TCI holdings in research universe', matches.length
        ? `Holds ${matches.join(', ')}.` : 'None of LMT, RTX, GD, NOC or BAESY appear in TCI’s latest 13F; no holding-change evidence exists. Absence is not treated as a sale.', { data: { matches } }));
    } catch (e) { out.push(fail('SEC holdings archive', why(e), { source: base + 'index.json' })); }
  } catch (e) { out.push(fail('SEC submissions · TCI', why(e), { source: submissions })); }
  out.push(fail('Investor qualification', 'No manager has an independently verified ≥3-year return above its benchmark (FSDAX, ITA, XAR underperform; TCI unverified). Institutional 60% cannot be scored.'));
  return out;
}

async function bae(now: Date): Promise<Result[]> {
  try {
    const r = await collectBaeEsefFinancials(now);
    const ok = pass('BAE ESEF report (UK IFRS)', `Official annual report for period ending ${r.periodEnd}, LEI 8SVCSVKSGDWMW2QHOH83, GBP, unsegmented IFRS facts for ${r.periods.length} periods. SHA-256 ${r.sha256.slice(0, 16)}….`, { source: r.source, data: r.periods });
    return [ok, r.complete ? pass('BAE financial checks', `${r.checks!.basis} to ${r.checks!.period}.`, { data: r.checks })
      : fail('BAE financial checks', `${r.reason} Latest tagged report indexed ${r.indexedAt}; half-year results are not published in machine-readable XBRL. Freshness policy (120 days) unchanged.`)];
  } catch (e) { return [fail('BAE ESEF report (UK IFRS)', why(e))]; }
}

async function market(key: string | undefined, now: Date): Promise<Result[]> {
  return Promise.all(['LMT', 'RTX', 'GD', 'NOC', 'BAESY'].map(async symbol => {
    const name = `Market history · ${symbol}`;
    if (!key) return fail(name, 'Provider not configured in this context.');
    const u = new URL('https://api.twelvedata.com/time_series');
    u.search = new URLSearchParams({ symbol, interval: '1day', outputsize: '120', apikey: key }).toString();
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(6000) });
      const data = r.ok ? await r.json() : null;
      const rows = (data?.values ?? []).filter((x: any) => Date.parse(x.datetime) <= +now).sort((a: any, b: any) => b.datetime.localeCompare(a.datetime));
      const latest = rows[0];
      const baseline = rows.find((x: any) => latest && Date.parse(x.datetime) <= Date.parse(latest.datetime) - 90 * 86400000);
      const complete = data?.meta?.symbol === symbol && data?.meta?.currency === 'USD' && latest && baseline &&
        +now - Date.parse(latest.datetime) <= 5 * 86400000 && [latest, baseline].every(x => Number(x.close) > 0);
      // Never echo provider URLs or errors (they can carry the key).
      return complete ? pass(name, `Latest ${latest.datetime}, baseline ${baseline.datetime}, 90-day return ${((Number(latest.close) / Number(baseline.close) - 1) * 100).toFixed(2)}%.`)
        : fail(name, `Incomplete or stale history (HTTP ${r.status}).`);
    } catch { return fail(name, 'Request failed or timed out.'); }
  }));
}

function stopLoss(): Result[] {
  // Pure synthetic plan: no evidence, no database, no network. Average cost A$100/share.
  const run = (price: number) => planOrders({ symbols: ['LMT'], scores: {}, cash: 4000, shares: { LMT: 5 }, costBasis: { LMT: 500 },
    valuationPrices: { LMT: price }, tradeable: { LMT: { priceAud: price } } } as any);
  const at = run(92), below = run(91), above = run(92.01);
  const ok = at.orders.length === 1 && at.orders[0].side === 'SELL' && at.shares.LMT === 0 && below.orders.length === 1 && above.orders.length === 0;
  return [(ok ? pass : fail)('Protective −8% stop (synthetic, no research data)',
    `−8.00%: ${at.orders.map(o => o.side).join() || 'none'}; −9.00%: ${below.orders.map(o => o.side).join() || 'none'}; −7.99%: ${above.orders.map(o => o.side).join() || 'none'}.`)];
}

function scores(): Result[] {
  // No verified evidence exists for any stock, so the score must stay incomplete rather than zero.
  return ['LMT', 'RTX', 'GD', 'NOC', 'BAE'].map(s => {
    const sc = scoreEvidence(undefined, new Date());
    return fail(`60/40 score · ${s}`, `Incomplete (not zero): ${sc.reason} Financial checks alone cannot fill the 60% institutional component.`);
  });
}

export default async (req: Request, context: Context) => {
  if (context.deploy.context === 'production') return new Response('Not found', { status: 404 });
  const now = new Date();
  const which = new URL(req.url).searchParams.get('integration') ?? 'all';
  const agent = Netlify.env.get('SEC_USER_AGENT'), key = Netlify.env.get('TWELVE_DATA_API_KEY');
  const jobs: Record<string, () => Promise<Result[]> | Result[]> = {
    'sec-holdings': () => secHoldings(agent), 'sec-financials': () => secFinancials(agent, now),
    bae: () => bae(now), market: () => market(key, now), 'stop-loss': stopLoss, scores,
  };
  const selected = which === 'all' ? Object.keys(jobs) : which.split(',').filter(k => k in jobs);
  if (!selected.length) return Response.json({ error: 'Unknown integration', available: Object.keys(jobs) }, { status: 400 });
  const results = (await Promise.all(selected.map(k => jobs[k]()))).flat();
  return Response.json({ checkedAt: now.toISOString(), context: context.deploy.context, readOnly: true, results,
    summary: { pass: results.filter(r => r.result === 'PASS').length, fail: results.filter(r => r.result === 'FAIL').length } },
    { headers: { 'cache-control': 'no-store' } });
};
export const config: Config = { path: '/api/verify-financial-data', method: 'GET' };
