// Operator-only collection; never runs the trading cycle or changes positions.
// Manifest requires source verification: manager identity, consecutive original (not amended)
// 13F periods, filing dates, CUSIP/security identity and comparable manager/benchmark returns.
import { readFile } from 'node:fs/promises';
import { collectEdgarEvidence, type EdgarInput, refreshEdgarInput } from '../lib/edgar.js';
import { collectBaeFinancials, collectBaeEsefFinancials, type BaeReport } from '../lib/bae.js';
import { scoreEvidence } from '../lib/scoring.js';
import { db } from '../db/index.js';
import { investmentEvidence } from '../db/schema.js';
const [file, attestation] = process.argv.slice(2);
if (!file || attestation !== '--sources-verified') throw new Error('Usage: tsx scripts/collect-edgar-evidence.ts manifest.json --sources-verified');
const manifest: { symbol: string; edgar: EdgarInput; managerCik: string; baeReports?: BaeReport[]; adrOrdinaryRatio?: number } = JSON.parse(await readFile(file, 'utf8'));
const mapping: Record<string, { cik: string; ticker: string }> = {
  LMT: { cik: '936468', ticker: 'LMT' }, RTX: { cik: '101829', ticker: 'RTX' },
  GD: { cik: '40533', ticker: 'GD' }, NOC: { cik: '1133421', ticker: 'NOC' },
};
const company = manifest.symbol === 'BAE' ? { cik: manifest.edgar.companyCik, ticker:'BAESY' } : mapping[manifest.symbol];
if (manifest.symbol === 'BAE' && manifest.adrOrdinaryRatio !== 4) throw new Error('Verified 4:1 ordinary-share ADR ratio required.');
if (!company || Number(company.cik) !== Number(manifest.edgar.companyCik))
  throw new Error('Unsupported company or mismatched CIK. BAE requires a separately verified IFRS/ADR adapter.');
const env = (name: string) => (globalThis as any).Netlify?.env?.get(name) ?? process.env[name];
const key = env('TWELVE_DATA_API_KEY'), agent = env('SEC_USER_AGENT');
if (!key || !agent) throw new Error('Market provider and identifying SEC contact must be configured.');
const now = new Date();
const url = new URL('https://api.twelvedata.com/time_series');
url.search = new URLSearchParams({ symbol: company.ticker, interval: '1day', outputsize: '120', apikey: key }).toString();
const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
if (!response.ok) throw new Error('Market history unavailable.');
const history = await response.json();
if (history.meta?.symbol !== company.ticker || history.meta?.currency !== 'USD') throw new Error('Market history identity mismatch.');
const values = (history.values ?? []).filter((r: any) => Date.parse(r.datetime) <= now.getTime())
  .sort((a: any, b: any) => b.datetime.localeCompare(a.datetime));
const latest = values[0];
const baseline = values.find((r: any) => latest && Date.parse(r.datetime) <= Date.parse(latest.datetime) - 90 * 86400000);
if (!latest || !baseline || now.getTime() - Date.parse(latest.datetime) > 5 * 86400000 ||
  ![latest, baseline].every(r => Number.isFinite(Number(r.close)) && Number(r.close) > 0)) throw new Error('Incomplete or stale 90-day market history.');
const refreshed = await refreshEdgarInput(manifest.edgar, manifest.managerCik, agent);
// BAE: hash-verified inline-XBRL reports when supplied, otherwise the official ESEF annual filing.
const esef = manifest.symbol === 'BAE' && !manifest.baeReports?.length ? await collectBaeEsefFinancials(now) : undefined;
if (esef && !esef.complete) throw new Error(`BAE financial evidence incomplete: ${esef.reason}`);
const bae = manifest.symbol !== 'BAE' ? undefined : esef?.checks ? { ...esef.checks, sourceUrl: esef.source, reportSources: [{ url: esef.source, publishedAt: esef.indexedAt, sha256: esef.sha256 }] }
  : await collectBaeFinancials(manifest.baeReports!, now);
const evidence = await collectEdgarEvidence(refreshed, agent, now, {
  return90dPct: (Number(latest.close) / Number(baseline.close) - 1) * 100,
  sourceUrl: `https://api.twelvedata.com/time_series?symbol=${company.ticker}&interval=1day`, publishedAt: latest.datetime,
}, fetch, bae ? { ...bae, return90dPct: (Number(latest.close) / Number(baseline.close) - 1) * 100 } : undefined);
const score = scoreEvidence(evidence, now);
if (!score.complete) throw new Error(score.reason);
await db.insert(investmentEvidence).values({ symbol: manifest.symbol, evidence, recordedAt: now });
console.log('Verified SEC evidence appended; positions, cash and trades unchanged.');
