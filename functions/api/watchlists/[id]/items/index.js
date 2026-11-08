import { cacheGet, cachePut, safely } from '../../../../_lib/cache.js';
import { errorResponse, json, normalizeSymbol, readJson, USER_ID } from '../../../../_lib/http.js';
import { getCompanyProfile } from '../../../../_lib/providers.js';
import { getOwnedWatchlist } from '../../../../_lib/watchlists.js';

const MAX_ITEMS = 100;

/** GET /api/watchlists/:id/items */
export async function onRequestGet({ env, params }) {
  const list = await getOwnedWatchlist(env.DB, params.id);
  if (!list) return errorResponse('Watchlist not found.', 404);
  const { results } = await env.DB
    .prepare('SELECT symbol, display_name AS name FROM watchlist_items WHERE watchlist_id = ? AND user_id = ? ORDER BY position, id')
    .bind(list.id, USER_ID)
    .all();
  return json({ items: results });
}

/** POST /api/watchlists/:id/items  { symbol, name } */
export async function onRequestPost({ request, env, params }) {
  const list = await getOwnedWatchlist(env.DB, params.id);
  if (!list) return errorResponse('Watchlist not found.', 404);
  const body = await readJson(request);
  const symbol = normalizeSymbol(body?.symbol);
  if (!symbol) return errorResponse('That doesn’t look like a valid ticker.');

  const { n, maxPos } = await env.DB
    .prepare('SELECT COUNT(*) AS n, COALESCE(MAX(position), 0) AS maxPos FROM watchlist_items WHERE watchlist_id = ? AND user_id = ?')
    .bind(list.id, USER_ID)
    .first();
  if (n >= MAX_ITEMS) return errorResponse(`A watchlist can hold up to ${MAX_ITEMS} tickers.`);

  const name = (await officialName(env, symbol)) || String(body?.name || '').trim().slice(0, 120) || symbol;
  await env.DB
    .prepare(
      `INSERT INTO watchlist_items (user_id, watchlist_id, symbol, display_name, position) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (watchlist_id, symbol) DO NOTHING`
    )
    .bind(USER_ID, list.id, symbol, name, maxPos + 1)
    .run();
  return json({ item: { symbol, name } }, 201);
}

// Prefer the proper-case company name from Finnhub's profile; fine to skip if unavailable.
async function officialName(env, symbol) {
  const key = `profile:${symbol}`;
  const cached = await safely(cacheGet(env.DB, key), null);
  if (cached) return cached.name || null;
  try {
    const profile = await getCompanyProfile(env, symbol);
    await safely(cachePut(env.DB, key, profile || { name: null }, 7 * 24 * 60 * 60));
    return profile?.name || null;
  } catch {
    return null;
  }
}
