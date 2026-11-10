import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectEdgarEvidence, type EdgarInput } from '../lib/edgar.js';
import { evidence } from './evidence-fixture.js';
const input: EdgarInput = {
  currentFilingUrl: 'https://www.sec.gov/Archives/current.xml', previousFilingUrl: 'https://www.sec.gov/Archives/previous.xml',
  currentPublishedAt: '2026-11-01', previousPublishedAt: '2026-08-01', currentPeriod: '2026-09-30', previousPeriod: '2026-06-30',
  cusip: 'TEST12345', companyCik: '936468', performance: evidence.institutional,
};
const now = new Date('2026-11-10');
const market = { return90dPct: 10, sourceUrl: 'https://example.org/TEST', publishedAt: '2026-11-09' };
const xml = (n: number) => `<informationTable><infoTable><cusip>TEST12345</cusip><shrsOrPrnAmt><sshPrnamt>${n}</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt></infoTable></informationTable>`;
const fact = (val: number, start = '2025-10-01', end = '2026-09-30') => ({ val, start, end, filed: '2026-11-01', accn: 'TEST', form: '10-K' });
const fetcher = (async (url: any) => {
  if (String(url).endsWith('current.xml')) return new Response(xml(120));
  if (String(url).endsWith('previous.xml')) return new Response(xml(100));
  return Response.json({ cik: 936468, facts: { 'us-gaap': Object.fromEntries(Object.entries({
    Revenues: [fact(120), fact(100, '2024-10-01', '2025-09-30')],
    InterestExpense: [fact(10)], OperatingIncomeLoss: [fact(50)],
    NetCashProvidedByUsedInOperatingActivities: [fact(30)], PaymentsToAcquirePropertyPlantAndEquipment: [fact(10)],
  }).map(([tag, rows]) => [tag, { units: { USD: rows } }])) } });
}) as typeof fetch;
test('SEC adapter derives holdings and comparable financial checks with source provenance', async () => {
  const e = await collectEdgarEvidence(input, 'TradeGuard test@example.org', now, market, fetcher);
  assert.equal(e.institutional.holdingChangePct, 20);
  assert.ok(Math.abs(e.financial.revenueGrowthPct - 20) < 1e-9);
  assert.equal(e.financial.interestCoverage, 5);
  assert.equal(e.financial.freeCashFlowPositive, true);
  assert.equal(e.provenance!.financialAccession, 'TEST');
});
test('SEC adapter rejects non-SEC sources, missing CUSIP and missing contact', async () => {
  await assert.rejects(collectEdgarEvidence({ ...input, currentFilingUrl: 'https://example.org/x' }, 'test@example.org', now, market, fetcher));
  await assert.rejects(collectEdgarEvidence({ ...input, cusip: 'MISSING' }, 'test@example.org', now, market, fetcher));
  await assert.rejects(collectEdgarEvidence(input, '', now, market, fetcher));
});
