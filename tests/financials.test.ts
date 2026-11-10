import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { financialChecks, type FinancialPeriod } from '../lib/financials.js';
import { collectBaeFinancials } from '../lib/bae.js';
const now = new Date('2026-11-10');
const periods: FinancialPeriod[] = [2025,2026].flatMap(year => [1,2,3,4].map(q => ({
  start:`${year}-01-01`, end:`${year}-${String(q*3).padStart(2,'0')}-${q===1 || q===4 ? '31':'30'}`,
  filed:q === 4 ? `${year+1}-02-01` : `${year}-11-01`, accession:`${year}-${q}`, revenue:q*(year===2026?120:100), operating:q*20,
  interest:q*5, cash:q*30, capex:q*10,
}))).filter(p => p.end <= '2026-09-30');
// Eight quarters through Q3 2026 require the preceding Q4 2024.
periods.unshift({ start:'2024-10-01', end:'2024-12-31', filed:'2025-02-01', accession:'2024-Q4',
  revenue:100, operating:20, interest:5, cash:30, capex:10 });
// Annual end is Dec 31, not Dec 30; June and September have 30 days.
for (const p of periods) { p.end = p.end.replace('06-30','06-30').replace('09-31','09-30').replace('12-30','12-31'); }
test('TTM derives eight consecutive quarters from cumulative filings without double counting', () => {
  const f = financialChecks(periods, now);
  assert.match(f.basis,/TTM/);
  assert.equal(f.period,'2026-09-30');
  assert.ok(Math.abs(f.revenueGrowthPct-15)<1e-9);
  assert.equal(f.interestCoverage,4);
  assert.equal(f.freeCashFlowPositive,true);
});
test('missing quarter, future publication, stale financials and zero interest fail closed', () => {
  assert.throws(() => financialChecks(periods.filter(p => p.accession !== '2025-3'),now));
  assert.throws(() => financialChecks(periods.map(p => ({ ...p,filed:'2027-01-01' })),now));
  assert.throws(() => financialChecks(periods,new Date('2027-11-10')));
  assert.throws(() => financialChecks(periods.map(p => ({...p,interest:0})),now));
});
function report() {
 const tags = { Revenue:120, ProfitLossFromOperatingActivities:50, InterestExpense:10,
  CashFlowsFromUsedInOperatingActivities:30, PurchaseOfPropertyPlantAndEquipment:10 };
 return `<html xmlns:ix="ix" xmlns:xbrli="xbrli"><xbrli:unit id="GBP"><xbrli:measure>iso4217:GBP</xbrli:measure></xbrli:unit>`+
 ['2025','2026'].map(year => `<xbrli:context id="${year}"><xbrli:entity><xbrli:identifier>01470151</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>${Number(year)-1}-10-01</xbrli:startDate><xbrli:endDate>${year}-09-30</xbrli:endDate></xbrli:period></xbrli:context>`+
 Object.entries(tags).map(([tag,v]) => `<ix:nonFraction name="ifrs-full:${tag}" contextRef="${year}" unitRef="GBP">${year==='2025' && tag==='Revenue'?100:v}</ix:nonFraction>`).join('')).join('')+'</html>';
}
test('separate BAE IFRS adapter checks official hash, GBP facts and issuer without converting financial ratios by ADR',async () => {
 const body=report(), source={url:'https://www.baesystems.com/report.xhtml',publishedAt:'2026-11-01',sha256:createHash('sha256').update(body).digest('hex')};
 const fetcher=(async()=>new Response(body)) as typeof fetch;
 const f=await collectBaeFinancials([source],now,fetcher);
 assert.equal(f.interestCoverage,5); assert.ok(Math.abs(f.revenueGrowthPct-20)<1e-9);
 await assert.rejects(collectBaeFinancials([{...source,sha256:'wrong'}],now,fetcher));
 await assert.rejects(collectBaeFinancials([{...source,url:'https://example.org/report'}],now,fetcher));
 const changed=body.replaceAll('iso4217:GBP','iso4217:USD');
 await assert.rejects(collectBaeFinancials([{...source,sha256:createHash('sha256').update(changed).digest('hex')}],now,(async()=>new Response(changed)) as typeof fetch));
});
