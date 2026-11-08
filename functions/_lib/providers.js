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

/** Recent company news (from/to are YYYY-MM-DD). Returns [{ headline, summary, source, url, time }] newest first. */
export async function getCompanyNews(env, symbol, from, to) {
  const items = await finnhub(env, '/company-news', { symbol, from, to });
  const seen = new Set();
  const out = [];
  for (const n of Array.isArray(items) ? items : []) {
    const headline = String(n.headline || '').trim();
    const url = String(n.url || '');
    if (!headline || !/^https?:\/\//i.test(url) || seen.has(headline)) continue; // only real web links
    seen.add(headline);
    out.push({
      headline,
      summary: String(n.summary || '').trim(),
      source: String(n.source || '').trim(),
      url,
      time: n.datetime ? n.datetime * 1000 : null,
    });
  }
  out.sort((a, b) => (b.time || 0) - (a.time || 0));
  return out;
}

/** A few basic financials; any field may be null (not every ticker has every metric). */
export async function getBasicFinancials(env, symbol) {
  const data = await finnhub(env, '/stock/metric', { symbol, metric: 'all' });
  const m = data?.metric || {};
  const num = (...keys) => {
    for (const k of keys) if (typeof m[k] === 'number' && Number.isFinite(m[k])) return m[k];
    return null;
  };
  return {
    week52High: num('52WeekHigh'),
    week52Low: num('52WeekLow'),
    beta: num('beta'),
    peRatio: num('peTTM', 'peBasicExclExtraTTM', 'peNormalizedAnnual'),
    marketCapMillions: num('marketCapitalization'),
    dividendYieldPercent: num('dividendYieldIndicatedAnnual', 'currentDividendYieldTTM'),
    priceReturn52WeekPercent: num('52WeekPriceReturnDaily'),
  };
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

// ---------------------------------------------------------------- Twelve Data
// Docs: https://twelvedata.com/docs/market-data/time-series  (free tier ~8 credits/min + daily cap)

const TWELVEDATA_BASE = 'https://api.twelvedata.com';
const RATE_LIMIT_MESSAGE = 'Chart data limit reached, try again in a minute.';

/**
 * Historical closes, oldest first. `interval`: '1min' | '5min' | '1day'.
 * Returns { bars: [{ t, c }] } where t is the bar's exchange-local (New York) wall-clock time
 * expressed as seconds-since-epoch-as-if-UTC, so the chart axis shows market time.
 */
export async function getTimeSeries(env, symbol, interval, outputsize) {
  if (!env.TWELVEDATA_API_KEY) throw new ProviderError('config', 'Twelve Data API key is not set on the server.', 500);
  const params = new URLSearchParams({ symbol, interval, outputsize: String(outputsize), order: 'asc', timezone: 'America/New_York' });
  let data;
  try {
    data = await fetchJson(`${TWELVEDATA_BASE}/time_series?${params}`, {
      headers: { Authorization: `apikey ${env.TWELVEDATA_API_KEY}` },
      provider: 'Twelve Data',
      timeoutMs: 10000,
    });
  } catch (err) {
    if (err.code === 'rate_limited') throw new ProviderError('rate_limited', RATE_LIMIT_MESSAGE, 429);
    throw err;
  }
  // Twelve Data can report errors inside an HTTP 200 body: { status: "error", code, message }.
  if (data?.status === 'error') {
    if (data.code === 429) throw new ProviderError('rate_limited', RATE_LIMIT_MESSAGE, 429);
    if (data.code === 400 || data.code === 404) throw new ProviderError('not_found', `No chart data for ${symbol}.`, 404);
    if (data.code === 401 || data.code === 403) throw new ProviderError('bad_key', 'Twelve Data rejected the API key (or this data needs a paid plan).', 502);
    throw new ProviderError('upstream', 'Twelve Data returned an error.');
  }
  const bars = [];
  for (const v of data?.values || []) {
    const t = marketTimeToSeconds(v.datetime);
    const c = Number(v.close);
    if (t !== null && Number.isFinite(c)) bars.push({ t, c });
  }
  if (!bars.length) throw new ProviderError('not_found', `No chart data for ${symbol}.`, 404);
  return { bars };
}

// "2026-11-06 15:55:00" or "2026-11-06" -> seconds, treating the wall-clock time as UTC.
function marketTimeToSeconds(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(String(s || ''));
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) / 1000;
}

// ---------------------------------------------------------------- Gemini
// Docs: https://aistudio.google.com/api-reference/generate-content  (models: https://aistudio.google.com/docs/models)
// The model name always comes from env (GEMINI_MODEL / GEMINI_FALLBACK_MODEL); never hardcoded.

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_BUSY = 'Gemini is busy, try again in a minute.';
const RETRY_DELAYS_MS = [1000, 3000];

async function geminiOnce(env, model, { system, prompt, schema }) {
  const generationConfig = { responseMimeType: 'application/json', temperature: 0.2 };
  if (schema) generationConfig.responseJsonSchema = schema;
  let res;
  try {
    res = await fetch(`${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig,
      }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    throw new ProviderError(timeout ? 'timeout' : 'upstream', timeout ? 'Gemini took too long to respond.' : "Couldn't reach Gemini.", 504);
  }
  if (res.status === 503 || res.status === 429) throw new ProviderError('busy', GEMINI_BUSY, 503);
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* handled below */
  }
  if (res.status === 400) {
    throw new ProviderError('bad_request', `Gemini rejected the request: ${data?.error?.message || 'bad request'}`, 502);
  }
  if (res.status === 401 || res.status === 403) throw new ProviderError('bad_key', 'Gemini rejected the API key.', 502);
  if (res.status === 404) throw new ProviderError('config', `Gemini model "${model}" was not found. Check GEMINI_MODEL.`, 502);
  if (!res.ok) throw new ProviderError('upstream', `Gemini returned an error (${res.status}).`);

  const cand = data?.candidates?.[0];
  const text = (cand?.content?.parts || []).map((p) => p.text || '').join('');
  if (!text) {
    const why = data?.promptFeedback?.blockReason || cand?.finishReason || 'empty response';
    throw new ProviderError('upstream', `Gemini returned no answer (${why}).`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderError('bad_output', 'Gemini returned an unreadable answer. Try again.');
  }
}

/**
 * JSON-mode generation with the spec's retry policy: on 503/429 retry twice (1 s, then 3 s);
 * if still failing and GEMINI_FALLBACK_MODEL is set, try that once. Returns { json, model }.
 */
export async function generateJson(env, { system, prompt, schema }) {
  if (!env.GEMINI_API_KEY) throw new ProviderError('config', 'Risk summaries need GEMINI_API_KEY to be set on the server.', 500);
  const primary = String(env.GEMINI_MODEL || '').trim();
  if (!primary) throw new ProviderError('config', 'Risk summaries need GEMINI_MODEL to be set (see README).', 500);
  const fallback = String(env.GEMINI_FALLBACK_MODEL || '').trim();

  const attempt = async (model) => {
    try {
      return await geminiOnce(env, model, { system, prompt, schema });
    } catch (err) {
      // If a model doesn't accept the schema field, plain JSON mode still works (the prompt has the shape).
      if (err.code === 'bad_request' && schema) return geminiOnce(env, model, { system, prompt });
      throw err;
    }
  };

  let lastErr;
  for (let i = 0; i <= RETRY_DELAYS_MS.length; i++) {
    try {
      return { json: await attempt(primary), model: primary };
    } catch (err) {
      lastErr = err;
      if (err.code !== 'busy') break; // only 503/429 are retried
      if (i < RETRY_DELAYS_MS.length) await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[i]));
    }
  }
  if (fallback && fallback !== primary && ['busy', 'timeout', 'upstream'].includes(lastErr?.code)) {
    try {
      return { json: await attempt(fallback), model: fallback };
    } catch (err) {
      lastErr = err;
    }
  }
  if (['busy', 'timeout'].includes(lastErr?.code)) throw new ProviderError('busy', GEMINI_BUSY, 503);
  throw lastErr;
}
