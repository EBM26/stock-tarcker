import { json, USER_ID } from '../_lib/http.js';

/** GET /api/export -> backup of watchlists (with tickers), holdings and alerts. */
export async function onRequestGet({ env }) {
  const db = env.DB;
  const [lists, items, holdings, alerts] = await db.batch([
    db.prepare('SELECT id, name, position FROM watchlists WHERE user_id = ? ORDER BY position, id').bind(USER_ID),
    db.prepare('SELECT watchlist_id, symbol, display_name, position FROM watchlist_items WHERE user_id = ? ORDER BY position, id').bind(USER_ID),
    db.prepare('SELECT symbol, shares, avg_cost, updated_at FROM holdings WHERE user_id = ? ORDER BY symbol').bind(USER_ID),
    db.prepare(
      `SELECT symbol, direction, target_price, status, created_at, triggered_at, triggered_price
       FROM alerts WHERE user_id = ? ORDER BY symbol`
    ).bind(USER_ID),
  ]);
  return json({
    app: 'stock-tracker',
    version: 1,
    exported_at: new Date().toISOString(),
    watchlists: lists.results.map((l) => ({
      name: l.name,
      items: items.results
        .filter((i) => i.watchlist_id === l.id)
        .map((i) => ({ symbol: i.symbol, name: i.display_name })),
    })),
    holdings: holdings.results,
    alerts: alerts.results,
  });
}
