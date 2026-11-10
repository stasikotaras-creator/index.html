// Operator-only import. Source documents must be checked before use; no public write endpoint.
import { readFile } from 'node:fs/promises';
import { db } from '../db/index.js';
import { investmentEvidence } from '../db/schema.js';
import { scoreEvidence, type Evidence } from '../lib/scoring.js';
import { STOCKS } from '../lib/simulation.js';
const [symbol, file, attestation] = process.argv.slice(2);
if (!STOCKS.some(s => s.symbol === symbol) || !file || attestation !== '--sources-verified')
  throw new Error('Usage: tsx scripts/record-evidence.ts SYMBOL evidence-file --sources-verified');
const now = new Date();
const evidence: Evidence = JSON.parse(await readFile(file, 'utf8'));
evidence.capturedAt = now.toISOString();
const score = scoreEvidence(evidence, now);
if (!score.complete) throw new Error(score.reason);
await db.insert(investmentEvidence).values({ symbol, evidence, recordedAt: now });
console.log('Verified evidence recorded. It becomes eligible on the next trading cycle.');
