// Compliant SEC EDGAR client (https://www.sec.gov/os/accessing-edgar-data).
// - Declares the operator via SEC_USER_AGENT ("Name or Org contact@example.com").
// - Requests compressed responses and stays well under the 10 requests/second ceiling.
// - Retries only 429/503 with Retry-After backoff. A 403 is reported, never worked around.
export const SEC_HOSTS = ['www.sec.gov', 'data.sec.gov', 'efts.sec.gov'];
export const SEC_MIN_INTERVAL_MS = 200; // ≤5 requests/second per process.

export function validSecUserAgent(ua: string | undefined): ua is string {
  return typeof ua === 'string' && /\S+\s+\S+@\S+\.\S+/.test(ua.trim()) && ua.length <= 200;
}

export class SecAccessError extends Error {
  constructor(public status: number, public url: string, public diagnosis: string) { super(`SEC HTTP ${status}: ${diagnosis}`); }
}

export function diagnoseSecStatus(status: number, body = ''): string {
  if (status === 403 && /undeclared automated tool/i.test(body))
    return 'Blocked as an undeclared automated tool: request lacked a compliant identifying User-Agent. Configure SEC_USER_AGENT; do not spoof a browser.';
  if (status === 403) return 'Forbidden by SEC fair-access controls (possible rate-limit lockout). Wait and reduce request rate; do not bypass.';
  if (status === 429) return 'Rate limited by SEC; retry after the advised delay.';
  if (status === 404) return 'Resource not found at SEC.';
  return `Unexpected SEC response ${status}.`;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function createSecClient(userAgent: string | undefined, fetchImpl: typeof fetch = fetch,
  opts: { minIntervalMs?: number; maxRetries?: number; timeoutMs?: number } = {}) {
  if (!validSecUserAgent(userAgent)) throw new Error('SEC requires an identifying User-Agent with a contact email (SEC_USER_AGENT).');
  const min = opts.minIntervalMs ?? SEC_MIN_INTERVAL_MS, retries = opts.maxRetries ?? 2;
  let last = 0, queue: Promise<unknown> = Promise.resolve();
  let requests = 0;
  const one = async (source: string): Promise<Response> => {
    const u = new URL(source);
    if (u.protocol !== 'https:' || !SEC_HOSTS.includes(u.hostname) || u.username || u.password)
      throw new Error('Only official SEC HTTPS sources are accepted.');
    for (let attempt = 0; ; attempt++) {
      const wait = last + min - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now(); requests++;
      const res = await fetchImpl(u, { headers: { 'User-Agent': userAgent, 'Accept-Encoding': 'gzip, deflate',
        accept: 'application/json, application/xml, text/xml, text/html' }, redirect: 'error', signal: AbortSignal.timeout(opts.timeoutMs ?? 10000) });
      if (res.ok) return res;
      const body = await res.text().catch(() => '');
      if ((res.status === 429 || res.status === 503) && attempt < retries) {
        const after = Number(res.headers.get('retry-after'));
        await sleep(Math.min(Number.isFinite(after) && after > 0 ? after * 1000 : 1000 * 2 ** attempt, 10000));
        continue;
      }
      throw new SecAccessError(res.status, u.toString(), diagnoseSecStatus(res.status, body));
    }
  };
  // Serialise requests so concurrency never exceeds the rate limit.
  const get = (source: string) => { const p = queue.then(() => one(source)); queue = p.catch(() => undefined); return p; };
  return {
    get, text: async (s: string) => (await get(s)).text(), json: async (s: string) => (await get(s)).json(),
    get requestCount() { return requests; },
  };
}
export type SecClient = ReturnType<typeof createSecClient>;
