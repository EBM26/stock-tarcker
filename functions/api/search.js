import { cacheGet, cachePut, safely } from '../_lib/cache.js';
import { errorResponse, json } from '../_lib/http.js';
import { ProviderError, searchSymbols } from '../_lib/providers.js';

const TTL_SECONDS = 24 * 60 * 60; // Symbol lists rarely change.

export async function onRequestGet({ request, env }) {
  const q = (new URL(request.url).searchParams.get('q') || '').trim().slice(0, 40);
  if (!q) return json({ results: [] });

  const key = `search:${q.toUpperCase()}`;
  const cached = await safely(cacheGet(env.DB, key), null);
  if (cached) return json({ results: cached });

  try {
    const results = await searchSymbols(env, q);
    await safely(cachePut(env.DB, key, results, TTL_SECONDS));
    return json({ results });
  } catch (err) {
    if (err instanceof ProviderError) return errorResponse(err.message, err.status, { code: err.code });
    throw err;
  }
}
