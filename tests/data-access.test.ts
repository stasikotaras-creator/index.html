import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSecClient, diagnoseSecStatus, validSecUserAgent } from '../lib/sec.js';
import { secFinancialPeriods, financialChecks } from '../lib/financials.js';
import { esefPeriods, BAE_LEI } from '../lib/bae.js';

const UA = 'TradeGuard Research ops@example.org';
test('SEC client requires a declared identity and sends it with compression', async () => {
  assert.equal(validSecUserAgent(undefined), false);
  assert.equal(validSecUserAgent('Mozilla/5.0'), false);
  assert.equal(validSecUserAgent('ops@example.org'), false);
  assert.equal(validSecUserAgent(UA), true);
  assert.throws(() => createSecClient('Mozilla/5.0'));
  let headers: any;
  const sec = createSecClient(UA, (async (_u: any, init: any) => { headers = init.headers; return Response.json({ ok: 1 }); }) as typeof fetch, { minIntervalMs: 0 });
  await sec.json('https://data.sec.gov/submissions/CIK0000000001.json');
  assert.equal(headers['User-Agent'], UA);
  assert.match(headers['Accept-Encoding'], /gzip/);
  await assert.rejects(sec.get('https://example.org/x'));
});
test('SEC 403 is diagnosed and never retried; 429 honours Retry-After; requests are spaced', async () => {
  let calls = 0;
  const blocked = createSecClient(UA, (async () => { calls++; return new Response('Your Request Originates from an Undeclared Automated Tool', { status: 403 }); }) as typeof fetch, { minIntervalMs: 0 });
  await assert.rejects(blocked.get('https://www.sec.gov/Archives/edgar/data/1/index.json'), (e: any) => e.status === 403 && /undeclared automated tool/i.test(e.diagnosis));
  assert.equal(calls, 1);
  assert.match(diagnoseSecStatus(403, ''), /do not bypass/i);
  let n = 0;
  const limited = createSecClient(UA, (async () => ++n === 1 ? new Response('', { status: 429, headers: { 'retry-after': '0.01' } }) : Response.json({})) as typeof fetch, { minIntervalMs: 0 });
  await limited.json('https://data.sec.gov/x.json');
  assert.equal(n, 2);
  const times: number[] = [];
  const spaced = createSecClient(UA, (async () => { times.push(Date.now()); return Response.json({}); }) as typeof fetch, { minIntervalMs: 100 });
  await Promise.all([1, 2, 3].map(() => spaced.json('https://data.sec.gov/x.json')));
  assert.ok(times[2] - times[0] >= 190, 'concurrent requests must be serialised under the rate limit');
});

// Synthetic SEC companyfacts using real issuer tag shapes: YTD cash flow, discrete and YTD income statement.
const QUARTERS = [['2024-01-01', '2024-03-31'], ['2024-04-01', '2024-06-30'], ['2024-07-01', '2024-09-30'], ['2024-10-01', '2024-12-31'], ['2025-01-01', '2025-03-31'], ['2025-04-01', '2025-06-30'], ['2025-07-01', '2025-09-30'],
  ['2025-10-01', '2025-12-31'], ['2026-01-01', '2026-03-31'], ['2026-04-01', '2026-06-30'], ['2026-07-01', '2026-09-30']];
// Each filing reports year-to-date values; income-statement tags also report the discrete quarter.
function facts(cik: number, tags: Record<string, (q: number) => number>, ytdOnly: string[] = []) {
  const usd: Record<string, any[]> = {};
  QUARTERS.forEach(([start, end], q) => {
    const fiscalQ = Number(end.slice(5, 7)) / 3, accn = `ACC-${q}`, filed = new Date(Date.parse(end) + 30 * 86400000).toISOString().slice(0, 10);
    const form = fiscalQ === 4 ? '10-K' : '10-Q';
    for (const [tag, fn] of Object.entries(tags)) {
      let ytd = 0; for (let k = q - fiscalQ + 1; k <= q; k++) ytd += fn(k);
      (usd[tag] ??= []).push({ start: `${end.slice(0, 4)}-01-01`, end, val: ytd, accn, filed, form });
      if (fiscalQ > 1 && !ytdOnly.includes(tag)) usd[tag].push({ start, end, val: fn(q), accn, filed, form });
    }
  });
  return { cik, facts: { 'us-gaap': Object.fromEntries(Object.entries(usd).map(([t, rows]) => [t, { units: { USD: rows } }])) } };
}
const now = new Date('2026-11-10');
test('LMT mapping uses InterestExpenseNonoperating and PaymentsToAcquireProductiveAssets for TTM', () => {
  const f = facts(936468, { Revenues: q => 100 + q, OperatingIncomeLoss: () => 20, InterestExpenseNonoperating: () => 4,
    NetCashProvidedByUsedInOperatingActivities: () => 30, PaymentsToAcquireProductiveAssets: () => 10 }, ['NetCashProvidedByUsedInOperatingActivities', 'PaymentsToAcquireProductiveAssets']);
  const c = financialChecks(secFinancialPeriods(f), now);
  assert.match(c.basis, /TTM/); assert.equal(c.interestCoverage, 5); assert.equal(c.concepts?.capex, 'Capital expenditures');
});
test('RTX net interest is sign-inverted and rejected when it is net income', () => {
  const base = { RevenueFromContractWithCustomerExcludingAssessedTax: (q: number) => 100 + q, OperatingIncomeLoss: () => 20,
    NetCashProvidedByUsedInOperatingActivities: () => 30, PaymentsToAcquirePropertyPlantAndEquipment: () => 10 };
  const ytd = ['NetCashProvidedByUsedInOperatingActivities', 'PaymentsToAcquirePropertyPlantAndEquipment'];
  assert.equal(financialChecks(secFinancialPeriods(facts(101829, { ...base, InterestIncomeExpenseNonoperatingNet: () => -4 }, ytd)), now).interestCoverage, 5);
  assert.throws(() => financialChecks(secFinancialPeriods(facts(101829, { ...base, InterestIncomeExpenseNonoperatingNet: () => 4 }, ytd)), now));
});
test('GD total operating cash = continuing + discontinued when only split values are filed', () => {
  const f: any = facts(40533, { RevenueFromContractWithCustomerExcludingAssessedTax: q => 100 + q, OperatingIncomeLoss: () => 20,
    InterestIncomeExpenseNet: () => -4, NetCashProvidedByUsedInOperatingActivitiesContinuingOperations: () => 31,
    CashProvidedByUsedInOperatingActivitiesDiscontinuedOperations: () => -1, PaymentsToAcquirePropertyPlantAndEquipment: () => 10 },
    ['NetCashProvidedByUsedInOperatingActivitiesContinuingOperations', 'CashProvidedByUsedInOperatingActivitiesDiscontinuedOperations', 'PaymentsToAcquirePropertyPlantAndEquipment']);
  const periods = secFinancialPeriods(f);
  assert.ok(periods.every(p => p.cash % 30 === 0));
  // Continuing operations alone must not be used.
  delete f.facts['us-gaap'].CashProvidedByUsedInOperatingActivitiesDiscontinuedOperations;
  assert.equal(secFinancialPeriods(f).length, 0);
});

test('BAE ESEF adapter accepts only unsegmented GBP IFRS facts for the verified LEI', () => {
  const fact = (concept: string, period: string, value: number, extra: Record<string, string> = {}) =>
    ({ value: String(value), dimensions: { concept, entity: `scheme:${BAE_LEI}`, period, unit: 'iso4217:GBP', ...extra } });
  const fy = (y: number) => `${y}-01-01T00:00:00/${y + 1}-01-01T00:00:00`;
  const all = (y: number, rev: number) => [fact('ifrs-full:Revenue', fy(y), rev), fact('ifrs-full:ProfitLossFromOperatingActivities', fy(y), 50),
    fact('ifrs-full:FinanceCosts', fy(y), 10), fact('ifrs-full:CashFlowsFromUsedInOperatingActivities', fy(y), 30),
    fact('baesystemsplc:PurchaseOfPropertyPlantAndEquipmentAndInvestmentPropertyClassifiedAsInvestingActivities', fy(y), 10)];
  const report = { documentInfo: { documentType: 'https://xbrl.org/2021/xbrl-json', namespaces: { 'ifrs-full': 'https://xbrl.ifrs.org/taxonomy/2024-03-27/ifrs-full' } },
    facts: Object.fromEntries([...all(2025, 120), ...all(2024, 100), fact('ifrs-full:Revenue', fy(2025), 999, { 'ifrs-full:SegmentsAxis': 'x' }),
      { value: '777', dimensions: { concept: 'ifrs-full:Revenue', entity: 'scheme:OTHERLEI', period: fy(2025), unit: 'iso4217:GBP' } }].map((f, i) => [`f${i}`, f])) };
  const filing = { periodEnd: '2025-12-31', dateAdded: '2026-03-01', jsonUrl: 'https://filings.xbrl.org/x.json', reportUrl: 'https://filings.xbrl.org/x.html', errors: 0 };
  const periods = esefPeriods(report, filing, 'hash');
  assert.deepEqual(periods.map(p => [p.start, p.end, p.revenue]), [['2025-01-01', '2025-12-31', 120], ['2024-01-01', '2024-12-31', 100]]);
  const fresh = financialChecks(periods, new Date('2026-04-01'), 2);
  assert.equal(fresh.basis, 'annual'); assert.equal(fresh.interestCoverage, 5); assert.ok(Math.abs(fresh.revenueGrowthPct - 20) < 1e-9);
  assert.throws(() => financialChecks(periods, now, 2), /stale/);
  const usd = JSON.parse(JSON.stringify(report).replaceAll('iso4217:GBP', 'iso4217:USD'));
  assert.equal(esefPeriods(usd, filing, 'hash').length, 0);
});
