import { cacheGetMany, cachePutMany, safely } from '../_lib/cache.js';
import { errorResponse, json, normalizeSymbol } from '../_lib/http.js';
import { getQuote, ProviderError } from '../_lib/providers.js';

const TTL_SECONDS = 30;
const MAX_SYMBOLS = 50;
const CONCURRENCY = 8; // Stay well under Finnhub's 30 calls/second burst limit.

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** GET /api/quotes?symbols=AAPL,MSFT -> { quotes: {SYM: quote}, errors: {SYM: message}, rateLimited } */
export async function onRequestGet({ request, env }) {
  const raw = (new URL(request.url).searchParams.get('symbols') || '').split(',');
  const symbols = [...new Set(raw.map(normalizeSymbol).filter(Boolean))];
  if (!symbols.length) return errorResponse('No valid symbols given.', 400);
  if (symbols.length > MAX_SYMBOLS) return errorResponse(`At most ${MAX_SYMBOLS} symbols per request.`, 400);

  const keys = symbols.map((s) => `quote:${s}`);
  const cached = await safely(cacheGetMany(env.DB, keys), new Map());

  const quotes = {};
  const errors = {};
  const missing = [];
  for (const s of symbols) {
    const hit = cached.get(`quote:${s}`);
    if (hit) quotes[s] = hit;
    else missing.push(s);
  }

  let rateLimited = false;
  const fresh = await mapLimit(missing, CONCURRENCY, async (s) => {
    if (rateLimited) {
      errors[s] = 'Rate limit reached.';
      return null;
    }
    try {
      return await getQuote(env, s);
    } catch (err) {
      if (!(err instanceof ProviderError)) console.error('quote error', s, err);
      if (err?.code === 'rate_limited') rateLimited = true;
      errors[s] = err instanceof ProviderError ? err.message : 'Quote unavailable.';
      return null;
    }
  });

  const toCache = [];
  for (const q of fresh) {
    if (!q) continue;
    quotes[q.symbol] = q;
    toCache.push([`quote:${q.symbol}`, q]);
  }
  await safely(cachePutMany(env.DB, toCache, TTL_SECONDS));

  return json({ quotes, errors, rateLimited });
}
