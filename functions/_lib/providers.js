// ALL third-party API code lives here, so a data provider can be swapped
// without touching the rest of the app. Functions return plain, provider-neutral shapes.

export class ProviderError extends Error {
  // code: 'rate_limited' | 'timeout' | 'not_found' | 'config' | 'bad_key' | 'upstream'
  constructor(code, message, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const DEFAULT_TIMEOUT_MS = 8000;

async function fetchJson(url, { headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS, provider } = {}) {
  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new ProviderError('timeout', `${provider} took too long to respond.`, 504);
    }
    throw new ProviderError('upstream', `Couldn't reach ${provider}.`);
  }
  if (res.status === 429) throw new ProviderError('rate_limited', `${provider} rate limit reached. Try again in a minute.`, 429);
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError('bad_key', `${provider} rejected the API key (or this data needs a paid plan).`, 502);
  }
  if (!res.ok) throw new ProviderError('upstream', `${provider} returned an error (${res.status}).`);
  try {
    return await res.json();
  } catch {
    throw new ProviderError('upstream', `${provider} sent an unreadable response.`);
  }
}

// ---------------------------------------------------------------- Finnhub
// Docs: https://finnhub.io/docs/api  (free tier ~60 calls/min, 30/sec burst)

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

function finnhub(env, path, params) {
  if (!env.FINNHUB_API_KEY) throw new ProviderError('config', 'Finnhub API key is not set on the server.', 500);
  const url = `${FINNHUB_BASE}${path}?${new URLSearchParams(params)}`;
  // Key goes in a header rather than the URL so it never shows up in logs.
  return fetchJson(url, { headers: { 'X-Finnhub-Token': env.FINNHUB_API_KEY }, provider: 'Finnhub' });
}

/** Current quote. Returns { symbol, price, change, changePercent, previousClose, time }. */
export async function getQuote(env, symbol) {
  const q = await finnhub(env, '/quote', { symbol });
  // Finnhub returns zeros (or nulls) for unknown symbols.
  if (!q || typeof q.c !== 'number' || (q.c === 0 && !q.pc)) {
    throw new ProviderError('not_found', `No quote found for ${symbol}.`, 404);
  }
  const previousClose = q.pc || null;
  const change = typeof q.d === 'number' ? q.d : previousClose ? q.c - previousClose : null;
  const changePercent = typeof q.dp === 'number' ? q.dp : previousClose ? (change / previousClose) * 100 : null;
  return {
    symbol,
    price: q.c,
    change,
    changePercent,
    previousClose,
    time: q.t ? q.t * 1000 : null,
  };
}

// Types worth showing to someone following US stocks and ETFs.
const ALLOWED_TYPES = new Set(['Common Stock', 'ETP', 'ADR', 'REIT']);

/** Symbol search, US listings only. Returns [{ symbol, name }] (best matches first, max 8). */
export async function searchSymbols(env, query) {
  const data = await finnhub(env, '/search', { q: query, exchange: 'US' });
  const q = query.toUpperCase();
  const seen = new Set();
  const results = [];
  for (const r of data?.result || []) {
    const symbol = String(r.symbol || '').toUpperCase();
    // Skip non-US/OTC-style duplicates and odd instruments.
    if (!symbol || seen.has(symbol) || !ALLOWED_TYPES.has(r.type)) continue;
    if (!/^[A-Z][A-Z0-9]{0,5}(\.[A-Z])?$/.test(symbol)) continue;
    seen.add(symbol);
    results.push({ symbol, name: prettyName(r.description || symbol) });
  }
  // Exact symbol match first, then symbols starting with the query, then the rest.
  const rank = (r) => (r.symbol === q ? 0 : r.symbol.startsWith(q) ? 1 : 2);
  results.sort((a, b) => rank(a) - rank(b));
  return results.slice(0, 8);
}

/** Company profile (name etc.). Returns null when unavailable (e.g. most ETFs on the free tier). */
export async function getCompanyProfile(env, symbol) {
  const p = await finnhub(env, '/stock/profile2', { symbol });
  if (!p || !p.name) return null;
  return { symbol, name: p.name, exchange: p.exchange || null, industry: p.finnhubIndustry || null, marketCap: p.marketCapitalization ?? null, logo: p.logo || null, weburl: p.weburl || null };
}

// Finnhub search descriptions are ALL CAPS ("APPLE INC"); make them readable.
const KEEP_UPPER = new Set(['ETF', 'ETN', 'REIT', 'ADR', 'USA', 'US', 'S&P', 'SPDR', 'II', 'III', 'IV', 'LP', 'NV', 'SA', 'AG', 'PLC', 'NYSE', 'QQQ', 'MSCI', 'ESG', 'AI', 'TR']);
function prettyName(desc) {
  if (desc !== desc.toUpperCase()) return desc;
  return desc
    .split(' ')
    .map((w) => (KEEP_UPPER.has(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()))
    .join(' ');
}

// ---------------------------------------------------------------- Twelve Data (Phase 2)
// ---------------------------------------------------------------- Gemini (Phase 5)
